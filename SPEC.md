# Friendly Feed — Product & Technical Specification

**Status:** Pre-build  
**Last updated:** 2026-03-21  
**Authors:** Jason Edelman, Claude (Anthropic)

---

## What This Is

A freemium SaaS that lets any Bluesky user build a personalized custom feed using plain language — no keywords, no regex, no configuration UI. Users describe what they want to read; an agent builds the feed. The feed runs natively in Bluesky.

**Origin:** Faine Greenwood / Paris Marx thread on Bluesky (March 2026) identifying the gap between what custom feeds could do for ordinary users and what existing tools (SkyFeed, Bluesky Feed Creator) actually deliver.

**Core insight:** Feed Creator owns community feed operators. The open territory is personal feed intelligence — individuals who want Bluesky to feel like it knows what they care about, without becoming a feed engineer.

---

## Problem Statement

Bluesky's custom feed system is powerful but inaccessible. Two existing tools:

- **SkyFeed** (skyfeed.app): Regex-based, Flutter/Dart, solo dev, donations-only funding, reliability issues, effectively in maintenance mode as of 2024.
- **Bluesky Feed Creator** (blueskyfeedcreator.com): Better UX, solid freemium model ($0/$2.99/$9.99), but still keyword-first, community-operator focused, no agentic capability, no feedback loop on feed quality.

Neither tool answers: *"I want posts about urban planning from a social justice angle — not think-tank stuff."* Users can't translate intent into keyword configs. The agent does that translation.

---

## Differentiation

| Capability | SkyFeed | Feed Creator | Friendly Feed |
|---|---|---|---|
| No-code setup | Partial | Yes | Yes |
| Plain language intent | No | No | **Yes** |
| Agentic feed generation | No | No | **Yes** |
| HITL quality loop | No | No | **Yes** |
| Feed quality improves over time | No | No | **Yes** |
| Agent skill / API | No | No | **Yes (Studio)** |
| Reliability | Poor | Good | Target: excellent |
| Business model | Donations | Freemium | **Freemium + metered** |

The HITL (human-in-the-loop) thumbs-up/down data collected during feed creation and refinement is a compounding data asset — labeled training data mapping intent descriptions to feed quality signals. No competitor can replicate this without rebuilding their entire product interaction model.

---

## Architecture

```
[AT Protocol Relay — bsky.network]
         ↓ firehose (Sync v1.1, authenticated)
[Railway: Tap container]
  ghcr.io/bluesky-social/indigo/tap:latest
  port 2480, TAP_ADMIN_PASSWORD set
         ↓ WebSocket + acks (@atproto/tap)
[Railway: Filter Engine — TypeScript/Node]
  - Reads feed configs from D1 on startup + poll
  - Matches incoming RecordEvents against per-feed rules
  - Batches matched post URIs → writes to D1
         ↓ D1 binding (via CF Worker or REST)
[Cloudflare D1 — storage layer]
  - Table: feed_configs (feed rules per user)
  - Table: feed_posts (matched post URIs per feed, TTL'd)
  - Table: users (account, tier, usage counters)
  - Table: hitl_events (thumbs up/down per post per feed — the data asset)
         ↑ read on every feed open
[Cloudflare Worker — getFeedSkeleton]
  - Implements app.bsky.feed.getFeedSkeleton lexicon
  - Bluesky AppView calls this when user opens their feed
  - Reads feed_posts from D1, returns post URI list
  - Enforces view caps per tier
         ↑ called by Bluesky AppView
[Bluesky — user opens feed natively]

[Feed Builder UI — apps/builder/]
  - Plain HTML/CSS, no framework
  - Connects Bluesky account (app password, MVP)
  - Natural language input → agent generates feed config
  - Preview posts → HITL thumbs up/down
  - Publishes feed (registers under service DID, MVP)
  - Post-publish: weekly agent suggestions based on HITL data

[Agent — Claude API (claude-sonnet-4-6)]
  - Called at feed creation: description → config
  - Searches Bluesky for relevant accounts
  - Proposes: terms, seed accounts, exclusions
  - Refines based on HITL feedback before publish
  - Weekly: analyzes feed drift, suggests tuning
```

### Key architectural decisions

