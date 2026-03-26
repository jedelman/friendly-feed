/**
 * GET /xrpc/app.bsky.feed.getFeedSkeleton
 *
 * Called by the Bluesky AppView when a user opens one of their custom feeds.
 * Returns a list of post AT-URIs in reverse chronological order.
 */

import { type Env, json, err } from '../types'

const TIER_MONTHLY_VIEWS: Record<string, number> = {
  free:   50_000,
  pro:    500_000,
  studio: 2_000_000,
}

export async function handleGetFeedSkeleton(
  _req: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const feedUri = url.searchParams.get('feed')
  const cursor  = url.searchParams.get('cursor')
  const limit   = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)

  if (!feedUri) return err('feed parameter required')

  // Extract feed_id from AT URI: at://did:.../app.bsky.feed.generator/<feed_id>
  const feedId = feedUri.split('/').at(-1)
  if (!feedId) return err('invalid feed URI')

  const config = await env.DB
    .prepare('SELECT feed_id, owner_did, active FROM feed_configs WHERE feed_id = ?')
    .bind(feedId)
    .first<{ feed_id: string; owner_did: string; active: number }>()

  if (!config)     return err('feed not found', 404)
  if (!config.active) return json({ feed: [] })

  // View cap enforcement
  const capResult = await enforceViewCap(env, config.feed_id, config.owner_did)
  if (!capResult.allowed) return json({ feed: [] })

  // Cursor pagination by indexed_at timestamp
  const cursorTs = cursor ? parseInt(cursor) : Date.now()
  const posts    = await env.DB
    .prepare(`
      SELECT post_uri, indexed_at
      FROM feed_posts
      WHERE feed_id   = ?
        AND indexed_at < ?
        AND expires_at > ?
      ORDER BY indexed_at DESC
      LIMIT ?
    `)
    .bind(feedId, cursorTs, Date.now(), limit)
    .all<{ post_uri: string; indexed_at: number }>()

  const feed       = posts.results.map(p => ({ post: p.post_uri }))
  const nextCursor = posts.results.at(-1)?.indexed_at.toString()

  return json({ feed, ...(nextCursor ? { cursor: nextCursor } : {}) })
}

async function enforceViewCap(
  env: Env,
  feedId: string,
  ownerDid: string,
): Promise<{ allowed: boolean }> {
  const day = Math.floor(Date.now() / 86_400_000)

  const user = await env.DB
    .prepare('SELECT tier, monthly_views, view_reset_at FROM users WHERE did = ?')
    .bind(ownerDid)
    .first<{ tier: string; monthly_views: number; view_reset_at: number }>()

  // Unknown user — allow and don't track
  if (!user) return { allowed: true }

  const monthlyLimit = TIER_MONTHLY_VIEWS[user.tier] ?? TIER_MONTHLY_VIEWS.free

  // Reset monthly counter if the reset window has passed
  if (Date.now() > user.view_reset_at) {
    await env.DB
      .prepare(`UPDATE users SET monthly_views = 0, view_reset_at = ? WHERE did = ?`)
      .bind(Date.now() + 30 * 86_400_000, ownerDid)
      .run()
    // Recheck after reset — allow
  } else if (user.monthly_views >= monthlyLimit) {
    return { allowed: false }
  }

  // Increment monthly counter and log daily view event
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET monthly_views = monthly_views + 1 WHERE did = ?`)
      .bind(ownerDid),
    env.DB.prepare(`
      INSERT INTO view_events (feed_id, owner_did, day, view_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT (feed_id, day) DO UPDATE SET view_count = view_count + 1
    `).bind(feedId, ownerDid, day),
  ])

  return { allowed: true }
}
