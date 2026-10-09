-- 001: users, sessions, API cache, playlists.
-- Applied once by DatabaseService, recorded in schema_version. Never edit after it has run;
-- add 002_*.sql instead (same idea as a Liquibase changeset).
-- All timestamps are ISO-8601 UTC text ('2026-10-09T20:15:00.000Z'), so they sort and compare as strings.

CREATE TABLE app_user (
  id                  TEXT PRIMARY KEY,          -- Spotify user id
  display_name        TEXT NOT NULL,
  playlists_synced_at TEXT,                      -- last import of your playlists from Spotify; NULL = never
  created_at          TEXT NOT NULL
);

CREATE TABLE session (
  id_hash           TEXT PRIMARY KEY,            -- SHA-256 of the cookie value; the raw value is never stored
  user_id           TEXT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  access_token_enc  TEXT NOT NULL,               -- AES-256-GCM, key = TOKEN_ENCRYPTION_KEY
  refresh_token_enc TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL
);
CREATE INDEX session_user_idx ON session (user_id);

CREATE TABLE api_cache (
  key        TEXT PRIMARY KEY,                   -- e.g. 'lastfm:artist-tags:snow strippers|'
  value      TEXT NOT NULL,                      -- JSON
  expires_at TEXT NOT NULL
);
CREATE INDEX api_cache_expires_idx ON api_cache (expires_at);

CREATE TABLE playlist (
  id          TEXT PRIMARY KEY,                  -- Spotify playlist id
  user_id     TEXT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  image_url   TEXT,
  snapshot_id TEXT,                              -- Spotify's version id; changes whenever the playlist changes
  mode        TEXT CHECK (mode IN ('blend', 'bridge')),
  seeds       TEXT NOT NULL DEFAULT '[]',        -- JSON: [{"type":"artist","name":"Snow Strippers"}]
  created_at  TEXT                               -- NULL when unknown
);
CREATE INDEX playlist_user_idx ON playlist (user_id, created_at);

CREATE TABLE playlist_track (
  playlist_id TEXT NOT NULL REFERENCES playlist (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  uri         TEXT NOT NULL,
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  image_url   TEXT,
  PRIMARY KEY (playlist_id, position)
);
