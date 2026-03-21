/**
 * Friendly Feed — getFeedSkeleton Worker
 *
 * Implements app.bsky.feed.getFeedSkeleton for the AT Protocol feed generator lexicon.
 * Bluesky's AppView calls this endpoint when a user opens one of their custom feeds.
 *
 * Spec: https://docs.bsky.app/docs/api/app-bsky-feed-get-feed-skeleton
 */

export interface Env {
  DB: D1Database
  SERVICE_DID: string
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

    // Feed skeleton endpoint
    if (url.pathname === '/xrpc/app.bsky.feed.getFeedSkeleton') {
      return handleGetFeedSkeleton(req, env, url)
    }

    return new Response('Not found', { status: 404 })
  },

  // Weekly cron: generate agent refinement suggestions for Pro/Studio feeds
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runWeeklyRefinement(env)
  },
}

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
