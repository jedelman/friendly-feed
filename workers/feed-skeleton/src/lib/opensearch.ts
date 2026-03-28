/**
 * OpenSearch percolator helpers — Amazon OpenSearch Serverless edition.
 *
 * Auth: AWS SigV4 via aws4fetch (service = 'aoss').
 * OpenSearch Serverless endpoints look like:
 *   https://<collection-id>.<region>.aoss.amazonaws.com
 *
 * Serverless differences vs. provisioned:
 *  - No username/password — IAM credentials only (SigV4)
 *  - number_of_shards / number_of_replicas are managed automatically; omit them
 *  - HEAD on an index returns 404 if it doesn't exist (same as provisioned)
 *
 * Index: ff_feed_queries
 * ──────────────────────
 * Mapping:
 *   query   percolator   ← stores the bool query DSL per feed
 *   feed_id keyword      ← returned with each match
 *   tier    keyword      ← used by filter engine to compute TTL
 *   text    text         ← field percolated documents are matched against
 *   did     keyword      ← author DID field for seed-account term queries
 *
 * Percolate document shape (one per incoming post):
 *   { "text": "<post text>", "did": "<author DID>" }
 */

import { AwsClient } from 'aws4fetch'
import type { Env } from '../types'

export const PERCOLATOR_INDEX = 'ff_feed_queries'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId:     env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region:          env.AWS_REGION ?? 'us-east-1',
    service:         'aoss',
  })
}

async function osReq(
  env: Env,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const url  = `${env.OPENSEARCH_URL}${path}`
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const res  = await client(env).fetch(url, init)
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

// ---------------------------------------------------------------------------
// Index bootstrap
// ---------------------------------------------------------------------------

export async function ensurePercolatorIndex(env: Env): Promise<void> {
  if (!env.OPENSEARCH_URL) return

  const url  = `${env.OPENSEARCH_URL}/${PERCOLATOR_INDEX}`
  const head = await client(env).fetch(url, { method: 'HEAD' })
  if (head.status === 200) return   // already exists

  // Serverless: omit number_of_shards / number_of_replicas (auto-managed)
  await osReq(env, 'PUT', `/${PERCOLATOR_INDEX}`, {
    mappings: {
      properties: {
        query:   { type: 'percolator' },
        feed_id: { type: 'keyword' },
        tier:    { type: 'keyword' },
        // Document fields — must be declared so OpenSearch can analyse them
        // during percolation
        text: { type: 'text', analyzer: 'standard' },
        did:  { type: 'keyword' },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Feed query CRUD
// ---------------------------------------------------------------------------

interface FeedQueryDoc {
  feedId:       string
  tier:         string
  terms:        string[]
  excludeTerms: string[]
  seedAccounts: string[]   // DIDs
}

function buildQuery(doc: FeedQueryDoc) {
  const termShoulds = doc.terms.map(t => ({ match_phrase: { text: t } }))
  const seedShoulds = doc.seedAccounts.map(did => ({ term: { did } }))
  const mustNots    = doc.excludeTerms.map(t => ({ match: { text: t } }))
  return {
    bool: {
      should:               [...termShoulds, ...seedShoulds],
      must_not:             mustNots,
      minimum_should_match: 1,
    },
  }
}

export async function indexFeedQuery(env: Env, doc: FeedQueryDoc): Promise<void> {
  if (!env.OPENSEARCH_URL) return
  await osReq(env, 'PUT', `/${PERCOLATOR_INDEX}/_doc/${doc.feedId}`, {
    query:   buildQuery(doc),
    feed_id: doc.feedId,
    tier:    doc.tier,
  })
}

export async function deleteFeedQuery(env: Env, feedId: string): Promise<void> {
  if (!env.OPENSEARCH_URL) return
  await osReq(env, 'DELETE', `/${PERCOLATOR_INDEX}/_doc/${feedId}`)
  // 404 is fine
}

export async function syncAllFeedQueries(
  env: Env,
  feeds: FeedQueryDoc[],
): Promise<{ synced: number; errors: number }> {
  if (!env.OPENSEARCH_URL) return { synced: 0, errors: 0 }

  await ensurePercolatorIndex(env)
  if (feeds.length === 0) return { synced: 0, errors: 0 }

  const lines: string[] = []
  for (const feed of feeds) {
    lines.push(JSON.stringify({ index: { _index: PERCOLATOR_INDEX, _id: feed.feedId } }))
    lines.push(JSON.stringify({
      query:   buildQuery(feed),
      feed_id: feed.feedId,
      tier:    feed.tier,
    }))
  }

  const url = `${env.OPENSEARCH_URL}/_bulk`
  const res = await client(env).fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body:    lines.join('\n') + '\n',
  })

  if (!res.ok) {
    console.error('[opensearch] bulk sync failed', res.status)
    return { synced: 0, errors: feeds.length }
  }

  const result = await res.json() as {
    errors: boolean
    items: Array<{ index: { status: number } }>
  }

  let synced = 0, errors = 0
  for (const item of result.items ?? []) {
    const s = item.index?.status ?? 500
    if (s >= 200 && s < 300) synced++; else errors++
  }
  return { synced, errors }
}
