/**
 * GET /api/user?handle=<handle>
 *
 * Resolves a Bluesky handle → DID, upserts the user row in D1,
 * and returns the user record.
 */

import { type Env, json, err } from '../types'

const BSKY_API = 'https://public.api.bsky.app/xrpc'

export async function handleGetUser(req: Request, env: Env): Promise<Response> {
  const url   = new URL(req.url)
  const handle = url.searchParams.get('handle')?.replace(/^@/, '').trim()

  if (!handle) return err('handle parameter required')

  // Resolve handle → DID + profile via Bluesky public API
  let did: string
  let displayHandle: string

  try {
    const res = await fetch(
      `${BSKY_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    )
    if (!res.ok) return err('Bluesky handle not found', 404)
    const data = await res.json() as { did: string }
    did = data.did
    displayHandle = handle
  } catch {
    return err('Failed to resolve handle', 502)
  }

  const now = Date.now()

  // Upsert user — preserve existing tier on conflict
  await env.DB
    .prepare(`
      INSERT INTO users (did, handle, tier, created_at, feeds_count, monthly_views, view_reset_at)
      VALUES (?, ?, 'free', ?, 0, 0, ?)
      ON CONFLICT (did) DO UPDATE SET handle = excluded.handle
    `)
    .bind(did, displayHandle, now, now + 30 * 86_400_000)
    .run()

  const user = await env.DB
    .prepare('SELECT did, handle, tier, created_at, feeds_count, monthly_views, view_reset_at FROM users WHERE did = ?')
    .bind(did)
    .first<{
      did: string; handle: string; tier: string
      created_at: number; feeds_count: number; monthly_views: number; view_reset_at: number
    }>()

  if (!user) return err('User not found after upsert', 500)

  return json({
    did:          user.did,
    handle:       user.handle,
    tier:         user.tier,
    createdAt:    user.created_at,
    feedsCount:   user.feeds_count,
    monthlyViews: user.monthly_views,
    viewResetAt:  user.view_reset_at,
  })
}
