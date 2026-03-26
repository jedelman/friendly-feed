// Re-export shared types + SPA-specific extensions

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
  intentText: string
  terms: string[]
  excludeTerms: string[]
  seedAccounts: string[]
  active: boolean
  createdAt: number
  updatedAt: number
  tierAtCreation: Tier
}

export interface AgentFeedProposal {
  terms: string[]
  excludeTerms: string[]
  seedAccounts: Array<{ did: string; handle: string; reason: string }>
  rationale: string
}

// Preview post from OpenSearch / Palomar
export interface PreviewPost {
  uri: string
  cid: string
  authorDid: string
  authorHandle: string
  authorDisplayName?: string
  authorAvatar?: string
  text: string
  indexedAt: string
  likeCount?: number
  replyCount?: number
  signal?: 1 | -1   // set client-side during HITL
}

// Admin stats from CF Worker
export interface AdminStats {
  totalUsers: number
  usersByTier: { free: number; pro: number; studio: number }
  totalFeeds: number
  activeFeeds: number
  pausedFeeds: number
  postsIndexedToday: number
  postsIndexedWeek: number
  reviewQueueSize: number
  indexerLastSeen: string | null
  opensearchDocCount: number | null
  dailyViews: Array<{ day: string; views: number }>
}

export interface ReviewQueueItem {
  id: number
  feedId: string
  feedName: string
  ownerHandle: string
  flagReason: string
  createdAt: number
}

export const TIER_LABELS: Record<Tier, string> = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
}

export const TIER_COLORS: Record<Tier, string> = {
  free: 'muted',
  pro: 'accent',
  studio: 'amber',
}
