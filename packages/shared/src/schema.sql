-- Friendly Feed — D1 Schema
-- Run via: wrangler d1 execute friendly-feed --file=packages/shared/src/schema.sql

CREATE TABLE IF NOT EXISTS users (
  did           TEXT PRIMARY KEY,
  handle        TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'free',
  created_at    INTEGER NOT NULL,
  feeds_count   INTEGER NOT NULL DEFAULT 0,
  monthly_views INTEGER NOT NULL DEFAULT 0,
  view_reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_configs (
  feed_id           TEXT PRIMARY KEY,
  owner_did         TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  intent_text       TEXT NOT NULL,  -- original natural language input
  terms             TEXT NOT NULL DEFAULT '[]',   -- JSON array
  exclude_terms     TEXT NOT NULL DEFAULT '[]',   -- JSON array
  seed_accounts     TEXT NOT NULL DEFAULT '[]',   -- JSON array of DIDs
  active            INTEGER NOT NULL DEFAULT 1,   -- boolean
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  tier_at_creation  TEXT NOT NULL DEFAULT 'free',
  FOREIGN KEY (owner_did) REFERENCES users(did)
);

CREATE INDEX IF NOT EXISTS idx_feed_configs_owner ON feed_configs(owner_did);
CREATE INDEX IF NOT EXISTS idx_feed_configs_active ON feed_configs(active);

CREATE TABLE IF NOT EXISTS feed_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id     TEXT NOT NULL,
  post_uri    TEXT NOT NULL,
  post_cid    TEXT NOT NULL,
  author_did  TEXT NOT NULL,
  indexed_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  UNIQUE(feed_id, post_uri)
);

CREATE INDEX IF NOT EXISTS idx_feed_posts_feed_indexed ON feed_posts(feed_id, indexed_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_posts_expires ON feed_posts(expires_at);

-- The compounding data asset
CREATE TABLE IF NOT EXISTS hitl_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id      TEXT NOT NULL,
  post_uri     TEXT NOT NULL,
  signal       INTEGER NOT NULL,  -- 1 thumbs up, -1 thumbs down
  session_type TEXT NOT NULL,     -- creation | refinement | weekly_review
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hitl_feed ON hitl_events(feed_id, created_at DESC);

CREATE TABLE IF NOT EXISTS view_events (
  feed_id     TEXT NOT NULL,
  owner_did   TEXT NOT NULL,
  day         INTEGER NOT NULL,   -- Math.floor(Date.now() / 86400000)
  view_count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (feed_id, day)
);

CREATE INDEX IF NOT EXISTS idx_view_events_owner ON view_events(owner_did, day);

-- Spam/abuse: pre-publish quality review queue
CREATE TABLE IF NOT EXISTS review_queue (
  feed_id      TEXT PRIMARY KEY,
  owner_did    TEXT NOT NULL,
  reason       TEXT NOT NULL,   -- JSON array of flag reasons
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at   INTEGER NOT NULL,
  reviewed_at  INTEGER
);
