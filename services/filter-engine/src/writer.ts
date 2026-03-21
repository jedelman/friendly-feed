/**
 * D1 batch writer.
 * Buffers matched posts and flushes to D1 via the CF Worker config endpoint.
 *
 * D1 cannot be queried directly from Node — writes go through a CF Worker endpoint
 * that accepts batched inserts. This keeps the filter engine decoupled from CF internals.
 */

interface PostMatch {
  feedId: string
  postUri: string
  postCid: string
  authorDid: string
  indexedAt: number
  expiresAt: number
}

const WRITE_ENDPOINT = process.env.WRITE_ENDPOINT_URL
const WRITE_SECRET = process.env.WRITE_ENDPOINT_SECRET
const FLUSH_INTERVAL_MS = 2_000
const MAX_BATCH_SIZE = 100

let buffer: PostMatch[] = []

// Auto-flush on interval
setInterval(flush, FLUSH_INTERVAL_MS)

export async function batchWrite(matches: PostMatch[]): Promise<void> {
  buffer.push(...matches)
  if (buffer.length >= MAX_BATCH_SIZE) {
    await flush()
  }
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return
  const batch = buffer.splice(0, buffer.length)

  if (!WRITE_ENDPOINT) {
    // Dev mode: just log
    console.log(`[writer] would write ${batch.length} posts to D1`)
    return
  }

  try {
    const res = await fetch(WRITE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WRITE_SECRET}`,
      },
      body: JSON.stringify({ posts: batch }),
    })
    if (!res.ok) {
      console.error(`[writer] D1 write failed: ${res.status}`)
      // Re-queue on failure (bounded — don't re-queue indefinitely)
      if (batch.length < 500) buffer.unshift(...batch)
    }
  } catch (err) {
    console.error('[writer] fetch error:', err)
  }
}
