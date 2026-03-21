/**
 * Friendly Feed — Filter Engine
 *
 * Connects to Tap via @atproto/tap WebSocket client.
 * Loads feed configs from D1, matches incoming posts, writes matched URIs back to D1.
 *
 * Deploy alongside Tap container on Railway.
 */

import { Tap } from '@atproto/tap'
import { matchPost } from './matcher.js'
import { batchWrite } from './writer.js'
import type { FeedConfig } from '../../../packages/shared/src/types.js'

const TAP_URL = process.env.TAP_URL ?? 'ws://localhost:2480'
const TAP_ADMIN_PASSWORD = process.env.TAP_ADMIN_PASSWORD ?? ''
const CONFIG_POLL_INTERVAL_MS = 60_000

// In-memory config store — refreshed every 60s from D1
let activeConfigs: FeedConfig[] = []

async function loadConfigs(): Promise<void> {
  // TODO: replace with actual D1 REST fetch
  // D1 is not directly queryable from Node without CF Workers binding
  // Options: (a) expose a lightweight config endpoint from the CF Worker
  //          (b) use D1 HTTP API directly
  //          (c) maintain a separate lightweight config store (KV or postgres)
  // For MVP: poll a CF Worker endpoint that returns active feed configs as JSON
  const configUrl = process.env.CONFIG_ENDPOINT_URL
  if (!configUrl) {
    console.warn('CONFIG_ENDPOINT_URL not set — using empty config')
    return
  }
  try {
    const res = await fetch(configUrl, {
      headers: { Authorization: `Bearer ${process.env.CONFIG_ENDPOINT_SECRET}` },
    })
    activeConfigs = await res.json() as FeedConfig[]
    console.log(`Loaded ${activeConfigs.length} active feed configs`)
  } catch (err) {
    console.error('Failed to load configs:', err)
  }
}

async function main(): Promise<void> {
  // Initial config load
  await loadConfigs()

  // Poll for config changes
  setInterval(loadConfigs, CONFIG_POLL_INTERVAL_MS)

  const tap = new Tap(TAP_URL, {
    adminPassword: TAP_ADMIN_PASSWORD,
  })

  const channel = tap.channel(async (event) => {
    // We only care about post creates
    if (
      event.type !== 'record' ||
      event.action !== 'create' ||
      event.collection !== 'app.bsky.feed.post'
    ) {
      return
    }

    const record = event.record as { text?: string } | undefined
    if (!record?.text) return

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
      await batchWrite(matches)
    }
  })

  console.log(`Filter engine connected to Tap at ${TAP_URL}`)
  console.log('Listening for app.bsky.feed.post events...')

  // Keep alive
  process.on('SIGTERM', () => {
    channel.close()
    process.exit(0)
  })
}

function getTtlMs(tier: string): number {
  switch (tier) {
    case 'pro':    return 30 * 86_400_000
    case 'studio': return 90 * 86_400_000
    default:       return 48 * 3_600_000
  }
}

main().catch(console.error)
