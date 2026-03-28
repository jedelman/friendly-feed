/**
 * OpenSearch percolator helpers.
 *
 * The percolator index (`ff_feed_queries`) stores one document per active feed.
 * Each document contains the feed's matching rules as an OpenSearch bool query.
 * When a new post arrives, the filter engine calls the percolate API once and
 * gets back every feed ID whose query matched — O(log F) instead of O(F×K).
 *
 * Index mapping
 * ─────────────
 * {
 *   "query":   { "type": "percolator" },  ← stores the bool query
 *   "feed_id": { "type": "keyword" },
 *   "tier":    { "type": "keyword" }       ← needed by filter engine for TTL
 * }
 *
 * Percolate document shape (what the filter engine sends per post)
 * ────────────────────────────────────────────────────────────────
 * { "text": "<post text>", "did": "<author DID>" }
 *
 * The `text` field is matched by term/phrase queries; `did` is matched by
 * the seed-account `term` clauses. Both fields must be declared in the mapping
 * so OpenSearch can analyse them during percolation.
 */

import type { Env } from '../types'

export const PERCOLATOR_INDEX = 'ff_feed_queries'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function osHeaders(env: Env): Record<string, string> {
  const creds = btoa(`${env.OPENSEARCH_USERNAME}:${env.OPENSEARCH_PASSWORD}`)
  return {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${creds}`,
  }
}

async function osRequest(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${env.OPENSEARCH_URL}${path}`, {
    method,
    headers: osHeaders(env),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

// ---------------------------------------------------------------------------
// Index bootstrap
// ---------------------------------------------------------------------------

/**
 * Create the percolator index if it does not already exist.
 * Safe to call on every Worker startup / deploy.
 */
export async function ensurePercolatorIndex(env: Env): Promise<void> {
  if (!env.OPENSEARCH_URL) return

  // HEAD request — 200 means exists, 404 means we need to create it
  const check = await fetch(`${env.OPENSEARCH_URL}/${PERCOLATOR_INDEX}`, {
    method: 'HEAD',
    headers: osHeaders(env),
  })

  if (check.status === 200) return   // already exists

  await osRequest(env, 'PUT', `/${PERCOLATOR_INDEX}`, {
    mappings: {
      properties: {
        // The percolator field — stores the query DSL
        query: { type: 'percolator' },

        // Metadata returned with each match
        feed_id: { type: 'keyword' },
        tier:    { type: 'keyword' },

        // Fields that percolated documents are matched against.
        // Must be declared here so OpenSearch knows how to analyse them.
        text: { type: 'text', analyzer: 'standard' },
        did:  { type: 'keyword' },
      },
    },
    settings: {
      number_of_shards:   1,
      number_of_replicas: 1,
    },
  })
}

// ---------------------------------------------------------------------------
// Feed query CRUD
// ---------------------------------------------------------------------------

interface FeedQueryDoc {
  feedId:        string
  tier:          string
  terms:         string[]
  excludeTerms:  string[]
  seedAccounts:  string[]   // DIDs
}

/** Builds the bool query stored in the percolator for a feed config. */
function buildQuery(doc: FeedQueryDoc) {
  const termShoulds = doc.terms.map(t => ({
    match_phrase: { text: t },
  }))

  const seedShoulds = doc.seedAccounts.map(did => ({
    term: { did },
  }))

  const mustNots = doc.excludeTerms.map(t => ({
    match: { text: t },
  }))

  return {
    bool: {
      should:               [...termShoulds, ...seedShoulds],
      must_not:             mustNots,
      minimum_should_match: 1,
    },
  }
}

/**
 * Index (create or replace) the percolator document for a feed.
 * Called after feed create or config update.
 */
export async function indexFeedQuery(env: Env, doc: FeedQueryDoc): Promise<void> {
  if (!env.OPENSEARCH_URL) return

  await osRequest(env, 'PUT', `/${PERCOLATOR_INDEX}/_doc/${doc.feedId}`, {
    query:   buildQuery(doc),
    feed_id: doc.feedId,
    tier:    doc.tier,
  })
}

/**
 * Delete the percolator document for a feed.
 * Called on feed delete or when a feed is paused (so paused feeds stop matching).
 */
export async function deleteFeedQuery(env: Env, feedId: string): Promise<void> {
  if (!env.OPENSEARCH_URL) return

  await osRequest(env, 'DELETE', `/${PERCOLATOR_INDEX}/_doc/${feedId}`)
  // 404 is fine — the doc may not exist if OpenSearch was added after this feed
}

/**
 * Bulk-sync all active feed configs from D1 into the percolator index.
 * Used by /internal/percolator/sync — safe to call repeatedly (upsert semantics).
 */
export async function syncAllFeedQueries(
  env: Env,
  feeds: FeedQueryDoc[],
): Promise<{ synced: number; errors: number }> {
  if (!env.OPENSEARCH_URL) return { synced: 0, errors: 0 }

  await ensurePercolatorIndex(env)

  let synced = 0
  let errors = 0

  // Bulk API: pairs of action + document
  const bulkLines: string[] = []
  for (const feed of feeds) {
    bulkLines.push(JSON.stringify({ index: { _index: PERCOLATOR_INDEX, _id: feed.feedId } }))
    bulkLines.push(JSON.stringify({
      query:   buildQuery(feed),
      feed_id: feed.feedId,
      tier:    feed.tier,
    }))
  }

  if (bulkLines.length === 0) return { synced: 0, errors: 0 }

  const res = await fetch(`${env.OPENSEARCH_URL}/_bulk`, {
    method: 'POST',
    headers: { ...osHeaders(env), 'Content-Type': 'application/x-ndjson' },
    body: bulkLines.join('\n') + '\n',
  })

  if (!res.ok) {
    console.error('[opensearch] bulk sync failed', res.status)
    return { synced: 0, errors: feeds.length }
  }

  const result = await res.json() as { errors: boolean; items: Array<{ index: { status: number } }> }
  for (const item of result.items ?? []) {
    const status = item.index?.status ?? 500
    if (status >= 200 && status < 300) synced++
    else errors++
  }

  return { synced, errors }
}
