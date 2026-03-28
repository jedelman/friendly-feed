/**
 * Feed creation flow state — lives only in memory (not persisted).
 * Shared between Create and Preview pages.
 */

import { writable } from 'svelte/store'
import type { AgentFeedProposal, PreviewPost } from '$lib/types'

export type CreationStep = 'intent' | 'review' | 'preview' | 'done'

export interface CreationState {
  step: CreationStep
  // Step 1: intent
  feedName: string
  intentText: string
  // Step 2: agent proposal + edits
  proposal: AgentFeedProposal | null
  editedTerms: string[]
  editedExcludeTerms: string[]
  editedSeedAccounts: Array<{ did: string; handle: string; reason: string }>
  // Step 3: HITL preview
  previewPosts: PreviewPost[]
  hitlVotes: Map<string, 1 | -1>   // uri → signal
  // Step 4: result
  publishedFeedId: string | null
}

const initial: CreationState = {
  step: 'intent',
  feedName: '',
  intentText: '',
  proposal: null,
  editedTerms: [],
  editedExcludeTerms: [],
  editedSeedAccounts: [],
  previewPosts: [],
  hitlVotes: new Map(),
  publishedFeedId: null,
}

function createCreationStore() {
  const { subscribe, set, update } = writable<CreationState>({ ...initial, hitlVotes: new Map() })

  return {
    subscribe,
    reset() {
      set({ ...initial, hitlVotes: new Map() })
    },
    setIntent(name: string, intent: string) {
      update(s => ({ ...s, feedName: name, intentText: intent }))
    },
    setProposal(proposal: AgentFeedProposal) {
      update(s => ({
        ...s,
        proposal,
        editedTerms: [...proposal.terms],
        editedExcludeTerms: [...proposal.excludeTerms],
        editedSeedAccounts: [...proposal.seedAccounts],
        step: 'review',
      }))
    },
    updateTerms(terms: string[]) {
      update(s => ({ ...s, editedTerms: terms }))
    },
    updateExcludeTerms(terms: string[]) {
      update(s => ({ ...s, editedExcludeTerms: terms }))
    },
    updateSeedAccounts(seeds: Array<{ did: string; handle: string; reason: string }>) {
      update(s => ({ ...s, editedSeedAccounts: seeds }))
    },
    setPreviewPosts(posts: PreviewPost[]) {
      update(s => ({ ...s, previewPosts: posts, step: 'preview' }))
    },
    vote(uri: string, signal: 1 | -1) {
      update(s => {
        const votes = new Map(s.hitlVotes)
        votes.set(uri, signal)
        return { ...s, hitlVotes: votes }
      })
    },
    unvote(uri: string) {
      update(s => {
        const votes = new Map(s.hitlVotes)
        votes.delete(uri)
        return { ...s, hitlVotes: votes }
      })
    },
    setPublished(feedId: string) {
      update(s => ({ ...s, publishedFeedId: feedId, step: 'done' }))
    },
  }
}

export const creation = createCreationStore()
