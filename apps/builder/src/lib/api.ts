/**
 * API client for the Friendly Feed CF Worker.
 * All endpoints live at the same origin in production;
 * in dev, proxy via vite.config.ts server.proxy or set API_BASE.
 */

import type {
  User, FeedConfig, AgentFeedProposal,
  PreviewPost, AdminStats, ReviewQueueItem,
} from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

async function req<T>(
  path: string,
  opts: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  }
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// ── User ──────────────────────────────────────────────────────────────────

export async function resolveUser(handle: string): Promise<User> {
  return req<User>(`/api/user?handle=${encodeURIComponent(handle)}`)
}

// ── Feeds ─────────────────────────────────────────────────────────────────

export async function listFeeds(ownerDid: string): Promise<FeedConfig[]> {
  const data = await req<{ feeds: FeedConfig[] }>(`/api/feeds?ownerDid=${ownerDid}`)
  return data.feeds
}

export async function createFeed(feed: {
  ownerDid: string
  name: string
  description: string
  intentText: string
  terms: string[]
  excludeTerms: string[]
  seedAccounts: string[]
}): Promise<{ feedId: string }> {
  return req<{ feedId: string }>('/api/feeds', {
    method: 'POST',
    body: JSON.stringify(feed),
  })
}

export async function updateFeed(
  feedId: string,
  patch: Partial<Pick<FeedConfig, 'name' | 'description' | 'terms' | 'excludeTerms' | 'seedAccounts' | 'active'>>,
): Promise<void> {
  await req(`/api/feeds/${feedId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function deleteFeed(feedId: string): Promise<void> {
  await req(`/api/feeds/${feedId}`, { method: 'DELETE' })
}

// ── Agent ─────────────────────────────────────────────────────────────────

export async function generateFeedConfig(
  did: string,
  intent: string,
): Promise<AgentFeedProposal> {
  const data = await req<{ proposal: AgentFeedProposal }>('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ did, intent }),
  })
  return data.proposal
}

// ── Preview ───────────────────────────────────────────────────────────────

export async function previewFeed(params: {
  terms: string[]
  excludeTerms: string[]
  seedAccounts: string[]
}): Promise<PreviewPost[]> {
  const q = new URLSearchParams({
    terms: params.terms.join(','),
    excludeTerms: params.excludeTerms.join(','),
    seeds: params.seedAccounts.join(','),
  })
  const data = await req<{ posts: PreviewPost[] }>(`/api/preview?${q}`)
  return data.posts
}

// ── HITL ──────────────────────────────────────────────────────────────────

export async function recordHitl(
  feedId: string,
  postUri: string,
  signal: 1 | -1,
  sessionType: 'creation' | 'refinement',
): Promise<void> {
  await req('/api/hitl', {
    method: 'POST',
    body: JSON.stringify({ feedId, postUri, signal, sessionType }),
  })
}

// ── Admin ─────────────────────────────────────────────────────────────────

export async function getAdminStats(token: string): Promise<AdminStats> {
  return req<AdminStats>('/api/admin/stats', {}, token)
}

export async function getReviewQueue(token: string): Promise<ReviewQueueItem[]> {
  const data = await req<{ queue: ReviewQueueItem[] }>('/api/admin/queue', {}, token)
  return data.queue
}

export async function approveReview(feedId: string, token: string): Promise<void> {
  await req(`/api/admin/queue/${feedId}/approve`, { method: 'POST' }, token)
}

export async function rejectReview(feedId: string, token: string): Promise<void> {
  await req(`/api/admin/queue/${feedId}/reject`, { method: 'POST' }, token)
}