**Tap over Jetstream:** Tap provides authenticated sync, cryptographic verification, automatic backfill, and at-least-once delivery. For a production feed service where reliability is the moat, Tap is correct. Jetstream is simpler but unauthenticated and not formally part of the protocol.

**Railway for Tap + Filter Engine:** Tap requires a persistent process consuming the firehose 24/7. Railway provides Docker container hosting with usage-based pricing. The Tap+Filter Engine is largely fixed cost (~$110-130/mo) regardless of user count up to ~5K users.

**Cloudflare D1 + Workers for serving:** Serverless, global edge, no egress charges, scale-to-zero billing. Feed skeleton serving is read-heavy and latency-sensitive — D1 with read replication is well-suited.

**Service DID for MVP feed registration:** All feeds published under a single service DID initially. Per-user DID registration (feeds truly owned by the user in the AT Protocol sense) requires AT Proto OAuth, which is still maturing. Build the migration path in from the start.

---

## Data Schema

See `packages/shared/src/schema.sql` for full DDL.

### Core tables

```sql
-- User accounts
users (
  did TEXT PRIMARY KEY,         -- Bluesky DID
  handle TEXT,
  tier TEXT DEFAULT 'free',     -- free | pro | studio
  created_at INTEGER,
  feeds_count INTEGER DEFAULT 0,
  monthly_views INTEGER DEFAULT 0,
  view_reset_at INTEGER
)

-- Feed configurations
feed_configs (
  feed_id TEXT PRIMARY KEY,     -- nanoid, used in AT URI
  owner_did TEXT,
  name TEXT,
  description TEXT,
  intent_text TEXT,             -- original natural language description (preserved)
  terms JSON,                   -- include terms array
  exclude_terms JSON,           -- exclude terms array
  seed_accounts JSON,           -- prioritized DIDs
  active BOOLEAN DEFAULT true,
  created_at INTEGER,
  updated_at INTEGER,
  tier_at_creation TEXT
)

-- Matched post URIs per feed (the feed content)
feed_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id TEXT,
  post_uri TEXT,                -- at://did:plc:.../app.bsky.feed.post/rkey
  post_cid TEXT,
  author_did TEXT,
  indexed_at INTEGER,           -- firehose timestamp
  expires_at INTEGER            -- TTL: 48h free, 30d pro, 90d studio
)

-- HITL training data — the compounding asset
hitl_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id TEXT,
  post_uri TEXT,
  signal INTEGER,               -- 1 = thumbs up, -1 = thumbs down
  session_type TEXT,            -- 'creation' | 'refinement' | 'weekly_review'
  created_at INTEGER
)

-- View tracking for cap enforcement
view_events (
  feed_id TEXT,
  owner_did TEXT,
  day INTEGER,                  -- unix day bucket
  view_count INTEGER,
  PRIMARY KEY (feed_id, day)
)
```

---

## Services

### `services/tap/`

Docker Compose wrapper around the official Tap image. Configuration via environment variables.

```yaml
# docker-compose.yml (see file for full config)
image: ghcr.io/bluesky-social/indigo/tap:latest
environment:
  TAP_ADMIN_PASSWORD: ${TAP_ADMIN_PASSWORD}
  TAP_RELAY_HOST: wss://bsky.network
  TAP_LOG_LEVEL: info
ports:
  - "2480:2480"
```

Tap does not need to track specific repos for this use case — we consume the full `app.bsky.feed.post` collection stream and filter in the engine. Do NOT set `TAP_FULL_NETWORK=true` (terabytes of data). Filter by collection only.

### `services/filter-engine/`

TypeScript/Node process. Connects to Tap via `@atproto/tap` WebSocket client.

Responsibilities:
- On startup: load all active feed configs from D1
- Poll D1 for config changes every 60s (new feeds, updated rules)
- For each incoming `RecordEvent` where `collection === 'app.bsky.feed.post'`:
  - Run the post text against all active feed configs
  - Batch matched URIs → bulk INSERT to D1 `feed_posts`
  - Apply TTL based on feed owner's tier
- Ack each event after D1 write confirmed

Key files:
- `src/index.ts` — Tap connection, event loop, config polling
- `src/matcher.ts` — term matching logic (include/exclude/seed account boost)
- `src/writer.ts` — D1 batch write with retry

