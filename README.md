# Friendly Feed

Freemium SaaS — describe what you want to read on Bluesky in plain language. An agent builds and maintains your custom feed. Feeds run natively in Bluesky.

**Status:** Scaffolded. See [SPEC.md](./SPEC.md) for full product and technical specification.

## Quick start

### Prerequisites
- Node.js 20+
- Docker
- Wrangler CLI (`npm i -g wrangler`)
- Railway account
- Cloudflare account (Workers Paid plan)

### 1. Set up D1
```bash
wrangler d1 create friendly-feed
# Copy the database_id into workers/feed-skeleton/wrangler.toml
wrangler d1 execute friendly-feed --file=packages/shared/src/schema.sql
```

### 2. Deploy feed skeleton Worker
```bash
cd workers/feed-skeleton
wrangler deploy
```

### 3. Deploy Tap + filter engine to Railway
```bash
# In Railway dashboard: New Project → Deploy from Dockerfile
# Point at services/tap/docker-compose.yml
# Set env vars: TAP_ADMIN_PASSWORD, TAP_RELAY_HOST
```

### 4. Run filter engine locally (dev)
```bash
cd services/filter-engine
npm install
TAP_URL=ws://localhost:2480 TAP_ADMIN_PASSWORD=dev npm run dev
```

## Architecture

See [SPEC.md](./SPEC.md) for full architecture diagram, data schema, pricing model, and build order.

## Structure

```
apps/builder/          Feed builder UI (plain HTML/CSS)
services/tap/          Tap Docker config (Railway)
services/filter-engine/ Firehose consumer + D1 writer (Railway)
workers/feed-skeleton/  getFeedSkeleton CF Worker
packages/shared/       Types + D1 schema
```
