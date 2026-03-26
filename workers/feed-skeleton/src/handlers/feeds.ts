/**
 * Feed CRUD handlers:
 *   GET    /api/feeds?ownerDid=<did>
 *   POST   /api/feeds
 *   PATCH  /api/feeds/:id
 *   DELETE /api/feeds/:id
 */

import { type Env, type FeedRow, feedRowToConfig, json, err } from '../types'

const TIER_MAX_FEEDS: Record<string, number> = {
  free:   1,
  pro:    10,
  studio: Infinity,
}

// Bluesky feed IDs must be ≤15 chars, letters/numbers/hyphens only
function generateFeedId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 10)
  const rand = Math.random().toString(36).slice(2, 7)
  return `${slug || 'feed'}-${rand}`
}

// ---------------------------------------------------------------------------
// GET /api/feeds?ownerDid=<did>
// ---------------------------------------------------------------------------

export async function handleListFeeds(req: Request, env: Env): Promise<Response> {
  const url      = new URL(req.url)
  const ownerDid = url.searchParams.get('ownerDid')

  if (!ownerDid) return err('ownerDid parameter required')

  const rows = await env.DB
    .prepare(`
      SELECT feed_id, owner_did, name, description, intent_text,
             terms, exclude_terms, seed_accounts,
             active, created_at, updated_at, tier_at_creation
      FROM feed_configs
      WHERE owner_did = ?
      ORDER BY created_at DESC
    `)
    .bind(ownerDid)
    .all<FeedRow>()

  return json({ feeds: rows.results.map(feedRowToConfig) })
}

// ---------------------------------------------------------------------------
// POST /api/feeds
// ---------------------------------------------------------------------------

interface CreateFeedBody {
  ownerDid:     string
  name:         string
  description?: string
  intentText:   string
  terms:        string[]
  excludeTerms: string[]
  seedAccounts: string[]
}

