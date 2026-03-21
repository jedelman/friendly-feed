/**
 * Post matching logic.
 * Given post text, author DID, and a feed config, returns true if the post matches.
 *
 * Matching rules (applied in order):
 * 1. If author DID is in seedAccounts → match (boosted)
 * 2. If any excludeTerms found in text → no match
 * 3. If any terms found in text → match
 * 4. Otherwise → no match
 */

import type { FeedConfig } from '../../../packages/shared/src/types.js'

export function matchPost(
  text: string,
  authorDid: string,
  config: FeedConfig,
): boolean {
  const lower = text.toLowerCase()

  // Seed account boost — always include posts from prioritized accounts
  if (config.seedAccounts.includes(authorDid)) {
    // Still apply exclusions even for seed accounts
    if (hasAnyTerm(lower, config.excludeTerms)) return false
    return true
  }

  // Exclusion check
  if (hasAnyTerm(lower, config.excludeTerms)) return false

  // Term matching
  return hasAnyTerm(lower, config.terms)
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some(term => text.includes(term.toLowerCase()))
}
