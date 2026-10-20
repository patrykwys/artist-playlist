import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { MixMode } from '../models.js';

/** Mirrors the playlist table. */
export type PlaylistRow = {
  id: string;
  user_id: string;
  name: string;
  url: string;
  image_url: string | null;
  snapshot_id: string | null;
  /** The column has CHECK (mode IN ('blend', 'bridge')). */
  mode: MixMode | null;
  seeds: string;
  created_at: string | null;
};

/** Mirrors the playlist_track table. */
export type PlaylistTrackRow = {
  playlist_id: string;
  position: number;
  uri: string;
  title: string;
  artist: string;
  duration_ms: number;
  image_url: string | null;
};

/** Mirrors the playlist_track_reason table. */
export type PlaylistTrackReasonRow = {
  playlist_id: string;
  uri: string;
  /** JSON TrackReason. */
  reason: string;
};

/** Mirrors the playlist_trace table. */
export type PlaylistTraceRow = {
  playlist_id: string;
  /** gzip of a JSON TraceEvent[]. */
  events: Uint8Array;
  created_at: string;
};

@Injectable()
export class PlaylistRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Newest first; playlists with an unknown date last. */
  findByUser(userId: string): PlaylistRow[] {
    return this.database.all<PlaylistRow>(
      'SELECT * FROM playlist WHERE user_id = ? ORDER BY created_at DESC NULLS LAST, name',
      [userId],
    );
  }

  findTracksByUser(userId: string): PlaylistTrackRow[] {
    return this.database.all<PlaylistTrackRow>(
      `SELECT t.* FROM playlist_track t
       JOIN playlist p ON p.id = t.playlist_id
       WHERE p.user_id = ?
       ORDER BY t.playlist_id, t.position`,
      [userId],
    );
  }

  findReasonsByUser(userId: string): PlaylistTrackReasonRow[] {
    return this.database.all<PlaylistTrackReasonRow>(
      `SELECT r.* FROM playlist_track_reason r
       JOIN playlist p ON p.id = r.playlist_id
       WHERE p.user_id = ?`,
      [userId],
    );
  }

  /**
   * Inserts or updates the playlist and replaces its tracks, in one transaction. Reasons are only written
   * when given (a freshly generated playlist); a sync leaves the stored ones alone.
   */
  save(playlist: PlaylistRow, tracks: PlaylistTrackRow[], reasons: PlaylistTrackReasonRow[] = []): void {
    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO playlist (id, user_id, name, url, image_url, snapshot_id, mode, seeds, created_at)
         VALUES (@id, @user_id, @name, @url, @image_url, @snapshot_id, @mode, @seeds, @created_at)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name, url = excluded.url, image_url = excluded.image_url,
           snapshot_id = excluded.snapshot_id, mode = excluded.mode, seeds = excluded.seeds,
           created_at = excluded.created_at`,
        playlist,
      );
      this.database.run('DELETE FROM playlist_track WHERE playlist_id = ?', [playlist.id]);
      for (const track of tracks) {
        this.database.run(
          `INSERT INTO playlist_track (playlist_id, position, uri, title, artist, duration_ms, image_url)
           VALUES (@playlist_id, @position, @uri, @title, @artist, @duration_ms, @image_url)`,
          track,
        );
      }
      for (const reason of reasons) {
        this.database.run(
          `INSERT INTO playlist_track_reason (playlist_id, uri, reason) VALUES (@playlist_id, @uri, @reason)
           ON CONFLICT (playlist_id, uri) DO UPDATE SET reason = excluded.reason`,
          reason,
        );
      }
    });
  }

  /** Ids of the user's playlists whose generation was recorded. */
  findTracedIdsByUser(userId: string): string[] {
    return this.database
      .all<{ playlist_id: string }>(
        `SELECT tr.playlist_id FROM playlist_trace tr
         JOIN playlist p ON p.id = tr.playlist_id
         WHERE p.user_id = ?`,
        [userId],
      )
      .map((row) => row.playlist_id);
  }

  /** Only the user's own playlists: the id comes from the URL. */
  findTrace(userId: string, playlistId: string): PlaylistTraceRow | undefined {
    return this.database.get<PlaylistTraceRow>(
      `SELECT tr.* FROM playlist_trace tr
       JOIN playlist p ON p.id = tr.playlist_id
       WHERE p.user_id = ? AND tr.playlist_id = ?`,
      [userId, playlistId],
    );
  }

  saveTrace(trace: PlaylistTraceRow): void {
    this.database.run(
      `INSERT INTO playlist_trace (playlist_id, events, created_at) VALUES (@playlist_id, @events, @created_at)
       ON CONFLICT (playlist_id) DO UPDATE SET events = excluded.events, created_at = excluded.created_at`,
      trace,
    );
  }

  /** For a playlist whose tracks haven't changed: name and cover can still change in Spotify. */
  updateListing(id: string, name: string, url: string, imageUrl: string | null): void {
    this.database.run('UPDATE playlist SET name = ?, url = ?, image_url = ? WHERE id = ?', [name, url, imageUrl, id]);
  }

  /** Removes the user's playlists that are no longer in Spotify. Returns how many were removed. */
  deleteAllExcept(userId: string, keepIds: string[]): number {
    return this.database.run(
      'DELETE FROM playlist WHERE user_id = ? AND id NOT IN (SELECT value FROM json_each(?))',
      [userId, JSON.stringify(keepIds)],
    );
  }
}
