# Friendly Feed — Deployment Guide

## Architecture at a glance

```
Bluesky firehose (wss://bsky.network)
    │
    ▼
[Railway] Tap container          ← connects to firehose, buffers events
    │
    ▼
[Railway] Filter Engine          ← matches posts against feed configs
    │  writes matched posts
    ▼
[Cloudflare Worker]              ← API + feed skeleton (live at friendly-feed.jason-edelman.org)
    │  reads/writes
    ▼
[Cloudflare D1]                  ← database (already provisioned)

[Cloudflare Pages]               ← Svelte SPA (builder + admin dashboard)
    │  API calls
    └──────────────────────────► Cloudflare Worker
```

**Accounts required:** Cloudflare (Edelmanja@gmail.com), Railway
**Tools required:** `wrangler` CLI, `node` ≥18, `npm`, Railway CLI (`railway`)

---

## Current state (as of this writing)

| Component | Status |
|---|---|
| D1 database `friendly-feed` | ✅ Provisioned, schema migrated |
| CF Worker `friendly-feed-skeleton` | ✅ Deployed, live at `friendly-feed.jason-edelman.org` |
| CF Worker secrets | ❌ Not yet set |
| CF Pages (Svelte SPA) | ❌ Not yet deployed |
| Railway: Tap | ❌ Not yet deployed |
| Railway: Filter Engine | ❌ Not yet deployed |

---

## Step 1 — Set CF Worker secrets

The Worker is already deployed. It needs three secrets before any API calls will work.

```bash
cd workers/feed-skeleton

# Shared secret between the Worker and the Railway filter engine.
# Generate a strong random value — same value goes in Railway later.
wrangler secret put INTERNAL_SECRET

# Admin dashboard token — used by the /api/admin/* endpoints.
# Generate separately; keep it private, it's only yours.
wrangler secret put ADMIN_SECRET

# Your Anthropic API key for feed config generation.
wrangler secret put ANTHROPIC_API_KEY
```

Verify they're set:
```bash
wrangler secret list
# Should show: INTERNAL_SECRET, ADMIN_SECRET, ANTHROPIC_API_KEY
```

Redeploy to pick up any wrangler.toml changes made since last deploy:
```bash
wrangler deploy
```

Smoke test:
```bash
curl https://friendly-feed.jason-edelman.org/.well-known/did.json
# → { "@context": [...], "id": "did:web:...", "service": [...] }

curl "https://friendly-feed.jason-edelman.org/api/user?handle=bsky.app"
# → { "did": "did:plc:...", "handle": "bsky.app", "tier": "free", ... }
```

---

## Step 2 — Deploy the Svelte SPA to CF Pages

### 2a. Build

```bash
cd apps/builder
npm install
```

Create `apps/builder/.env.production`:
```
VITE_API_BASE=https://friendly-feed.jason-edelman.org
```

```bash
npm run build
# Output in apps/builder/dist/
```

### 2b. Create the CF Pages project (first time only)

```bash
# From apps/builder/
npx wrangler pages project create friendly-feed-builder
```

When prompted:
- **Project name:** `friendly-feed-builder`
- **Production branch:** `main`

### 2c. Deploy

```bash
npx wrangler pages deploy dist \
  --project-name friendly-feed-builder \
  --branch main
```

CF Pages will give you a URL like `https://friendly-feed-builder.pages.dev`.

### 2d. Optional: add a custom subdomain

In the Cloudflare dashboard → Pages → `friendly-feed-builder` → Custom domains → Add custom domain.

Suggested: `app.jason-edelman.org` (add a CNAME in the `jason-edelman.org` zone pointing to `friendly-feed-builder.pages.dev`).

### 2e. Smoke test

Open the Pages URL in a browser. You should see the Connect page. Enter your Bluesky handle — it should resolve and redirect to the dashboard.

---

## Step 3 — Deploy Tap to Railway

Tap is the firehose consumer. It runs as a Docker container.

### 3a. Create a Railway project

