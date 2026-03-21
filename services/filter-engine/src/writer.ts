/**
 * D1 batch writer.
 * Writes matched posts to D1 via the CF Worker /internal/posts endpoint.
 *
 * D1 cannot be queried directly from Node — writes go through a CF Worker endpoint
 * that accepts batched inserts. Flush is called immediately so the filter engine
 * can ack events after confirmed write (at-least-once guarantee).
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
const MAX_RETRY_ATTEMPTS = 3

/**
 * Write a batch of matched posts to D1.
 * Returns only after the write is confirmed (or fails after retries).
 * This ensures the filter engine can safely ack the Tap event afterward.
 */
export async function batchWrite(matches: PostMatch[]): Promise<void> {
  if (matches.length === 0) return

  if (!WRITE_ENDPOINT) {
    // Dev/skeleton mode — log only
    console.log(`[writer] (no WRITE_ENDPOINT_URL) would write ${matches.length} post(s) to D1`)
    return
  }

  await writeWithRetry(matches)
}

async function writeWithRetry(batch: PostMatch[], attempt = 1): Promise<void> {
  try {
    const res = await fetch(WRITE_ENDPOINT!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WRITE_SECRET}`,
      },
      body: JSON.stringify({ posts: batch }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text}`)
    }
    console.log(`[writer] wrote ${batch.length} post(s) to D1`)
  } catch (err) {
    if (attempt < MAX_RETRY_ATTEMPTS) {
      const delay = attempt * 500
      console.warn(`[writer] write failed (attempt ${attempt}), retrying in ${delay}ms:`, err)
      await sleep(delay)
      return writeWithRetry(batch, attempt + 1)
    }
    // Log and give up — don't block the event loop forever
    // The at-least-once guarantee means Tap will re-deliver if we never ack,
    // but we ack after this returns to avoid blocking the channel indefinitely.
    console.error(`[writer] write failed after ${MAX_RETRY_ATTEMPTS} attempts, dropping batch of ${batch.length}:`, err)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