export async function handleCreateFeed(req: Request, env: Env): Promise<Response> {
  let body: CreateFeedBody
  try {
    body = await req.json() as CreateFeedBody
  } catch {
    return err('invalid JSON body')
  }

  const { ownerDid, name, intentText, terms, excludeTerms, seedAccounts } = body

  if (!ownerDid || !name || !intentText) return err('ownerDid, name, and intentText are required')
  if (!Array.isArray(terms) || terms.length === 0) return err('at least one term required')

  // Look up user to get tier
  const user = await env.DB
    .prepare('SELECT tier, feeds_count FROM users WHERE did = ?')
    .bind(ownerDid)
    .first<{ tier: string; feeds_count: number }>()

  if (!user) return err('User not found', 404)

  const maxFeeds = TIER_MAX_FEEDS[user.tier] ?? 1
  if (user.feeds_count >= maxFeeds) {
    return err(
      `Your ${user.tier} plan allows ${maxFeeds} active feed${maxFeeds !== 1 ? 's' : ''}. Upgrade to create more.`,
      403,
    )
  }

  const feedId  = generateFeedId(name)
  const now     = Date.now()

  // Spam gate: check term concentration — if >80% of terms are very short (≤3 chars) flag it
  const spamFlags: string[] = []
  const shortTermRatio = terms.filter(t => t.length <= 3).length / terms.length
  if (shortTermRatio > 0.8) spamFlags.push('low_quality_terms')
  // Seed account concentration: if >60% of seeds are provided, flag for manual review
  if (seedAccounts.length > 15) spamFlags.push('excess_seeds')

  const needsReview = spamFlags.length > 0

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO feed_configs (
        feed_id, owner_did, name, description, intent_text,
        terms, exclude_terms, seed_accounts,
        active, created_at, updated_at, tier_at_creation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      feedId, ownerDid, name.slice(0, 60),
      (body.description ?? intentText).slice(0, 300),
      intentText.slice(0, 500),
      JSON.stringify(terms.slice(0, 30)),
      JSON.stringify((excludeTerms ?? []).slice(0, 20)),
      JSON.stringify((seedAccounts ?? []).slice(0, 20)),
      needsReview ? 0 : 1,   // start paused if flagged
      now, now, user.tier,
    ),
    env.DB.prepare(`
      UPDATE users SET feeds_count = feeds_count + 1 WHERE did = ?
    `).bind(ownerDid),
    ...(needsReview ? [
      env.DB.prepare(`
        INSERT OR IGNORE INTO review_queue (feed_id, owner_did, reason, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).bind(feedId, ownerDid, JSON.stringify(spamFlags), now),
    ] : []),
  ])

  return json({ feedId, active: !needsReview, flagged: needsReview }, 201)
}

// ---------------------------------------------------------------------------
// PATCH /api/feeds/:id
// ---------------------------------------------------------------------------

interface PatchFeedBody {
  name?:         string
  description?:  string
  terms?:        string[]
  excludeTerms?: string[]
  seedAccounts?: string[]
  active?:       boolean
}

export async function handleUpdateFeed(
  req: Request,
  env: Env,
  feedId: string,
): Promise<Response> {
  let body: PatchFeedBody
  try {
    body = await req.json() as PatchFeedBody
  } catch {
    return err('invalid JSON body')
  }

  const existing = await env.DB
    .prepare('SELECT feed_id FROM feed_configs WHERE feed_id = ?')
    .bind(feedId)
    .first<{ feed_id: string }>()

  if (!existing) return err('Feed not found', 404)

  const updates: string[] = ['updated_at = ?']
  const binds: unknown[]  = [Date.now()]

  if (body.name         !== undefined) { updates.push('name = ?');          binds.push(body.name.slice(0, 60)) }
  if (body.description  !== undefined) { updates.push('description = ?');   binds.push(body.description.slice(0, 300)) }
  if (body.terms        !== undefined) { updates.push('terms = ?');         binds.push(JSON.stringify(body.terms.slice(0, 30))) }
  if (body.excludeTerms !== undefined) { updates.push('exclude_terms = ?'); binds.push(JSON.stringify(body.excludeTerms.slice(0, 20))) }
  if (body.seedAccounts !== undefined) { updates.push('seed_accounts = ?'); binds.push(JSON.stringify(body.seedAccounts.slice(0, 20))) }
  if (body.active       !== undefined) { updates.push('active = ?');        binds.push(body.active ? 1 : 0) }

  binds.push(feedId)

  await env.DB
    .prepare(`UPDATE feed_configs SET ${updates.join(', ')} WHERE feed_id = ?`)
    .bind(...binds)
    .run()

  return json({ ok: true })
}

// ---------------------------------------------------------------------------
// DELETE /api/feeds/:id
// ---------------------------------------------------------------------------

export async function handleDeleteFeed(
  req: Request,
  env: Env,
  feedId: string,
): Promise<Response> {
  const existing = await env.DB
    .prepare('SELECT owner_did FROM feed_configs WHERE feed_id = ?')
    .bind(feedId)
    .first<{ owner_did: string }>()

  if (!existing) return err('Feed not found', 404)

  await env.DB.batch([
    env.DB.prepare('DELETE FROM feed_configs WHERE feed_id = ?').bind(feedId),
    env.DB.prepare('DELETE FROM feed_posts   WHERE feed_id = ?').bind(feedId),
    env.DB.prepare('DELETE FROM hitl_events  WHERE feed_id = ?').bind(feedId),
    env.DB.prepare('DELETE FROM view_events  WHERE feed_id = ?').bind(feedId),
    env.DB.prepare('DELETE FROM review_queue WHERE feed_id = ?').bind(feedId),
    env.DB.prepare('UPDATE users SET feeds_count = MAX(0, feeds_count - 1) WHERE did = ?')
      .bind(existing.owner_did),
  ])

  return json({ ok: true })
}
