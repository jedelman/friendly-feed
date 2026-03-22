# Friendly Feed — Claude Memory

## Cloudflare Deployment

- **Account:** Edelmanja@gmail.com (`543fde7feabd0af945bfae926ceea7ad`)
- **Worker:** `friendly-feed-skeleton` → live at `https://friendly-feed.jason-edelman.org/*`
- **D1 Database:** `friendly-feed` — ID `12f77c98-595b-4919-9555-a334e0948ad5`
- **Zone:** `jason-edelman.org` (ID `f0cd109c67f94d8f2a76c4039547d54b`)
- Schema migrated: 6 tables (`users`, `feed_configs`, `feed_posts`, `hitl_events`, `view_events`, `review_queue`)
- `INTERNAL_SECRET` still needs to be set via `wrangler secret put INTERNAL_SECRET` (not yet done)

## Branches

- **Deployment branch:** `claude/setup-deployment-access-fKgXF` — merged into master ✅
- **Dev branch:** `master` — up to date, includes D1 ID + custom domain in `wrangler.toml`

## Status (as of 2026-03-22)

- Worker deployed and live at `https://friendly-feed.jason-edelman.org/*`
- D1 schema migrated (all 6 tables)
- Tap + filter-engine Railway deploy: **not yet done**
- `INTERNAL_SECRET`: **not yet set**

## Next Session: Testing

- Smoke-test the live Worker endpoints (health, feed skeleton routes)
- Set `INTERNAL_SECRET` via `wrangler secret put INTERNAL_SECRET` + mirror to Railway
- Deploy Tap + filter-engine to Railway
- Wire Railway → Worker URL env vars

