# Friendly Feed — Product & Technical Specification

**Status:** Pre-build  
**Last updated:** 2026-04-04  
**Authors:** Jason Edelman, Claude (Anthropic)

---

## What This Is

A freemium SaaS that lets any Bluesky user build a personalized custom feed using plain language — no keywords, no regex, no configuration UI. Users describe what they want to read; an agent builds the feed. The feed runs natively in Bluesky.

**Origin:** Faine Greenwood / Paris Marx thread on Bluesky (March 2026) identifying the gap between what custom feeds could do for ordinary users and what existing tools (SkyFeed, Bluesky Feed Creator) actually deliver.

**Core insight:** Feed Creator owns community feed operators. Attie (Bluesky's own AI feed builder, launched March 2026) now owns the creation UX for casual users. The open territory is **feed intelligence that improves over time** — a HITL quality loop that learns from user feedback, compounds as a data asset, and makes feeds genuinely better. Neither Attie nor any existing tool builds this.

---

## Problem Statement

Bluesky's custom feed system is powerful but inaccessible. Existing tools:

- **SkyFeed** (skyfeed.app): Regex-based, Flutter/Dart, solo dev, donations-only funding, reliability issues, effectively in maintenance mode as of 2024.
- **Bluesky Feed Creator** (blueskyfeedcreator.com): Better UX, solid freemium model ($0/$2.99/$9.99), but still keyword-first, community-operator focused, no agentic capability, no feedback loop on feed quality.
- **Attie** (attie.ai, launched March 2026): Bluesky's own standalone AI app. Natural language → custom feed, powered by Claude. Invite-only beta as of launch. **Direct overlap with Friendly Feed's creation UX.** Critical gap: no HITL loop, no feedback mechanism, no feed improvement over time. Creates feeds but does not learn whether they are good.

The problem Attie does not solve: *"My feed was great last week but it's drifting — I keep seeing posts I don't care about."* Feed creation is now solved (by Attie). Feed quality over time is not.

**The pivot:** Friendly Feed's positioning shifts from "plain language feed creation" (now commoditized by Attie) to **"the feed that gets better the more you use it."** Creation is the entry point; the HITL refinement loop is the product.

---

## Differentiation

Attie's launch (March 2026) changes the competitive map. Plain language feed creation is no longer a differentiator — Bluesky ships it natively. The table below reflects the updated landscape:

| Capability | SkyFeed | Feed Creator | Attie | Friendly Feed |
|---|---|---|---|---|
| No-code setup | Partial | Yes | Yes | Yes |
| Plain language intent | No | No | **Yes** | **Yes** |
| Agentic feed generation | No | No | **Yes** | **Yes** |
| HITL quality loop | No | No | **No** | **Yes** |
| Feed quality improves over time | No | No | **No** | **Yes** |
| Feedback-driven refinement | No | No | **No** | **Yes** |
| Weekly agent suggestions | No | No | No | **Yes (Pro+)** |
| Agent skill / API | No | No | No | **Yes (Studio)** |
| Reliability | Poor | Good | Unknown | Target: excellent |
| Business model | Donations | Freemium | Free (Bluesky product) | **Freemium + metered** |

**The HITL loop is now the entire moat.** Attie can create a feed from a prompt. It cannot tell you why your feed is getting worse, fix it, or learn from your behavior over time. That is Friendly Feed's job.

The HITL (human-in-the-loop) thumbs-up/down data collected during feed creation and refinement is a compounding data asset — labeled training data mapping intent descriptions to feed quality signals. Attie has no feedback mechanism. Bluesky is unlikely to build one into the core product (it would require instrumenting user behavior at a granularity that conflicts with their stated values). This gap is durable.

---

## Competitive Context (updated 2026-03-30)

**Attie** launched at the ATmosphere conference (March 28-29, 2026). It is a standalone product from Bluesky's new Exploration team, led by Jay Graber (CIO) and Paul Frazee (CTO). It runs on Claude (Anthropic). Users sign in with any AT Protocol account and describe feeds in natural language. Feeds become available in Bluesky or any atproto app.

**What Attie has that Friendly Feed does not (yet):**
- Native Bluesky distribution and credibility
- Immediate access to the user's full follow graph and interaction history via open atproto data
- Bluesky brand trust

**What Attie explicitly lacks:**
- Any feedback mechanism post-creation (no thumbs, no refinement)
- Feed quality improvement over time
- A business model (free, Bluesky-subsidized)
- Ongoing HITL during live feed consumption

**Attie's stated long-term roadmap:** vibe-coding social apps, not feed refinement. Their trajectory is toward a developer platform, not a feed quality product.

**Strategic implication:** Don't race Attie on creation UX. Let Attie be the top of the funnel — users who outgrow Attie ("my feed is getting worse") are Friendly Feed's acquisition channel. Consider explicit messaging: *"Built your first feed with Attie? Friendly Feed makes it better over time."*

---

## Architecture

```
[Bluesky Jetstream — jetstream2.us-east.bsky.network]
  wantedCollections=app.bsky.feed.post
  JSON over WebSocket, no CBOR/CAR decoding required
         ↓ WebSocket (persistent connection)
[AWS Fargate: firehose-consumer]
  - TypeScript/Node container
  - Built with Nix (pkgs.dockerTools.buildImage → ECR)
  - Persistent WebSocket connection to Jetstream
  - On each post event: fires percolation query against AOSS
  - Writes matched (feed_id, post_uri) pairs to D1
  - Cursor persisted to DynamoDB (single item, updated each batch)
         ↓ HTTP + AWS SigV4
[AWS OpenSearch Serverless — percolation index]
  - Feed configs indexed as percolation queries at creation time
  - Incoming posts matched against all configs in a single query
  - Returns list of matching feed_ids per post
  - Pay per OCU-hour (scale-to-near-zero when idle)
         ↓ matched feed_id + post_uri pairs
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

**Jetstream over Tap (pre-alpha):** Jetstream provides simple JSON events over WebSocket, filterable by collection at connection time. No CBOR decoding, no CAR file handling, no Tap sidecar. Significantly reduces pre-alpha complexity. Tradeoff: events are not cryptographically authenticated and Jetstream is not formally part of the AT Protocol spec. Acceptable for a feed matching use case where a spoofed post means noise, not a security failure. Upgrade path to Tap is a consumer swap, not a rewrite. See `docs/decisions/jetstream-vs-tap.md`.

**Percolation over filter engine (Railway → AWS AOSS):** The original filter engine ran every active feed config against every incoming post — O(posts × configs). OpenSearch percolation inverts this: feed configs are indexed as queries, incoming posts are matched against all configs in a single query — O(posts × index_lookup). Scales to thousands of feed configs without linear cost growth. AWS OpenSearch Serverless removes always-on cluster cost; pay per OCU-hour.

**Nix for container builds:** No Dockerfile. Container images built via `pkgs.dockerTools.buildImage` in Nix. Fully reproducible builds, minimal image size (no package manager cruft), lockfile-enforced dependency versions. Images pushed to AWS ECR. Requires Nix installed locally; `flake.nix` at repo root defines the build.

**Fargate for consumer runtime:** Jetstream requires a persistent WebSocket connection — Lambda's 15-minute execution limit makes it unsuitable. Fargate runs the consumer as a long-lived ECS task. Restarts automatically on crash. Minimal resource requirements (0.25 vCPU / 512MB sufficient for pre-alpha).

**DynamoDB for cursor state:** Single-item table storing the Jetstream cursor (a Unix microsecond timestamp). On consumer restart, reads cursor and reconnects to Jetstream at that position — no event replay from the beginning. Sub-millisecond read, effectively free at this scale.

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

### `services/firehose-consumer/`

TypeScript/Node process. Runs on AWS Fargate. Built as a container image via Nix (`pkgs.dockerTools.buildImage`), pushed to AWS ECR.

Responsibilities:
- Connect to Jetstream WebSocket (`wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post`)
- On reconnect: read cursor from DynamoDB, pass as `?cursor=<unix_microseconds>` to resume without replay
- For each incoming post event:
  - Fire percolation query against AOSS
  - Collect matching feed_ids
  - Batch write `(feed_id, post_uri, author_did, indexed_at, expires_at)` to D1 `feed_posts`
- Persist cursor to DynamoDB after each successful batch write
- Exponential backoff on WebSocket disconnect (1s → 60s max)

Key files:
- `src/index.ts` — WebSocket connection, event loop, reconnect logic
- `src/percolate.ts` — AOSS percolation query (AWS SDK v3 + SigV4)
- `src/writer.ts` — D1 batch write with retry
- `src/cursor.ts` — DynamoDB cursor read/write
- `flake.nix` (repo root) — Nix flake defining container image build + dev shell

### AWS infrastructure

**OpenSearch Serverless collection:** Single collection, percolation index (`feed_configs_percolation`). Feed configs written to index at creation time as percolation queries. Schema: `{ query: { bool: { must: [...terms], must_not: [...excludeTerms] } } }` with `feed_id` as metadata.

**DynamoDB table:** `friendly-feed-cursor`. Single item: `{ pk: "cursor", value: "<unix_microseconds>" }`. PAY_PER_REQUEST billing — essentially free.

**ECR repository:** `friendly-feed/firehose-consumer`. Tagged by git SHA. Fargate task definition references ECR image URI.

**IAM role:** Fargate task role with permissions scoped to: AOSS collection read/write, DynamoDB table read/write, CloudWatch Logs write.

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

Fixed infra: ~$30-50/mo (Fargate task ~$10-15 + AOSS serverless ~$10-20 idle + DynamoDB ~$0 + CF Workers base ~$5)
Marginal cost per user/month: well under $0.10 at 1K users (AOSS scales with query volume, not user count)
Marginal cost per million views served: ~$0.30 (CF Workers overages)
Break-even: **~10-15 Pro subscribers** (down from 25 with Railway)

> Previous estimate of ~$130/mo fixed (Railway) replaced by ~$30-50/mo (AWS serverless). AOSS OCU cost is the main variable — monitor closely in first month.

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

**Bluesky shipped a native feed builder (Attie, March 2026):** The plain language creation UX is now commoditized. The HITL loop is no longer a hedge — it is the product. Build it first.

**Jetstream stability risk:** Jetstream is not formally part of the AT Protocol spec. If Bluesky deprecates the public instances, self-host the open-source Jetstream server (Go, easy to containerize). Upgrade path to full authenticated relay (Tap) is a consumer swap. Document this in `docs/decisions/jetstream-vs-tap.md`.

**AOSS cold start / OCU minimum:** OpenSearch Serverless has a minimum of 2 OCUs per collection (~$350/mo at full utilization). In practice, serverless collections scale toward zero when idle, but verify actual idle cost in first billing cycle before committing to this for production.

**AT Protocol instability:** OAuth still maturing, Sync v1.1 rollout ongoing. Jetstream abstracts most of this. Stay on official public instances until self-hosting is needed.

**Nix build learning curve:** If `pkgs.dockerTools.buildImage` causes friction at pre-alpha speed, fall back to a minimal Alpine Dockerfile for the first deploy and introduce Nix builds in the second sprint. Don't let tooling block shipping.

---

## Repository Structure

```
friendly-feed/
├── flake.nix                        # Nix flake: dev shell + container image build
├── flake.lock                       # Locked Nix dependencies
├── SPEC.md                          # This file
├── README.md                        # Setup and deployment guide
├── apps/
│   └── builder/                     # Feed builder UI
│       ├── src/
│       │   ├── index.html
│       │   ├── app.js
│       │   └── style.css
│       └── public/
├── services/
│   └── firehose-consumer/           # Jetstream consumer → AOSS percolation → D1
│       └── src/
│           ├── index.ts             # Entry point, WebSocket loop, reconnect
│           ├── percolate.ts         # AOSS percolation query (AWS SDK v3)
│           ├── writer.ts            # D1 batch writes
│           └── cursor.ts            # DynamoDB cursor persistence
├── infra/
│   ├── ecs-task.json                # Fargate task definition
│   ├── dynamodb.tf                  # Cursor table (Terraform or CDK, TBD)
│   └── opensearch.tf                # AOSS collection + percolation index
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
├── docs/
│   └── decisions/
│       └── jetstream-vs-tap.md      # ADR: why Jetstream for pre-alpha
└── scripts/                         # DB migration, feed registration helpers
```

---

## Build Order

> **Note (updated 2026-04-04):** Architecture revised — Railway + Tap + filter engine replaced by Jetstream + AWS Fargate + AOSS percolation + DynamoDB cursor. Nix used for container builds (no Dockerfile). HITL loop remains the primary differentiator; infra steps below reflect the new stack.

1. **Nix dev shell + flake** (`flake.nix`) — set up reproducible dev environment, Node + AWS CLI + wrangler available via `nix develop`
2. **Schema + types** (`packages/shared/`) — D1 DDL, TypeScript types
3. **D1 setup** — `wrangler d1 create friendly-feed`, run migrations
4. **AOSS collection + percolation index** — create collection, define index mapping, test a manual percolation query
5. **DynamoDB cursor table** — single-item table, verify read/write
6. **Firehose consumer skeleton** (`services/firehose-consumer/`) — connect to Jetstream, log raw events, no matching yet
7. **Percolation wired** — on each post event, fire AOSS query, log matching feed_ids
8. **D1 writes** — batch write matched pairs to `feed_posts`, cursor to DynamoDB
9. **Nix container build** — `pkgs.dockerTools.buildImage`, push to ECR, deploy to Fargate, verify end-to-end
10. **Feed skeleton Worker** (`workers/feed-skeleton/`) — implement lexicon endpoint, connect to D1
11. **Register test feed** — manually write a percolation query to AOSS, verify posts land in D1, verify Bluesky can read the feed
12. **Builder UI — connect + create flow** — Bluesky account connection, natural language input
13. **Agent integration** — Anthropic API call for feed config generation, writes percolation query to AOSS on publish
14. **⭐ HITL preview** — post previews + thumbs up/down → config refinement ← **core product**
15. **⭐ Publish flow** — end-to-end: describe → preview → refine → publish → visible in Bluesky
16. **⭐ Ongoing HITL** — thumbs during live feed consumption, continuous `hitl_events` writes
17. **Auth + billing** — Stripe, tier enforcement
18. **Weekly refinement cron** — CF Worker cron, agent suggestions from accumulated HITL data
19. **Agent skill** (Studio tier) — MCP tool `generate_bluesky_feed()`

---

## Architectural Note: PDS-Native Feed Storage

> *Added 2026-05-15*

**Proposal:** Use OpenSearch percolation for matching only — do not store matched results in D1. Instead, push matched  pairs into a message queue (SQS or similar), then write the feed directly to the user's own PDS repo. The feed skeleton Worker reads from the user's PDS rather than from a Friendly Feed-owned D1 table.

**Implications:**
- **Storage cost eliminated** — no D1  table; no ranking or preference data hosted by Friendly Feed
- **User hosts their own feed** — AT Proto's PDS repo becomes the durable feed store; user's PDS operator picks up the tab
- **Privacy by design** — Friendly Feed holds no per-user post history; HITL signal accumulation would need to live in the user's PDS or be stateless
- **Feed skeleton serving** — Worker would proxy reads from user's PDS instead of D1; latency profile TBD
- **Open question:** Does writing matched posts to a user's PDS require AT Proto OAuth (lexicon write permissions)? If so, this depends on the OAuth timeline open question below.
- **Open question:** Does this constrain HITL signal storage? Ranking/preference data would need to either live in the user's PDS (user controls it) or be held ephemerally by Friendly Feed (loses persistence). Needs design decision before HITL build.

This is a significant architectural divergence from the current D1-centric design. Revisit before starting Step 8 (D1 writes).

## Open Questions

- [ ] AT Proto OAuth timeline — when can we register feeds under user's own DID without app passwords?
- [ ] Feed preview source — use Bluesky search API for preview posts at creation time, or buffer recent Jetstream posts in D1?
- [ ] AOSS actual idle cost — verify OCU billing in first month; may need to evaluate single shared collection vs. per-environment collections
- [ ] Infra-as-code choice — Terraform vs. CDK for AOSS + DynamoDB + ECS task definition
- [ ] HITL data licensing — make the aggregate dataset available to researchers? Relevant to the commons framing.
- [ ] Name / brand — "Friendly Feed" is a working title
- [ ] **Attie interop** — should Friendly Feed accept Attie-generated feed configs as import/starting point?
- [ ] **Positioning vs. Attie** — compete directly or complement (Attie creates, Friendly Feed refines)?
- [ ] **Ongoing HITL UX** — where does thumbs up/down live during live feed consumption? In-app companion? Browser extension?
- [ ] **Jetstream → Tap upgrade trigger** — define the specific condition (user count? reliability incident?) that triggers migration to authenticated relay

---

*This spec was produced from a strategic design session covering: competitive landscape analysis (SkyFeed, Bluesky Feed Creator), cost modeling, break-even analysis, spam prevention, and viral/breakout pricing. See claude-memory repo for session log.*
