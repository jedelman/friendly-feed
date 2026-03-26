/**
 * Friendly Feed — CF Worker
 *
 * Routes:
 *   Public (Bluesky AppView)
 *     GET  /.well-known/did.json
 *     GET  /xrpc/app.bsky.feed.getFeedSkeleton
 *
 *   Builder API (called by the Svelte SPA)
 *     GET    /api/user?handle=<handle>
 *     GET    /api/feeds?ownerDid=<did>
 *     POST   /api/feeds
 *     PATCH  /api/feeds/:id
 *     DELETE /api/feeds/:id
 *     POST   /api/generate
 *     GET    /api/preview
 *     POST   /api/hitl
 *
 *   Admin API (Bearer ADMIN_SECRET)
 *     GET  /api/admin/stats
 *     GET  /api/admin/queue
 *     POST /api/admin/queue/:feedId/approve
 *     POST /api/admin/queue/:feedId/reject
 *
 *   Internal (Bearer INTERNAL_SECRET — filter engine / Palomar)
 *     GET  /internal/configs
 *     POST /internal/posts
 *
 *   Cron
 *     Monday 9am UTC — weekly feed refinement suggestions
 */

import { type Env, CORS, json } from './types'
import { handleGetUser }         from './handlers/user'
import {
  handleListFeeds, handleCreateFeed,
  handleUpdateFeed, handleDeleteFeed,
} from './handlers/feeds'
import { handleGenerate }        from './handlers/generate'
import { handlePreview }         from './handlers/preview'
import { handleHitl }            from './handlers/hitl'
import {
  handleAdminStats, handleAdminQueue,
  handleAdminApprove, handleAdminReject,
} from './handlers/admin'
import { handleGetConfigs, handlePostInsert } from './handlers/internal'
import { handleGetFeedSkeleton }              from './handlers/skeleton'

export { type Env }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url    = new URL(req.url)
    const path   = url.pathname
    const method = req.method

    // ── Well-known DID document ──────────────────────────────────────────
    if (path === '/.well-known/did.json') {
      return json({
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: env.SERVICE_DID,
        service: [{
          id:              '#bsky_fg',
          type:            'BskyFeedGenerator',
          serviceEndpoint: `https://${url.hostname}`,
        }],
      })
    }

    // ── Bluesky AppView ──────────────────────────────────────────────────
    if (path === '/xrpc/app.bsky.feed.getFeedSkeleton' && method === 'GET') {
      return handleGetFeedSkeleton(req, env, url)
    }

    // ── Builder API ──────────────────────────────────────────────────────
    if (path === '/api/user'     && method === 'GET')  return handleGetUser(req, env)
    if (path === '/api/feeds'    && method === 'GET')  return handleListFeeds(req, env)
    if (path === '/api/feeds'    && method === 'POST') return handleCreateFeed(req, env)
    if (path === '/api/generate' && method === 'POST') return handleGenerate(req, env)
    if (path === '/api/preview'  && method === 'GET')  return handlePreview(req, env)
    if (path === '/api/hitl'     && method === 'POST') return handleHitl(req, env)

    // /api/feeds/:id
    const feedsMatch = path.match(/^\/api\/feeds\/([^/]+)$/)
    if (feedsMatch) {
      const feedId = feedsMatch[1]
      if (method === 'PATCH')  return handleUpdateFeed(req, env, feedId)
      if (method === 'DELETE') return handleDeleteFeed(req, env, feedId)
    }

    // ── Admin API ────────────────────────────────────────────────────────
    if (path === '/api/admin/stats' && method === 'GET')  return handleAdminStats(req, env)
    if (path === '/api/admin/queue' && method === 'GET')  return handleAdminQueue(req, env)

    const approveMatch = path.match(/^\/api\/admin\/queue\/([^/]+)\/approve$/)
    if (approveMatch && method === 'POST') return handleAdminApprove(req, env, approveMatch[1])

    const rejectMatch = path.match(/^\/api\/admin\/queue\/([^/]+)\/reject$/)
    if (rejectMatch && method === 'POST')  return handleAdminReject(req, env, rejectMatch[1])

    // ── Internal (filter engine) ─────────────────────────────────────────
    if (path === '/internal/configs' && method === 'GET')  return handleGetConfigs(req, env)
    if (path === '/internal/posts'   && method === 'POST') return handlePostInsert(req, env)

    return new Response('Not found', { status: 404 })
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runWeeklyRefinement(env)
  },
}

// ---------------------------------------------------------------------------
// Weekly cron — Pro/Studio feed refinement suggestions
// ---------------------------------------------------------------------------

async function runWeeklyRefinement(env: Env): Promise<void> {
  if (!env.ANTHROPIC_API_KEY) return

  // Find Pro/Studio feeds with HITL activity in the last 7 days
  const weekAgo = Date.now() - 7 * 86_400_000
  const feeds = await env.DB
    .prepare(`
      SELECT DISTINCT fc.feed_id, fc.name, fc.intent_text, fc.terms,
                      fc.exclude_terms, fc.seed_accounts, u.tier
      FROM feed_configs fc
      JOIN users u ON u.did = fc.owner_did
      JOIN hitl_events he ON he.feed_id = fc.feed_id
      WHERE u.tier IN ('pro', 'studio')
        AND fc.active = 1
        AND he.created_at >= ?
      LIMIT 50
    `)
    .bind(weekAgo)
    .all<{
      feed_id: string; name: string; intent_text: string
      terms: string; exclude_terms: string; seed_accounts: string; tier: string
    }>()

  for (const feed of feeds.results) {
    try {
      // Fetch HITL signals for this feed from the last 7 days
      const hitl = await env.DB
        .prepare(`
          SELECT post_uri, signal FROM hitl_events
          WHERE feed_id = ? AND created_at >= ?
          ORDER BY created_at DESC LIMIT 50
        `)
        .bind(feed.feed_id, weekAgo)
        .all<{ post_uri: string; signal: number }>()

      const upCount   = hitl.results.filter(h => h.signal === 1).length
      const downCount = hitl.results.filter(h => h.signal === -1).length
      if (upCount + downCount < 5) continue  // not enough signal

      const prompt = `You are reviewing a Bluesky feed config for weekly quality improvement.

Feed name: ${feed.name}
Original intent: "${feed.intent_text}"
Current terms: ${JSON.parse(feed.terms as string).join(', ')}
Current excludeTerms: ${JSON.parse(feed.exclude_terms as string).join(', ')}
Recent HITL signals: ${upCount} thumbs up, ${downCount} thumbs down

Based on this engagement pattern, suggest 1-3 specific changes to improve the feed.
Respond with concise bullet points only. Be specific (e.g. "add term X", "remove exclude term Y", "add seed account @user").`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 300,
          messages:   [{ role: 'user', content: prompt }],
        }),
      })

      if (!res.ok) continue
      const data = await res.json() as { content: Array<{ type: string; text: string }> }
      const suggestion = data.content.find(c => c.type === 'text')?.text ?? ''

      if (suggestion) {
        // Store as a HITL event with session_type='weekly_review' for the dashboard to surface
        // Future: write to a dedicated suggestions table
        console.log(`[weekly] suggestion for ${feed.feed_id}:`, suggestion.slice(0, 200))
      }
    } catch (e) {
      console.error(`[weekly] failed for feed ${feed.feed_id}:`, e)
    }
  }
}
