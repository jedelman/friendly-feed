/**
 * Friendly Feed — getFeedSkeleton Worker
 *
 * Implements app.bsky.feed.getFeedSkeleton for the AT Protocol feed generator lexicon.
 * Bluesky's AppView calls this endpoint when a user opens one of their custom feeds.
 *
 * Also serves internal endpoints used by the Railway filter engine:
 *   GET  /internal/configs  — returns active feed configs as JSON
 *   POST /internal/posts    — accepts batched post inserts from the filter engine
 *
 * Spec: https://docs.bsky.app/docs/api/app-bsky-feed-get-feed-skeleton
 */

export interface Env {
  DB: D1Database
  SERVICE_DID: string
  /** Shared secret for /internal/* endpoints — set in wrangler.toml [vars] or CF secrets */
  INTERNAL_SECRET: string
}

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    // DID document — required for feed generator registration
    if (url.pathname === '/.well-known/did.json') {
      return Response.json({
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: env.SERVICE_DID,
        service: [{
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${url.hostname}`,
        }],
      }, { headers: HEADERS })
    }

    // Feed skeleton endpoint — called by Bluesky AppView
    if (url.pathname === '/xrpc/app.bsky.feed.getFeedSkeleton') {
      return handleGetFeedSkeleton(req, env, url)
    }

    // Internal: serve active feed configs to the filter engine
    if (url.pathname === '/internal/configs' && req.method === 'GET') {
      return handleGetConfigs(req, env)
    }

    // Internal: accept batched post inserts from the filter engine
    if (url.pathname === '/internal/posts' && req.method === 'POST') {
      return handlePostInsert(req, env)
    }

    return new Response('Not found', { status: 404 })
  },

  // Weekly cron: generate agent refinement suggestions for Pro/Studio feeds
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runWeeklyRefinement(env)
  },
}

// ---------------------------------------------------------------------------
// Internal auth
// ---------------------------------------------------------------------------

function checkInternalAuth(req: Request, env: Env): boolean {
  const auth = req.headers.get('Authorization') ?? ''
  const [scheme, token] = auth.split(' ')
  return scheme === 'Bearer' && token === env.INTERNAL_SECRET
}

// ---------------------------------------------------------------------------
// Internal: GET /internal/configs
// Returns all active feed configs for the filter engine to load/poll.
// ---------------------------------------------------------------------------

async function handleGetConfigs(req: Request, env: Env): Promise<Response> {
  if (!checkInternalAuth(req, env)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: HEADERS })
  }

  const rows = await env.DB
    .prepare(`
      SELECT feed_id, owner_did, name, description, intent_text,
             terms, exclude_terms, seed_accounts,
             active, created_at, updated_at, tier_at_creation
      FROM feed_configs
      WHERE active = 1
    `)
    .all<{
      feed_id: string; owner_did: string; name: string; description: string
      intent_text: string; terms: string; exclude_terms: string; seed_accounts: string
      active: number; created_at: number; updated_at: number; tier_at_creation: string
    }>()

  const configs = rows.results.map(r => ({
    feedId: r.feed_id,
    ownerDid: r.owner_did,
    name: r.name,
    description: r.description,
    intentText: r.intent_text,
    terms: JSON.parse(r.terms) as string[],
    excludeTerms: JSON.parse(r.exclude_terms) as string[],
    seedAccounts: JSON.parse(r.seed_accounts) as string[],
    active: Boolean(r.active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tierAtCreation: r.tier_at_creation,
  }))

  return Response.json({ configs }, { headers: HEADERS })
}

// ---------------------------------------------------------------------------
// Internal: POST /internal/posts
// Accepts batched post inserts from the filter engine.
// Body: { posts: PostMatch[] }
// ---------------------------------------------------------------------------

interface PostMatch {
  feedId: string
  postUri: string
  postCid: string
  authorDid: string
  indexedAt: number
  expiresAt: number
}

async function handlePostInsert(req: Request, env: Env): Promise<Response> {
  if (!checkInternalAuth(req, env)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: HEADERS })
  }

  let body: { posts: PostMatch[] }
  try {
    body = await req.json() as { posts: PostMatch[] }
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400, headers: HEADERS })
  }

  const posts = body?.posts
  if (!Array.isArray(posts) || posts.length === 0) {
    return Response.json({ inserted: 0 }, { headers: HEADERS })
  }

  // Batch insert using D1's batch API
  // INSERT OR IGNORE skips duplicates (same feed_id + post_uri)
  const stmts = posts.map(p =>
    env.DB
      .prepare(`
        INSERT OR IGNORE INTO feed_posts (feed_id, post_uri, post_cid, author_did, indexed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(p.feedId, p.postUri, p.postCid, p.authorDid, p.indexedAt, p.expiresAt)
  )

  await env.DB.batch(stmts)

  return Response.json({ inserted: posts.length }, { headers: HEADERS })
}

// ---------------------------------------------------------------------------
// Public: GET /xrpc/app.bsky.feed.getFeedSkeleton
// ---------------------------------------------------------------------------

async function handleGetFeedSkeleton(
  _req: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  const feedUri = url.searchParams.get('feed')
  const cursor = url.searchParams.get('cursor')
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 100)

  if (!feedUri) {
    return Response.json({ error: 'feed parameter required' }, { status: 400, headers: HEADERS })
  }

  // Extract feed_id from AT URI: at://did:.../app.bsky.feed.generator/<feed_id>
  const feedId = feedUri.split('/').at(-1)
  if (!feedId) {
    return Response.json({ error: 'invalid feed URI' }, { status: 400, headers: HEADERS })
  }

  // Look up feed config
  const config = await env.DB
    .prepare('SELECT feed_id, owner_did, active FROM feed_configs WHERE feed_id = ?')
    .bind(feedId)
    .first<{ feed_id: string; owner_did: string; active: number }>()

  if (!config) {
    return Response.json({ error: 'feed not found' }, { status: 404, headers: HEADERS })
  }

  if (!config.active) {
    // Feed paused — return empty skeleton, not an error
    return Response.json({ feed: [] }, { headers: HEADERS })
  }

  // Enforce view cap
  const capResult = await enforceViewCap(env, config.feed_id, config.owner_did)
  if (!capResult.allowed) {
    // Over cap with no auto-charge — pause appearance
    return Response.json({ feed: [] }, { headers: HEADERS })
  }

  // Fetch posts with cursor pagination
  const cursorTs = cursor ? parseInt(cursor) : Date.now()
  const posts = await env.DB
    .prepare(`
      SELECT post_uri, indexed_at
      FROM feed_posts
      WHERE feed_id = ?
        AND indexed_at < ?
        AND expires_at > ?
      ORDER BY indexed_at DESC
      LIMIT ?
    `)
    .bind(feedId, cursorTs, Date.now(), limit)
    .all<{ post_uri: string; indexed_at: number }>()

  const feed = posts.results.map(p => ({ post: p.post_uri }))
  const nextCursor = posts.results.at(-1)?.indexed_at.toString()

  return Response.json(
    { feed, ...(nextCursor ? { cursor: nextCursor } : {}) },
    { headers: HEADERS },
  )
}

async function enforceViewCap(
  env: Env,
  feedId: string,
  ownerDid: string,
): Promise<{ allowed: boolean }> {
  const day = Math.floor(Date.now() / 86_400_000)

  // Get owner tier and monthly view limit
  const user = await env.DB
    .prepare('SELECT tier, monthly_views, view_reset_at FROM users WHERE did = ?')
    .bind(ownerDid)
    .first<{ tier: string; monthly_views: number; view_reset_at: number }>()

  if (!user) return { allowed: true } // unknown user, allow

  // TODO: implement full cap + overage logic against tier limits
  // For MVP: always allow, log view event
  await env.DB
    .prepare(`
      INSERT INTO view_events (feed_id, owner_did, day, view_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT (feed_id, day) DO UPDATE SET view_count = view_count + 1
    `)
    .bind(feedId, ownerDid, day)
    .run()

  return { allowed: true }
}

async function runWeeklyRefinement(_env: Env): Promise<void> {
  // TODO: query Pro/Studio feeds with recent HITL activity
  // Call agent with config + HITL signals → generate suggestion
  // Store suggestion for display in dashboard
  console.log('Weekly refinement cron — not yet implemented')
}