Go to [railway.app](https://railway.app) → New Project → Empty Project. Name it `friendly-feed`.

### 3b. Add the Tap service

1. In the project: **New Service → GitHub Repo** → select `jedelman/friendly-feed`
2. Railway detects the Dockerfile. Set the root directory to `/` (repo root) — Railway uses `services/tap/Dockerfile` via the `railway.toml` path.

   > **Note:** In Railway's service settings → Source → set **Root Directory** to `/` and the build will pick up `services/tap/railway.toml` automatically.

### 3c. Set Tap environment variables

In Railway: Service → Variables → Add the following:

| Variable | Value |
|---|---|
| `TAP_ADMIN_PASSWORD` | strong random password (generate with `openssl rand -hex 20`) |
| `TAP_RELAY_HOST` | `wss://bsky.network` |
| `TAP_LOG_LEVEL` | `info` |
| `TAP_RETRY_TIMEOUT` | `60s` |

Do **not** set `TAP_FULL_NETWORK=true` — it would consume the entire AT Protocol firehose (terabytes/day). The default filters to `app.bsky.feed.post` only.

### 3d. Deploy

Click **Deploy**. Tap should start and connect to `wss://bsky.network` within a minute.

Check logs: Service → Logs. You should see:
```
connecting to relay wss://bsky.network
subscribed to collections: app.bsky.feed.post
```

### 3e. Note the private network hostname

In Railway: Service → Settings → Networking → Private Domain.
It will be something like `tap.railway.internal`. Port is `2480`.
Note this — you'll need it for the filter engine: `http://tap.railway.internal:2480`

---

## Step 4 — Provision Amazon OpenSearch Serverless

The filter engine uses the OpenSearch **Percolator** to match incoming posts against all
active feed configs in a single API call. Auth is AWS SigV4 (no username/password).

> **Cost note:** OpenSearch Serverless bills per OCU-hour (~$0.24/OCU/hr). A minimal
> collection idles at 2 OCUs (~$350/month). For low-volume launch, consider starting
> with a **provisioned** `t3.small.search` domain (~$30/month) and migrating to
> Serverless when throughput warrants it. The code works identically for both — just
> change `service: 'aoss'` → `service: 'es'` and add fine-grained access control
> credentials if you go provisioned first.

### 4a. Create the Serverless collection

1. AWS console → **OpenSearch Service → Serverless → Collections → Create collection**
2. Settings:

| Setting | Value |
|---|---|
| Collection name | `friendly-feed` |
| Type | **Search** |
| Encryption | AWS-owned key (default) |
| Network access | **Public** (simplest; restrict to VPC later if needed) |

3. Creation takes 2–5 minutes. Note the **Collection endpoint** URL:
   `https://<collection-id>.<region>.aoss.amazonaws.com`

### 4b. Create an IAM user for the service

```bash
# Create user
aws iam create-user --user-name friendly-feed-opensearch

# Attach an inline policy allowing aoss:APIAccessAll on your collection
aws iam put-user-policy \
  --user-name friendly-feed-opensearch \
  --policy-name FriendlyFeedAoss \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": "aoss:APIAccessAll",
      "Resource": "arn:aws:aoss:<region>:<account-id>:collection/<collection-id>"
    }]
  }'

# Create access key
aws iam create-access-key --user-name friendly-feed-opensearch
# Save AccessKeyId and SecretAccessKey
```

Also add a **Data access policy** in the OpenSearch Serverless console
(Collections → your collection → Data access) granting the IAM user
`aoss:ReadDocument`, `aoss:WriteDocument`, `aoss:CreateIndex`,
`aoss:DeleteIndex`, `aoss:UpdateIndex`, `aoss:DescribeIndex` on all indexes.

### 4c. Set OpenSearch secrets on the CF Worker

```bash
cd workers/feed-skeleton

wrangler secret put OPENSEARCH_URL
# paste: https://<collection-id>.<region>.aoss.amazonaws.com

wrangler secret put AWS_ACCESS_KEY_ID
# paste: AccessKeyId from 4b

wrangler secret put AWS_SECRET_ACCESS_KEY
# paste: SecretAccessKey from 4b
```

Optionally add to `wrangler.toml` `[vars]` if your region isn't `us-east-1`:
```toml
AWS_REGION = "us-east-1"
```

Redeploy the Worker:
```bash
wrangler deploy
```

### 4d. Bootstrap the percolator index

The index must exist before the filter engine starts. With your collection running and Worker redeployed:

```bash
curl -X POST https://friendly-feed.jason-edelman.org/internal/percolator/sync \
  -H "Authorization: Bearer <INTERNAL_SECRET>"
# → { "synced": 0, "errors": 0, "total": 0 }
# (0 feeds is correct — you haven't created any yet)
```

This creates the `ff_feed_queries` index with the correct mapping. Run it again any time
the index drifts out of sync (e.g. after a cluster restore).

---

## Step 5 — Deploy the Filter Engine to Railway

### 5a. Add a service

In the Railway project: **New Service → GitHub Repo** → same repo, service name `filter-engine`.
Set **Root Directory** to `/` so Railway finds `services/filter-engine/railway.toml`.

### 5b. Set Filter Engine environment variables

| Variable | Value |
|---|---|
| `TAP_URL` | `http://tap.railway.internal:2480` (private network hostname from Step 3e) |
| `TAP_ADMIN_PASSWORD` | same value set on the Tap service |
| `OPENSEARCH_URL` | `https://<collection-id>.<region>.aoss.amazonaws.com` |
| `AWS_ACCESS_KEY_ID` | IAM access key from Step 4b |
| `AWS_SECRET_ACCESS_KEY` | IAM secret key from Step 4b |
| `AWS_REGION` | e.g. `us-east-1` |
| `WRITE_ENDPOINT_URL` | `https://friendly-feed.jason-edelman.org/internal/posts` |
| `WRITE_ENDPOINT_SECRET` | same value as `INTERNAL_SECRET` |

### 5c. Deploy

Click **Deploy**. Check logs — you should see:
```
[main] starting filter engine (percolator mode)
[opensearch] percolator index "ff_feed_queries" is ready
[main] listening for app.bsky.feed.post events
```

If you see `Percolator index "ff_feed_queries" does not exist` — re-run the sync curl from Step 4c.

---

## Step 6 — End-to-end smoke test

At this point all components are live. Run through the full creation flow:

1. Open the SPA → Connect with your Bluesky handle
2. Click **New Feed** → describe a feed (e.g. "infrastructure and transit news")
3. Click **Generate** — should return a proposal from Claude in ~5–10s
4. Click **Preview real posts** — should load 20+ posts from Bluesky search
5. Vote thumbs up/down on 8+ posts
6. Click **Publish** — feed should be created in D1

Verify in D1:
```bash
cd workers/feed-skeleton
wrangler d1 execute friendly-feed \
  --command "SELECT feed_id, name, active FROM feed_configs ORDER BY created_at DESC LIMIT 5"
```

After creating the feed, re-run the percolator sync to pick it up immediately (or wait for
the next time the filter engine starts — it checks on boot):
```bash
curl -X POST https://friendly-feed.jason-edelman.org/internal/percolator/sync \
  -H "Authorization: Bearer <INTERNAL_SECRET>"
# → { "synced": 1, "errors": 0, "total": 1 }
```

Within a few minutes of posting on Bluesky you should see in the filter engine logs:
```
[event] matched 1 feed(s) for post <rkey>
```

---

## Step 7 — Register the feed on Bluesky (required for it to appear in the app)

Bluesky requires a `app.bsky.feed.generator` record to be published under an account's DID to make a feed discoverable. For MVP, feeds are under the service DID (`did:web:feeds.friendlyfeed.app`).

This step requires publishing a record with your service account credentials. The tooling for this (using `@atproto/api`) is the next implementation milestone. In the meantime, feeds are created in D1 and begin indexing posts — they just won't appear in the Bluesky feed picker until registration is complete.

Track this in the backlog as: **Publish feed generator records via @atproto/api on feed creation**.

---

## Ongoing operations

### View Worker logs
```bash
cd workers/feed-skeleton
wrangler tail
```

### Run D1 queries
```bash
wrangler d1 execute friendly-feed --command "SELECT COUNT(*) FROM feed_posts"
wrangler d1 execute friendly-feed --command "SELECT tier, COUNT(*) FROM users GROUP BY tier"
```

### Re-deploy the Worker after code changes
```bash
cd workers/feed-skeleton
wrangler deploy
```

### Re-deploy the SPA after UI changes
```bash
cd apps/builder
npm run build
npx wrangler pages deploy dist --project-name friendly-feed-builder --branch main
```

### Redeploy Railway services

Push to the branch Railway is tracking (typically `master`). Railway auto-deploys on push.

Or trigger manually: Railway dashboard → Service → Deployments → Redeploy.

### Pause the filter engine (cost control)

In Railway: Service → Settings → toggle **Sleep when inactive**, or simply remove the service.
The Tap container can be left running independently (it buffers in memory).

---

## Future: Palomar fork (full-text search + preview)

The current filter engine uses the OpenSearch Percolator for matching but does **not** index
post content into a searchable index. That means the `/api/preview` endpoint falls back to
Bluesky's public search API.

When you fork Palomar:

1. Add a **third Railway service** for the forked Palomar (Go binary)
2. Palomar connects to `wss://bsky.network` directly — **Tap can be decommissioned**
3. On each incoming post, Palomar:
   - Indexes the post into `palomar_post` (full-text search, used by `/api/preview`)
   - Percolates the post against `ff_feed_queries` and writes matches to D1
4. The Node.js filter engine can be decommissioned — Palomar handles the full pipeline
5. Use Tap manually for **backfill**: point it at the filter engine briefly to hydrate the
   `palomar_post` index for the period before Palomar was running

No new infrastructure is needed — the same OpenSearch Serverless collection from Step 4 serves both indices.

---

## Secret inventory

Keep this updated. All values live in CF Secrets or Railway Variables — never in source.

| Secret | Where | Purpose |
|---|---|---|
| `INTERNAL_SECRET` | CF Worker secret | Filter engine ↔ Worker auth |
| `ADMIN_SECRET` | CF Worker secret | Admin dashboard token |
| `ANTHROPIC_API_KEY` | CF Worker secret | Claude API for feed generation |
| `TAP_ADMIN_PASSWORD` | Railway (Tap) | Tap WebSocket auth |
| `TAP_ADMIN_PASSWORD` | Railway (Filter Engine) | Must match Tap value |
| `AWS_ACCESS_KEY_ID` | Railway (Filter Engine) | IAM key for OpenSearch Serverless |
| `AWS_SECRET_ACCESS_KEY` | Railway (Filter Engine) | IAM secret for OpenSearch Serverless |
| `AWS_ACCESS_KEY_ID` | CF Worker secret | IAM key for OpenSearch Serverless (same value) |
| `AWS_SECRET_ACCESS_KEY` | CF Worker secret | IAM secret for OpenSearch Serverless (same value) |
| `WRITE_ENDPOINT_SECRET` | Railway (Filter Engine) | Must match `INTERNAL_SECRET` |
