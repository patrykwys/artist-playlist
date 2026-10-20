import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { Session } from '../auth/session.service.js';
import { UserRepository } from '../auth/user.repository.js';
import { GeneratedPlaylist, GeneratedTrack, PlaylistSeed, PlaylistTrack, TraceEvent, TrackReason } from '../models.js';
import { PlaylistEntry, SpotifyApiService } from '../spotify/spotify-api.service.js';
import { isMadeByApp, parseDescription } from './playlist-description.js';
import { PlaylistRepository, PlaylistRow, PlaylistTrackReasonRow, PlaylistTrackRow } from './playlist.repository.js';

/**
 * Your playlists made by this app, served from SQLite.
 * Spotify is read only on the first visit and when you press Refresh (sync).
 */
@Injectable()
export class PlaylistLibraryService {
  private readonly logger = new Logger(PlaylistLibraryService.name);

  constructor(
    private readonly playlists: PlaylistRepository,
    private readonly users: UserRepository,
    private readonly spotify: SpotifyApiService,
  ) {}

  async list(session: Session): Promise<GeneratedPlaylist[]> {
    if (!this.users.findById(session.userId)?.playlists_synced_at) {
      await this.sync(session);
    }
    const tracks = groupTracks(this.playlists.findTracksByUser(session.userId));
    const reasons = indexReasons(this.playlists.findReasonsByUser(session.userId));
    const traced = new Set(this.playlists.findTracedIdsByUser(session.userId));
    return this.playlists
      .findByUser(session.userId)
      .map((row) => {
        const reasonOf = (uri: string): TrackReason | null => reasons.get(reasonKey(row.id, uri)) ?? null;
        return toModel(row, tracks.get(row.id) ?? [], reasonOf, traced.has(row.id));
      });
  }

  /** The recorded generation of one of your playlists, for the Engine view to replay. */
  trace(session: Session, playlistId: string): TraceEvent[] {
    const row = this.playlists.findTrace(session.userId, playlistId);
    if (!row) {
      throw new NotFoundException('No recording of how this playlist was made');
    }
    return JSON.parse(gunzipSync(row.events).toString('utf8'));
  }

  /** Keeps the trace of a playlist just generated (gzipped: JSON of repeated names shrinks about tenfold). */
  saveTrace(playlistId: string, events: TraceEvent[]): void {
    const compressed = gzipSync(JSON.stringify(events));
    this.playlists.saveTrace({ playlist_id: playlistId, events: compressed, created_at: new Date().toISOString() });
    this.logger.log(`Kept the trace of ${playlistId}: ${events.length} events, ${Math.round(compressed.length / 1024)} kB`);
  }

  /**
   * Imports app-made playlists from Spotify and updates changed ones. A playlist whose snapshot id
   * hasn't changed keeps its stored tracks, so a sync with nothing new costs one or two Spotify calls.
   */
  async sync(session: Session): Promise<void> {
    const { playlists: library, complete } = await this.spotify.myPlaylists(session);
    const known = new Map(this.playlists.findByUser(session.userId).map((row) => [row.id, row]));
    const mine = library.filter(
      (playlist) => playlist.ownerId === session.userId && (known.has(playlist.id) || isMadeByApp(playlist.description)),
    );

    let fetched = 0;
    await Promise.all(
      mine.map(async (playlist) => {
        const row = known.get(playlist.id);
        if (row && row.snapshot_id === playlist.snapshotId) {
          this.playlists.updateListing(playlist.id, playlist.name, playlist.url, playlist.imageUrl);
          return;
        }
        fetched++;
        const entries = await this.spotify.playlistItems(session, playlist.id);
        const parsed = parseDescription(playlist.description);
        this.playlists.save(
          {
            id: playlist.id,
            user_id: session.userId,
            name: playlist.name,
            url: playlist.url,
            image_url: playlist.imageUrl,
            snapshot_id: playlist.snapshotId,
            mode: row?.mode ?? parsed.mode,
            seeds: row?.seeds ?? JSON.stringify(parsed.seeds),
            created_at: row?.created_at ?? earliestAddedAt(entries),
          },
          toTrackRows(
            playlist.id,
            entries.map((entry) => entry.track),
          ),
        );
      }),
    );

    // Only trust "missing" when Spotify returned the whole library.
    const removed = complete ? this.playlists.deleteAllExcept(session.userId, mine.map((playlist) => playlist.id)) : 0;
    this.users.markPlaylistsSynced(session.userId, new Date().toISOString());
    this.logger.log(`Synced ${mine.length} playlists: ${fetched} updated from Spotify, ${removed} removed`);
  }

  /** Stores a playlist the generator just created, so it shows up without asking Spotify. */
  saveGenerated(session: Session, playlist: GeneratedPlaylist, snapshotId: string | null): void {
    this.playlists.save(
      {
        id: playlist.id,
        user_id: session.userId,
        name: playlist.name,
        url: playlist.url,
        image_url: playlist.imageUrl,
        snapshot_id: snapshotId,
        mode: playlist.mode,
        seeds: JSON.stringify(playlist.seeds),
        created_at: playlist.createdAt,
      },
      toTrackRows(playlist.id, playlist.tracks),
      playlist.tracks.flatMap((track) =>
        track.why ? [{ playlist_id: playlist.id, uri: track.uri, reason: JSON.stringify(track.why) }] : [],
      ),
    );
  }
}

function toTrackRows(playlistId: string, tracks: PlaylistTrack[]): PlaylistTrackRow[] {
  return tracks.map((track, position) => ({
    playlist_id: playlistId,
    position,
    uri: track.uri,
    title: track.title,
    artist: track.artist,
    duration_ms: track.durationMs,
    image_url: track.imageUrl,
  }));
}

function toModel(
  row: PlaylistRow,
  trackRows: PlaylistTrackRow[],
  reasonOf: (uri: string) => TrackReason | null,
  hasTrace: boolean,
): GeneratedPlaylist {
  const tracks = trackRows.map(
    (track): GeneratedTrack => ({
      uri: track.uri,
      title: track.title,
      artist: track.artist,
      durationMs: track.duration_ms,
      imageUrl: track.image_url,
      why: reasonOf(track.uri),
    }),
  );
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    imageUrl: row.image_url,
    createdAt: row.created_at,
    mode: row.mode,
    seeds: parseSeeds(row.seeds),
    durationMs: tracks.reduce((total, track) => total + track.durationMs, 0),
    tracks,
    hasTrace,
  };
}

function groupTracks(rows: PlaylistTrackRow[]): Map<string, PlaylistTrackRow[]> {
  const grouped = new Map<string, PlaylistTrackRow[]>();
  for (const row of rows) {
    grouped.set(row.playlist_id, [...(grouped.get(row.playlist_id) ?? []), row]);
  }
  return grouped;
}

function reasonKey(playlistId: string, uri: string): string {
  return `${playlistId} ${uri}`;
}

/** Only this service writes the reason column (JSON of TrackReason), so it is trusted like any other column. */
function indexReasons(rows: PlaylistTrackReasonRow[]): Map<string, TrackReason> {
  return new Map(rows.map((row) => [reasonKey(row.playlist_id, row.uri), JSON.parse(row.reason)]));
}

function earliestAddedAt(entries: PlaylistEntry[]): string | null {
  return entries.flatMap((entry) => (entry.addedAt ? [entry.addedAt] : [])).sort().at(0) ?? null;
}

/** Only this service writes the column (JSON of PlaylistSeed[]), so it is trusted like any other column. */
function parseSeeds(json: string): PlaylistSeed[] {
  return JSON.parse(json);
}
