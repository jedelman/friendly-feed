/** Shared Env interface and core types for the Worker. */

export interface Env {
  DB: D1Database
  SERVICE_DID: string

  // Auth secrets — set via `wrangler secret put`
  INTERNAL_SECRET: string   // filter engine ↔ worker
  ADMIN_SECRET: string      // admin dashboard

  // Claude API — set via `wrangler secret put ANTHROPIC_API_KEY`
  ANTHROPIC_API_KEY: string

  // OpenSearch / Palomar — optional; preview falls back to Bluesky search if unset
  OPENSEARCH_URL: string       // e.g. https://my-cluster.us-east-1.es.amazonaws.com
  OPENSEARCH_USERNAME: string
  OPENSEARCH_PASSWORD: string
}

export interface FeedRow {
  feed_id: string
  owner_did: string
  name: string
  description: string
  intent_text: string
  terms: string          // JSON
  exclude_terms: string  // JSON
  seed_accounts: string  // JSON
  active: number
  created_at: number
  updated_at: number
  tier_at_creation: string
}

export function feedRowToConfig(r: FeedRow) {
  return {
    feedId:          r.feed_id,
    ownerDid:        r.owner_did,
    name:            r.name,
    description:     r.description ?? '',
    intentText:      r.intent_text,
    terms:           JSON.parse(r.terms)         as string[],
    excludeTerms:    JSON.parse(r.exclude_terms) as string[],
    seedAccounts:    JSON.parse(r.seed_accounts) as string[],
    active:          Boolean(r.active),
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
    tierAtCreation:  r.tier_at_creation,
  }
}

export const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export const JSON_HEADERS = { 'Content-Type': 'application/json', ...CORS }

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
}

export function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}
