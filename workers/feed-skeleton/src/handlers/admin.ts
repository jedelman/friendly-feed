/**
 * Admin endpoints — all require Bearer ADMIN_SECRET.
 *
 *   GET  /api/admin/stats
 *   GET  /api/admin/queue
 *   POST /api/admin/queue/:feedId/approve
 *   POST /api/admin/queue/:feedId/reject
 */

import { type Env, json, err } from '../types'
import { indexFeedQuery, deleteFeedQuery } from '../lib/opensearch'

function checkAdminAuth(req: Request, env: Env): boolean {
  const auth = req.headers.get('Authorization') ?? ''
  const [scheme, token] = auth.split(' ')
  return scheme === 'Bearer' && !!env.ADMIN_SECRET && token === env.ADMIN_SECRET
}

// ---------------------------------------------------------------------------
// GET /api/admin/stats
// ---------------------------------------------------------------------------

export async function handleAdminStats(req: Request, env: Env): Promise<Response> {
  if (!checkAdminAuth(req, env)) return err('unauthorized', 401)

  const todayStart = Math.floor(Date.now() / 86_400_000) * 86_400_000
  const weekStart  = todayStart - 6 * 86_400_000

  const [
    usersRow,
    tierRows,
    feedsRow,
    activeFeedsRow,
    postsToday,
    postsWeek,
    queueSize,
    dailyViews,
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),

    env.DB.prepare(`
      SELECT tier, COUNT(*) AS n FROM users GROUP BY tier
    `).all<{ tier: string; n: number }>(),

    env.DB.prepare('SELECT COUNT(*) AS n FROM feed_configs').first<{ n: number }>(),

    env.DB.prepare('SELECT COUNT(*) AS n FROM feed_configs WHERE active = 1').first<{ n: number }>(),

    env.DB.prepare(`
      SELECT COUNT(*) AS n FROM feed_posts WHERE indexed_at >= ?
    `).bind(todayStart).first<{ n: number }>(),

    env.DB.prepare(`
      SELECT COUNT(*) AS n FROM feed_posts WHERE indexed_at >= ?
    `).bind(weekStart).first<{ n: number }>(),

    env.DB.prepare(`
      SELECT COUNT(*) AS n FROM review_queue WHERE status = 'pending'
    `).first<{ n: number }>(),

    // Sum view_count per day for the last 7 days
    env.DB.prepare(`
      SELECT day, SUM(view_count) AS views
      FROM view_events
      WHERE day >= ?
      GROUP BY day
      ORDER BY day ASC
    `).bind(Math.floor(weekStart / 86_400_000)).all<{ day: number; views: number }>(),
  ])

  const byTier = { free: 0, pro: 0, studio: 0 }
  for (const row of tierRows.results) {
    if (row.tier in byTier) byTier[row.tier as keyof typeof byTier] = row.n
  }

  // Fill in any missing days in the last 7 days with 0
  const today   = Math.floor(Date.now() / 86_400_000)
  const viewMap = new Map(dailyViews.results.map(r => [r.day, r.views]))
  const dailyViewsFormatted = Array.from({ length: 7 }, (_, i) => {
    const day  = today - 6 + i
    const date = new Date(day * 86_400_000).toISOString().slice(0, 10)
    return { day: date, views: viewMap.get(day) ?? 0 }
  })

  return json({
    totalUsers:         usersRow?.n ?? 0,
    usersByTier:        byTier,
    totalFeeds:         feedsRow?.n ?? 0,
    activeFeeds:        activeFeedsRow?.n ?? 0,
    pausedFeeds:        (feedsRow?.n ?? 0) - (activeFeedsRow?.n ?? 0),
    postsIndexedToday:  postsToday?.n ?? 0,
    postsIndexedWeek:   postsWeek?.n ?? 0,
    reviewQueueSize:    queueSize?.n ?? 0,
    indexerLastSeen:    null,   // set by the forked Palomar heartbeat (future)
    opensearchDocCount: null,   // set by the forked Palomar (future)
    dailyViews:         dailyViewsFormatted,
  })
}

// ---------------------------------------------------------------------------
// GET /api/admin/queue
// ---------------------------------------------------------------------------

export async function handleAdminQueue(req: Request, env: Env): Promise<Response> {
  if (!checkAdminAuth(req, env)) return err('unauthorized', 401)

  const rows = await env.DB
    .prepare(`
      SELECT
        rq.feed_id, rq.reason, rq.created_at,
        fc.name AS feed_name,
        u.handle AS owner_handle
      FROM review_queue rq
      JOIN feed_configs fc ON fc.feed_id = rq.feed_id
      JOIN users        u  ON u.did      = rq.owner_did
      WHERE rq.status = 'pending'
      ORDER BY rq.created_at ASC
      LIMIT 50
    `)
    .all<{
      feed_id: string; reason: string; created_at: number
      feed_name: string; owner_handle: string
    }>()

  const queue = rows.results.map(r => ({
    feedId:      r.feed_id,
    feedName:    r.feed_name,
    ownerHandle: r.owner_handle,
    flagReason:  (JSON.parse(r.reason) as string[]).join(', '),
    createdAt:   r.created_at,
  }))

  return json({ queue })
}

// ---------------------------------------------------------------------------
// POST /api/admin/queue/:feedId/approve
// ---------------------------------------------------------------------------

export async function handleAdminApprove(
  req: Request,
  env: Env,
  feedId: string,
): Promise<Response> {
  if (!checkAdminAuth(req, env)) return err('unauthorized', 401)

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE review_queue SET status = 'approved', reviewed_at = ? WHERE feed_id = ?
    `).bind(now, feedId),
    env.DB.prepare(`
      UPDATE feed_configs SET active = 1 WHERE feed_id = ?
    `).bind(feedId),
  ])

  // Feed is now active — add it to the percolator so it starts matching
  if (env.OPENSEARCH_URL) {
    const row = await env.DB
      .prepare('SELECT terms, exclude_terms, seed_accounts, tier_at_creation FROM feed_configs WHERE feed_id = ?')
      .bind(feedId)
      .first<{ terms: string; exclude_terms: string; seed_accounts: string; tier_at_creation: string }>()
    if (row) {
      indexFeedQuery(env, {
        feedId,
        tier:         row.tier_at_creation,
        terms:        JSON.parse(row.terms) as string[],
        excludeTerms: JSON.parse(row.exclude_terms) as string[],
        seedAccounts: JSON.parse(row.seed_accounts) as string[],
      }).catch(e => console.error('[admin] percolator index failed after approve', feedId, e))
    }
  }

  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// POST /api/admin/queue/:feedId/reject
// ---------------------------------------------------------------------------

export async function handleAdminReject(
  req: Request,
  env: Env,
  feedId: string,
): Promise<Response> {
  if (!checkAdminAuth(req, env)) return err('unauthorized', 401)

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE review_queue SET status = 'rejected', reviewed_at = ? WHERE feed_id = ?
    `).bind(now, feedId),
    env.DB.prepare(`
      UPDATE feed_configs SET active = 0 WHERE feed_id = ?
    `).bind(feedId),
  ])

  // Ensure the feed is not in the percolator (it was never added, but be safe)
  if (env.OPENSEARCH_URL) {
    deleteFeedQuery(env, feedId)
      .catch(e => console.error('[admin] percolator delete failed after reject', feedId, e))
  }

  return json({ ok: true })
}
