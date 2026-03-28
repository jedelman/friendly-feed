/**
 * Friendly Feed — Filter Engine (percolator edition)
 *
 * Connects to Tap, and for each incoming post issues a single percolate
 * query to Amazon OpenSearch Service. OpenSearch returns every feed whose
 * stored query matches the post — no in-process fan-out, no config polling.
 *
 * Required env vars:
 *   TAP_URL                - Tap HTTP base URL  (e.g. http://tap.railway.internal:2480)
 *   TAP_ADMIN_PASSWORD     - matches TAP_ADMIN_PASSWORD on the Tap container
 *   OPENSEARCH_URL         - https://<collection-id>.<region>.aoss.amazonaws.com
 *   AWS_ACCESS_KEY_ID      - IAM user access key (service = aoss)
 *   AWS_SECRET_ACCESS_KEY  - IAM user secret key
 *   AWS_REGION             - e.g. us-east-1
 *   WRITE_ENDPOINT_URL     - CF Worker /internal/posts URL
 *   WRITE_ENDPOINT_SECRET  - shared secret (INTERNAL_SECRET on the Worker)
 */

import aws4 from 'aws4'
import { Tap } from '@atproto/tap'
import { batchWrite } from './writer.js'

const TAP_URL            = process.env.TAP_URL            ?? 'http://localhost:2480'
const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD ?? ''
const OPENSEARCH_URL     = process.env.OPENSEARCH_URL     ?? ''
const AWS_ACCESS_KEY_ID  = process.env.AWS_ACCESS_KEY_ID  ?? ''
const AWS_SECRET_KEY     = process.env.AWS_SECRET_ACCESS_KEY ?? ''
const AWS_REGION         = process.env.AWS_REGION         ?? 'us-east-1'
const PERCOLATOR_INDEX   = 'ff_feed_queries'

// TTL by tier — mirrors the CF Worker's getTtlMs
const TTL_MS: Record<string, number> = {
  pro:    30 * 86_400_000,
  studio: 90 * 86_400_000,
  free:   48 * 3_600_000,
}

// ---------------------------------------------------------------------------
// OpenSearch percolate
// ---------------------------------------------------------------------------

interface PercolateHit {
  _id:    string   // feed_id
  _source: { feed_id: string; tier: string }
}

/**
 * Percolate a single post document against all stored feed queries.
 * Returns the list of matching { feedId, tier } pairs.
 */
async function percolate(
  text: string,
  did: string,
): Promise<Array<{ feedId: string; tier: string }>> {
  const path   = `/${PERCOLATOR_INDEX}/_search`
  const parsed = new URL(`${OPENSEARCH_URL}${path}`)
  const body   = JSON.stringify({
    query: {
      percolate: {
        field:    'query',
        document: { text, did },
      },
    },
    _source: ['feed_id', 'tier'],
    size:    1000,   // max feeds that can match a single post
  })

  const signed = aws4.sign(
    {
      host:    parsed.hostname,
      path:    parsed.pathname,
      method:  'POST',
      service: 'aoss',
      region:  AWS_REGION,
      body,
      headers: { 'Content-Type': 'application/json' },
    },
    { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_KEY },
  )

  const res = await fetch(`${OPENSEARCH_URL}${path}`, {
    method:  'POST',
    headers: signed.headers as HeadersInit,
    body,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenSearch ${res.status}: ${body.slice(0, 200)}`)
  }

  const data = await res.json() as { hits: { hits: PercolateHit[] } }
  return (data.hits?.hits ?? []).map(h => ({
    feedId: h._source.feed_id,
    tier:   h._source.tier ?? 'free',
  }))
}

// ---------------------------------------------------------------------------
// Startup: verify OpenSearch connectivity and index exists
// ---------------------------------------------------------------------------

async function checkOpenSearch(): Promise<void> {
  if (!OPENSEARCH_URL) {
    throw new Error('OPENSEARCH_URL is not set')
  }

  const path   = `/${PERCOLATOR_INDEX}`
  const parsed = new URL(`${OPENSEARCH_URL}${path}`)
  const signed = aws4.sign(
    {
      host:    parsed.hostname,
      path:    parsed.pathname,
      method:  'HEAD',
      service: 'aoss',
      region:  AWS_REGION,
    },
    { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_KEY },
  )

  const res = await fetch(`${OPENSEARCH_URL}${path}`, {
    method:  'HEAD',
    headers: signed.headers as HeadersInit,
  })

  if (res.status === 404) {
    throw new Error(
      `Percolator index "${PERCOLATOR_INDEX}" does not exist. ` +
      `Run POST /internal/percolator/sync on the CF Worker first.`
    )
  }
  if (!res.ok && res.status !== 405) {
    throw new Error(`OpenSearch health check failed: ${res.status}`)
  }

  console.log(`[opensearch] percolator index "${PERCOLATOR_INDEX}" is ready`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[main] starting filter engine (percolator mode)')
  console.log(`[main] TAP_URL=${TAP_URL}`)
  console.log(`[main] OPENSEARCH_URL=${OPENSEARCH_URL}`)

  await checkOpenSearch()

  const tap = new Tap(TAP_URL, { adminPassword: TAP_ADMIN_PASSWORD })

  const channel = tap.channel({
    async onEvent(event, ctx) {
      // Only process post creates
      if (
        event.type       !== 'record' ||
        event.action     !== 'create' ||
        event.collection !== 'app.bsky.feed.post'
      ) {
        await ctx.ack()
        return
      }

      const record = event.record as { text?: string } | undefined
      if (!record?.text) {
        await ctx.ack()
        return
      }

      let matches: Array<{ feedId: string; tier: string }>
      try {
        matches = await percolate(record.text, event.did)
      } catch (e) {
        // Log and ack — don't block the channel on a transient OS error.
        // The post is lost for these feeds but Tap's at-least-once guarantee
        // only covers the Tap → filter-engine leg, not the OS leg.
        console.error('[percolate] error, skipping post:', e)
        await ctx.ack()
        return
      }

      if (matches.length > 0) {
        const now = Date.now()
        const postUri = `at://${event.did}/${event.collection}/${event.rkey}`

        const writes = matches.map(({ feedId, tier }) => ({
          feedId,
          postUri,
          postCid:   event.cid ?? '',
          authorDid: event.did,
          indexedAt: now,
          expiresAt: now + (TTL_MS[tier] ?? TTL_MS.free),
        }))

        // Write to D1 before acking — at-least-once guarantee
        await batchWrite(writes)
        console.log(`[event] matched ${matches.length} feed(s) for post ${event.rkey}`)
      }

      await ctx.ack()
    },

    onError(e) {
      console.error('[tap] channel error:', e)
    },
  })

  // Graceful shutdown
  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('[main] shutting down...')
    await channel.destroy()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  console.log(`[main] listening for app.bsky.feed.post events`)
  await channel.start()
}

main().catch(e => {
  console.error('[main] fatal:', e)
  process.exit(1)
})
