/**
 * Internal endpoints — authenticated with INTERNAL_SECRET.
 * Called by the Railway filter engine / forked Palomar.
 *
 *   GET  /internal/configs           — active feed configs (legacy, still used for TTL lookup)
 *   POST /internal/posts             — batched post inserts from the filter engine
 *   POST /internal/percolator/sync   — bulk-sync all active feeds into the percolator index
 */

import { type Env, type FeedRow, feedRowToConfig, json, err } from '../types'
import { ensurePercolatorIndex, syncAllFeedQueries } from '../lib/opensearch'

function checkAuth(req: Request, env: Env): boolean {
  const auth = req.headers.get('Authorization') ?? ''
  const [scheme, token] = auth.split(' ')
  return scheme === 'Bearer' && !!env.INTERNAL_SECRET && token === env.INTERNAL_SECRET
}

// ---------------------------------------------------------------------------
// GET /internal/configs
// ---------------------------------------------------------------------------

export async function handleGetConfigs(req: Request, env: Env): Promise<Response> {
  if (!checkAuth(req, env)) return err('unauthorized', 401)

  const rows = await env.DB
    .prepare(`
      SELECT feed_id, owner_did, name, description, intent_text,
             terms, exclude_terms, seed_accounts,
             active, created_at, updated_at, tier_at_creation
      FROM feed_configs
      WHERE active = 1
    `)
    .all<FeedRow>()

  return json({ configs: rows.results.map(feedRowToConfig) })
}

// ---------------------------------------------------------------------------
// POST /internal/posts
// ---------------------------------------------------------------------------

interface PostMatch {
  feedId:    string
  postUri:   string
  postCid:   string
  authorDid: string
  indexedAt: number
  expiresAt: number
}

export async function handlePostInsert(req: Request, env: Env): Promise<Response> {
  if (!checkAuth(req, env)) return err('unauthorized', 401)

  let body: { posts: PostMatch[] }
  try {
    body = await req.json() as { posts: PostMatch[] }
  } catch {
    return err('invalid JSON body')
  }

  const posts = body?.posts
  if (!Array.isArray(posts) || posts.length === 0) return json({ inserted: 0 })

  const stmts = posts.map(p =>
    env.DB
      .prepare(`
        INSERT OR IGNORE INTO feed_posts
          (feed_id, post_uri, post_cid, author_did, indexed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(p.feedId, p.postUri, p.postCid, p.authorDid, p.indexedAt, p.expiresAt)
  )

  await env.DB.batch(stmts)
  return json({ inserted: posts.length })
}

// ---------------------------------------------------------------------------
// POST /internal/percolator/sync
//
// Rebuilds the entire percolator index from D1.
// Call this once after deploying OpenSearch, or any time the index drifts
// out of sync (e.g. after an OpenSearch cluster restore).
// ---------------------------------------------------------------------------

export async function handlePercolatorSync(req: Request, env: Env): Promise<Response> {
  if (!checkAuth(req, env)) return err('unauthorized', 401)

  if (!env.OPENSEARCH_URL) {
    return err('OPENSEARCH_URL not configured — percolator not in use', 501)
  }

  await ensurePercolatorIndex(env)

  // Fetch all active feeds including their matching rules
  const rows = await env.DB
    .prepare(`
      SELECT feed_id, terms, exclude_terms, seed_accounts, tier_at_creation
      FROM feed_configs
      WHERE active = 1
    `)
    .all<{
      feed_id: string
      terms: string
      exclude_terms: string
      seed_accounts: string
      tier_at_creation: string
    }>()

  const feeds = rows.results.map(r => ({
    feedId:       r.feed_id,
    tier:         r.tier_at_creation,
    terms:        JSON.parse(r.terms)         as string[],
    excludeTerms: JSON.parse(r.exclude_terms) as string[],
    seedAccounts: JSON.parse(r.seed_accounts) as string[],
  }))

  const { synced, errors } = await syncAllFeedQueries(env, feeds)

  console.log(`[percolator/sync] synced=${synced} errors=${errors} total=${feeds.length}`)
  return json({ synced, errors, total: feeds.length })
}
