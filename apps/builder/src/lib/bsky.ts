/**
 * Thin wrappers around the Bluesky public API.
 * No auth required — public.api.bsky.app for read-only data.
 */

const BSKY_API = 'https://public.api.bsky.app/xrpc'

export interface BskyProfile {
  did: string
  handle: string
  displayName?: string
  avatar?: string
  description?: string
  followersCount?: number
  followsCount?: number
  postsCount?: number
}

export async function resolveHandle(handle: string): Promise<string> {
  const res = await fetch(
    `${BSKY_API}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  )
  if (!res.ok) throw new Error('Handle not found')
  const data = await res.json() as { did: string }
  return data.did
}

export async function getProfile(actor: string): Promise<BskyProfile> {
  const res = await fetch(
    `${BSKY_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`
  )
  if (!res.ok) throw new Error('Profile not found')
  return res.json() as Promise<BskyProfile>
}

export async function getProfiles(actors: string[]): Promise<BskyProfile[]> {
  if (actors.length === 0) return []
  const params = actors.map(a => `actors[]=${encodeURIComponent(a)}`).join('&')
  const res = await fetch(`${BSKY_API}/app.bsky.actor.getProfiles?${params}`)
  if (!res.ok) return []
  const data = await res.json() as { profiles: BskyProfile[] }
  return data.profiles
}

// Returns handles from user's follows — useful for seeding the agent prompt
export async function getSampleFollows(did: string, limit = 50): Promise<BskyProfile[]> {
  const res = await fetch(
    `${BSKY_API}/app.bsky.graph.getFollows?actor=${encodeURIComponent(did)}&limit=${limit}`
  )
  if (!res.ok) return []
  const data = await res.json() as { follows: BskyProfile[] }
  return data.follows
}
