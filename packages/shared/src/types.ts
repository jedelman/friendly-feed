export type Tier = 'free' | 'pro' | 'studio'

export interface User {
  did: string
  handle: string
  tier: Tier
  createdAt: number
  feedsCount: number
  monthlyViews: number
  viewResetAt: number
}

export interface FeedConfig {
  feedId: string
  ownerDid: string
  name: string
  description: string
  intentText: string       // original natural language — preserved for agent refinement
  terms: string[]          // include terms
  excludeTerms: string[]   // exclude terms
  seedAccounts: string[]   // prioritized DIDs
  active: boolean
  createdAt: number
  updatedAt: number
  tierAtCreation: Tier
}

export interface FeedPost {
  id?: number
  feedId: string
  postUri: string          // at://did:plc:.../app.bsky.feed.post/rkey
  postCid: string
  authorDid: string
  indexedAt: number
  expiresAt: number
}

export interface HitlEvent {
  id?: number
  feedId: string
  postUri: string
  signal: 1 | -1           // 1 = thumbs up, -1 = thumbs down
  sessionType: 'creation' | 'refinement' | 'weekly_review'
  createdAt: number
}

export interface ViewEvent {
  feedId: string
  ownerDid: string
  day: number
  viewCount: number
}

export const TIER_LIMITS = {
  free:   { maxFeeds: 1,        retentionMs: 48 * 3600_000,       monthlyViews: 50_000,    agenticCreations: 1 as number | 'unlimited' },
  pro:    { maxFeeds: 10,       retentionMs: 30 * 86400_000,      monthlyViews: 500_000,   agenticCreations: 'unlimited' as number | 'unlimited' },
  studio: { maxFeeds: Infinity, retentionMs: 90 * 86400_000,      monthlyViews: 2_000_000, agenticCreations: 'unlimited' as number | 'unlimited' },
} satisfies Record<Tier, { maxFeeds: number; retentionMs: number; monthlyViews: number; agenticCreations: number | 'unlimited' }>

export const OVERAGE_PRICE_PER_MILLION = 0.50

export interface AgentFeedProposal {
  terms: string[]
  excludeTerms: string[]
  seedAccounts: Array<{ did: string; handle: string; reason: string }>
  rationale: string
}
