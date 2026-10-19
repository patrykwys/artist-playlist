-- 002: evaluation runs of the ranking formula (see algorithm.md).
-- Kept apart from playlist/playlist_track, which mirror real Spotify playlists and are rewritten by sync.

CREATE TABLE evaluation_run (
  id             TEXT PRIMARY KEY,                -- UUID
  user_id        TEXT NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  settings       TEXT NOT NULL,                   -- JSON: { playlistIds, folds, tune }
  progress_done  INTEGER NOT NULL DEFAULT 0,      -- folds gathered so far
  progress_total INTEGER NOT NULL DEFAULT 0,
  results        TEXT,                            -- JSON EvaluationResults once done
  error          TEXT,
  started_at     TEXT NOT NULL,
  finished_at    TEXT
);
CREATE INDEX evaluation_run_user_idx ON evaluation_run (user_id, started_at);