### `workers/feed-skeleton/`

Cloudflare Worker. Implements the AT Protocol feed generator lexicon.

Entry point: `GET /xrpc/app.bsky.feed.getFeedSkeleton?feed=<uri>&cursor=<cursor>&limit=<n>`

Responsibilities:
- Validate feed URI → look up feed_id
- Enforce view cap (check + increment view_events)
- Query feed_posts ordered by indexed_at DESC with cursor pagination
- Return `{ feed: [{post: uri}], cursor: ... }`
- Return HTTP 401 if feed is paused/deactivated
- Register feed generator DID via `/.well-known/did.json`

### `apps/builder/`

Plain HTML/CSS/vanilla JS. No framework. Consistent with Jason's existing project style.

Pages:
- `/` — landing + connect Bluesky account
- `/create` — natural language input + agent preview + HITL
- `/dashboard` — feed list, view stats, agent suggestions
- `/feed/:id` — individual feed management

The agent call happens client-side via a thin API route (CF Worker or Railway endpoint) that proxies to the Anthropic API. The API key never reaches the browser.

---

## Agent Design

### Feed generation prompt (high level)

```
Given a user's intent description and their Bluesky follow graph,
generate a feed configuration:
- 5-20 include terms (keywords, hashtags, phrases)
- 3-10 exclude terms (noise reduction)
- Up to 20 seed accounts (prioritize posts from these DIDs)

Return JSON. No preamble.

User intent: "{description}"
Follow graph sample: [{did, handle, description}...]
```

### HITL loop

Preview shows 20 sample posts the feed would capture (pulled from recent firehose via Tap query or Bluesky search API). User thumbs up/down each. Agent receives the signal distribution and refines config before publish.

Each thumbs event logged to `hitl_events` with `session_type='creation'`.

### Weekly refinement (Pro+)

Cron job (CF Worker cron trigger) runs weekly per active Pro/Studio feed:
- Pull last 7 days of hitl_events for the feed
- Pull feed_configs current state
- Call agent with: current config + HITL signals + "what's drifted?"
- Generate suggested config delta
- Push notification to user via Bluesky DM or dashboard

---

## Pricing & Tiers

| | Free | Pro | Studio |
|---|---|---|---|
| Price | $0 | $8/mo | $24/mo |
| Active feeds | 1 | 10 | Unlimited |
| Agentic creation | 1 lifetime | Unlimited | Unlimited |
| HITL refinement | Creation only | Ongoing | Ongoing |
| Post retention | 48h | 30d | 90d |
| Monthly views included | 50K | 500K | 2M |
| View overage | Feed pauses | $0.50/M | $0.50/M |
| Weekly agent suggestions | No | Yes | Yes |
| Agent skill API access | No | No | Yes |
| Feed registration | Service DID | Service DID | Own DID (when AT OAuth stable) |

### Cost model

Fixed infra: ~$130/mo (Railway Tap + filter engine + CF Workers base)  
Marginal cost per user/month: ~$0.14 at 1K users, ~$0.055 at 5K  
Marginal cost per million views served: ~$0.30 (CF Workers overages)  
Break-even: **25 Pro subscribers**

### Overage model

View caps enforced in the feed-skeleton Worker. At cap:
- Free: feed returns empty skeleton (paused appearance in Bluesky)
- Pro/Studio with auto-charge ON: continues serving, bills $0.50/M
- Pro/Studio with auto-charge OFF: pauses like Free, sends notification

---

## Spam & Abuse Prevention

### At account creation
- Require connected Bluesky account with verifiable history
- Free tier: 1 feed per connected DID — eliminates bulk creation

### At feed creation (pre-publish checks)
- Seed account concentration check: flag if >60% of suggested accounts are <30 days old or <10 followers
- Term pattern matching against known spam/coordinated campaign clusters
- Follow graph entropy check: does the user's graph look organic?
- Flagged feeds → hold for async review before publishing

### At runtime
- Kill switch: single D1 write to `feed_configs.active = false` immediately stops serving
- Filter engine polls config every 60s — feed goes dark within one polling cycle
- View velocity anomaly: sudden 10x spike in views triggers alert

