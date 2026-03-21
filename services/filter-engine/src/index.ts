/**
 * Friendly Feed — Filter Engine
 *
 * Connects to Tap via @atproto/tap WebSocket client.
 * Loads feed configs from D1, matches incoming posts, writes matched URIs back to D1.
 *
 * Deploy alongside Tap container on Railway.
 *
 * Required env vars:
 *   TAP_URL                  - Tap HTTP base URL (e.g. http://tap.railway.internal:2480)
 *   TAP_ADMIN_PASSWORD       - matches TAP_ADMIN_PASSWORD on the Tap container
 *   CONFIG_ENDPOINT_URL      - CF Worker /internal/configs URL
 *   CONFIG_ENDPOINT_SECRET   - shared secret for internal Worker endpoints
 *   WRITE_ENDPOINT_URL       - CF Worker /internal/posts URL
 *   WRITE_ENDPOINT_SECRET    - shared secret for internal Worker endpoints
 */

import { Tap } from '@atproto/tap'
import { matchPost } from './matcher.js'
import { batchWrite } from './writer.js'
import type { FeedConfig } from '../../../packages/shared/src/types.js'

// Tap URL must be http:// — the client converts to ws:// internally for the channel
const TAP_URL = process.env.TAP_URL ?? 'http://localhost:2480'
const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD ?? ''
const CONFIG_POLL_INTERVAL_MS = 60_000

// In-memory config store — refreshed every 60s from D1 via CF Worker endpoint
let activeConfigs: FeedConfig[] = []

async function loadConfigs(): Promise<void> {
  const configUrl = process.env.CONFIG_ENDPOINT_URL
  if (!configUrl) {
    console.warn('[config] CONFIG_ENDPOINT_URL not set — running with empty config (skeleton mode)')
    return
  }
  try {
    const res = await fetch(configUrl, {
      headers: { Authorization: `Bearer ${process.env.CONFIG_ENDPOINT_SECRET}` },
    })
    if (!res.ok) {
      console.error(`[config] fetch failed: ${res.status} ${res.statusText}`)
      return
    }
    const body = await res.json() as { configs: FeedConfig[] }
    activeConfigs = body.configs ?? []
    console.log(`[config] loaded ${activeConfigs.length} active feed config(s)`)
  } catch (err) {
    console.error('[config] failed to load:', err)
  }
}

async function main(): Promise<void> {
  console.log(`[main] starting filter engine`)
  console.log(`[main] TAP_URL=${TAP_URL}`)

  // Initial config load
  await loadConfigs()

  // Poll for config changes every 60s
  setInterval(loadConfigs, CONFIG_POLL_INTERVAL_MS)

  const tap = new Tap(TAP_URL, { adminPassword: TAP_ADMIN_PASSWORD })

  // channel() returns a TapChannel; call .start() to begin the event loop (blocks)
  const channel = tap.channel({
    async onEvent(event, ctx) {
      // Only process post creates
      if (
        event.type !== 'record' ||
        event.action !== 'create' ||
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

      // Log in skeleton mode when no configs loaded
      if (activeConfigs.length === 0) {
        console.log(`[event] post by ${event.did} text="${record.text.slice(0, 80)}"`)
        await ctx.ack()
        return
      }

      const matches: Array<{
        feedId: string
        postUri: string
        postCid: string
        authorDid: string
        indexedAt: number
        expiresAt: number
      }> = []

      for (const config of activeConfigs) {
        if (matchPost(record.text, event.did, config)) {
          const ttl = getTtlMs(config.tierAtCreation)
          matches.push({
            feedId: config.feedId,
            postUri: `at://${event.did}/${event.collection}/${event.rkey}`,
            postCid: event.cid ?? '',
            authorDid: event.did,
            indexedAt: Date.now(),
            expiresAt: Date.now() + ttl,
          })
        }
      }

      if (matches.length > 0) {
        // Write to D1 before acking — ensures no posts lost on restart
        await batchWrite(matches)
        console.log(`[event] matched ${matches.length} feed(s) for post ${event.rkey}`)
      }

      // Ack only after confirmed write (or if no matches)
      await ctx.ack()
    },

    onError(err) {
      console.error('[tap] channel error:', err)
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

  console.log(`[main] connected to Tap at ${TAP_URL}, listening for app.bsky.feed.post events`)

  // start() runs the event loop — this blocks until shutdown
  await channel.start()
}

function getTtlMs(tier: string): number {
  switch (tier) {
    case 'pro':    return 30 * 86_400_000
    case 'studio': return 90 * 86_400_000
    default:       return 48 * 3_600_000
  }
}

main().catch((err) => {
  console.error('[main] fatal:', err)
  process.exit(1)
})
