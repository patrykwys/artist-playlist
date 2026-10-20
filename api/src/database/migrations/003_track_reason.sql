-- 003: why each generated track was picked (the "Why this track?" line, see algorithm.md).
-- Its own table, keyed by track URI rather than position: sync rewrites playlist_track whenever the playlist
-- changes in Spotify, and a reason should outlive that for as long as its track is still in the playlist.

CREATE TABLE playlist_track_reason (
  playlist_id TEXT NOT NULL REFERENCES playlist (id) ON DELETE CASCADE,
  uri         TEXT NOT NULL,
  reason      TEXT NOT NULL,                     -- JSON TrackReason: seed, score parts, shared tags, similar song
  PRIMARY KEY (playlist_id, uri)
);