### HITL as spam signal
- Feeds with zero HITL engagement during creation (no thumbs at all) flagged for review
- Feeds where all thumbs-up concentrate on 3-5 specific accounts → coordinated amplification signal

---

## Anti-Patterns / Known Risks

**Bluesky ships a native feed builder:** The basic keyword layer could be commoditized within 12-18 months. The agentic HITL loop is the hedge — Bluesky won't build a training data pipeline into their core product. Invest early in the data asset.

**Railway cost spike on viral feeds:** The filter engine cost is largely fixed; the CF serving cost scales at ~$0.30/M views. Monitor view velocity and auto-notify at 80% of tier cap.

**AT Protocol instability:** The protocol is still maturing (Sync v1.1 rollout ongoing, OAuth in progress). Tap abstracts most of this. Stay on the official Tap image, don't fork it.

**Single-tenant Tap:** Tap is described as single-tenant by design. If the filter engine goes down, Tap buffers up to 1M events in memory. The filter engine must ack events only after D1 write — this ensures no posts are lost across restarts.

---

## Repository Structure

```
friendly-feed/
├── SPEC.md                          # This file
├── README.md                        # Setup and deployment guide (TODO)
├── apps/
│   └── builder/                     # Feed builder UI
│       ├── src/
│       │   ├── index.html
│       │   ├── app.js
│       │   └── style.css
│       └── public/
├── services/
│   ├── tap/                         # Tap Docker config
│   │   └── docker-compose.yml
│   └── filter-engine/               # Firehose consumer + D1 writer
│       └── src/
│           ├── index.ts             # Entry point, Tap connection
│           ├── matcher.ts           # Feed config matching logic
│           └── writer.ts            # D1 batch writes
├── workers/
│   └── feed-skeleton/               # CF Worker: getFeedSkeleton
│       ├── src/
│       │   └── index.ts
│       └── wrangler.toml
├── packages/
│   └── shared/                      # Types and schema shared across services
│       └── src/
│           ├── types.ts             # FeedConfig, FeedPost, User, HitlEvent
│           └── schema.sql           # D1 DDL
├── docs/                            # Architecture diagrams, decisions
└── scripts/                         # DB migration, feed registration helpers
```

---

## Build Order

1. **Schema + types** (`packages/shared/`) — define the data model, write DDL
2. **Tap container** (`services/tap/`) — get it running on Railway, verify firehose connection
3. **Filter engine skeleton** (`services/filter-engine/`) — connect to Tap, log events, no matching yet
4. **D1 setup** — create database via wrangler, run migrations
5. **Filter engine matching** — implement matcher.ts against hardcoded test config
6. **Feed skeleton Worker** (`workers/feed-skeleton/`) — implement lexicon endpoint, connect to D1
7. **Register test feed** — manually register a feed generator DID, verify it appears in Bluesky
8. **Builder UI — connect + create flow** — Bluesky account connection, natural language input
9. **Agent integration** — Anthropic API call for feed config generation
10. **HITL preview** — post previews + thumbs up/down → config refinement
11. **Publish flow** — end-to-end: describe → preview → refine → publish → visible in Bluesky
12. **Auth + billing** — Stripe integration, tier enforcement in Worker + filter engine
13. **Weekly refinement cron** — CF Worker cron trigger, agent suggestions
14. **Agent skill** (Studio tier) — publish MCP tool `generate_bluesky_feed()`

---

## Open Questions

- [ ] AT Proto OAuth timeline — when can we register feeds under user's own DID without app passwords?
- [ ] Feed preview source — use Bluesky search API for preview posts at creation time, or buffer recent firehose posts in D1 for faster preview?
- [ ] Filter engine scaling strategy — at what user count do we need to shard the filter engine across multiple Railway services?
- [ ] HITL data licensing — make the aggregate dataset available to researchers? Relevant to the commons framing.
- [ ] Name / brand — "Friendly Feed" is a working title

---

*This spec was produced from a strategic design session covering: competitive landscape analysis (SkyFeed, Bluesky Feed Creator), cost modeling, break-even analysis, spam prevention, and viral/breakout pricing. See claude-memory repo for session log.*
