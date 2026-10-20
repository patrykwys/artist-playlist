-- 004: what the engine did while generating a playlist (the Engine view, see Visualization.md), so My playlists
-- can replay it. One gzipped JSON array of TraceEvent per playlist, typically 10–30 kB; gone with the playlist.

CREATE TABLE playlist_trace (
  playlist_id TEXT PRIMARY KEY REFERENCES playlist (id) ON DELETE CASCADE,
  events      BLOB NOT NULL,                     -- gzip of a JSON TraceEvent[]
  created_at  TEXT NOT NULL
);
