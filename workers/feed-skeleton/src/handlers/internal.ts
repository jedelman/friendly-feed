/**
 * Internal endpoints — authenticated with INTERNAL_SECRET.
 * Called by the Railway filter engine / forked Palomar.
 *
 *   GET  /internal/configs  — active feed configs for the filter engine
 *   POST /internal/posts    — batched post inserts from the filter engine
 */

import { type Env, type FeedRow, feedRowToConfig, json, err } from '../types'

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
