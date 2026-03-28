/**
 * GET /api/preview?terms=a,b&excludeTerms=x,y&seeds=did1,did2
 *
 * Returns ~25 recent Bluesky posts matching the proposed feed config.
 *
 * Strategy:
 *   1. If OPENSEARCH_URL is configured, query the local palomar index.
 *   2. Otherwise fall back to Bluesky's public searchPosts API.
 *
 * The Bluesky fallback is sufficient for MVP and requires no infrastructure.
 */

import { AwsClient } from 'aws4fetch'
import { type Env, json, err } from '../types'

const BSKY_API      = 'https://public.api.bsky.app/xrpc'
const PREVIEW_LIMIT = 25

interface BskyPost {
  uri:    string
  cid:    string
  author: { did: string; handle: string; displayName?: string; avatar?: string }
  record: { text: string; createdAt: string }
  likeCount?:   number
  replyCount?:  number
  indexedAt:    string
}

interface PreviewPost {
  uri:                string
  cid:                string
  authorDid:          string
  authorHandle:       string
  authorDisplayName?: string
  authorAvatar?:      string
  text:               string
  indexedAt:          string
  likeCount?:         number
  replyCount?:        number
}

export async function handlePreview(req: Request, env: Env): Promise<Response> {
  const url          = new URL(req.url)
  const termsRaw     = url.searchParams.get('terms') ?? ''
  const excludeRaw   = url.searchParams.get('excludeTerms') ?? ''
  const seedsRaw     = url.searchParams.get('seeds') ?? ''

  const terms        = termsRaw.split(',').map(t => t.trim()).filter(Boolean)
  const excludeTerms = excludeRaw.split(',').map(t => t.trim()).filter(Boolean)
  const seeds        = seedsRaw.split(',').map(s => s.trim()).filter(Boolean)

  if (terms.length === 0 && seeds.length === 0) {
    return err('at least one term or seed account required')
  }

  if (env.OPENSEARCH_URL) {
    return previewFromOpenSearch(env, terms, excludeTerms, seeds)
  }

  return previewFromBlueskySarch(terms, excludeTerms, seeds)
}

// ---------------------------------------------------------------------------
// Bluesky public search fallback
// ---------------------------------------------------------------------------

async function previewFromBlueskySarch(
  terms: string[],
  excludeTerms: string[],
  seeds: string[],
): Promise<Response> {
  // Build a query_string: top terms joined with OR, exclude terms negated
  const includeClause = terms.slice(0, 6).map(t => `"${t}"`).join(' OR ')
  const excludeClause = excludeTerms.slice(0, 4).map(t => `-"${t}"`).join(' ')
  const q = [includeClause, excludeClause].filter(Boolean).join(' ').trim()

  if (!q) return json({ posts: [] })

  const postMap = new Map<string, PreviewPost>()

  // Fetch term-matched posts
  try {
    const res = await fetch(
      `${BSKY_API}/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=${PREVIEW_LIMIT}`
    )
    if (res.ok) {
      const data = await res.json() as { posts: BskyPost[] }
      for (const p of data.posts ?? []) {
        if (!postMap.has(p.uri)) postMap.set(p.uri, transformPost(p))
      }
    }
  } catch (e) {
    console.error('[preview] Bluesky search error', e)
  }

  // Fetch seed account posts (up to 3 seeds, 5 posts each)
  for (const did of seeds.slice(0, 3)) {
    try {
      const res = await fetch(
        `${BSKY_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}&limit=5&filter=posts_no_replies`
      )
      if (!res.ok) continue
      const data = await res.json() as { feed: Array<{ post: BskyPost }> }
      for (const { post: p } of data.feed ?? []) {
        if (postMap.size >= PREVIEW_LIMIT * 1.5) break
        if (!postMap.has(p.uri)) postMap.set(p.uri, transformPost(p))
      }
    } catch {
      // skip this seed
    }
  }

  // Filter out posts containing exclude terms (client-side sanity pass)
  const posts = [...postMap.values()]
    .filter(p => {
      const lower = p.text.toLowerCase()
      return !excludeTerms.some(ex => lower.includes(ex.toLowerCase()))
    })
    .slice(0, PREVIEW_LIMIT)

  return json({ posts })
}

// ---------------------------------------------------------------------------
// OpenSearch / Palomar query
// ---------------------------------------------------------------------------

async function previewFromOpenSearch(
  env: Env,
  terms: string[],
  excludeTerms: string[],
  seeds: string[],
): Promise<Response> {
  const termShoulds = terms.map(t => ({ match: { text: { query: t, operator: 'and' } } }))
  const seedShoulds = seeds.map(did => ({ term: { did } }))

  const mustNots = excludeTerms.map(t => ({
    match: { text: { query: t } },
  }))

  const query = {
    query: {
      bool: {
        should:   [...termShoulds, ...seedShoulds],
        must_not: mustNots,
        minimum_should_match: 1,
      },
    },
    sort:   [{ created_at: { order: 'desc' } }],
    size:   PREVIEW_LIMIT,
    _source: ['did', 'text', 'created_at', 'handle', 'rkey'],
  }

  const aws = new AwsClient({
    accessKeyId:     env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region:          env.AWS_REGION ?? 'us-east-1',
    service:         'aoss',
  })
  const res = await aws.fetch(`${env.OPENSEARCH_URL}/palomar_post/_search`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(query),
  })

  if (!res.ok) {
    console.error('[preview] OpenSearch error', res.status, await res.text())
    return err('Search index query failed', 502)
  }

  const data = await res.json() as {
    hits: { hits: Array<{ _source: { did: string; text: string; created_at: string; handle?: string; rkey: string } }> }
  }

  const posts: PreviewPost[] = data.hits.hits.map(h => ({
    uri:          `at://${h._source.did}/app.bsky.feed.post/${h._source.rkey}`,
    cid:          '',
    authorDid:    h._source.did,
    authorHandle: h._source.handle ?? h._source.did,
    text:         h._source.text,
    indexedAt:    h._source.created_at,
  }))

  return json({ posts })
}

// ---------------------------------------------------------------------------

function transformPost(p: BskyPost): PreviewPost {
  return {
    uri:                p.uri,
    cid:                p.cid,
    authorDid:          p.author.did,
    authorHandle:       p.author.handle,
    authorDisplayName:  p.author.displayName,
    authorAvatar:       p.author.avatar,
    text:               p.record?.text ?? '',
    indexedAt:          p.indexedAt,
    likeCount:          p.likeCount,
    replyCount:         p.replyCount,
  }
}
