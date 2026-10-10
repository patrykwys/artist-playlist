import { Injectable, Logger } from '@nestjs/common';
import type { Session } from '../auth/session.service.js';
import { UserRepository } from '../auth/user.repository.js';
import { GeneratedPlaylist, PlaylistSeed, PlaylistTrack } from '../models.js';
import { PlaylistEntry, SpotifyApiService } from '../spotify/spotify-api.service.js';
import { isMadeByApp, parseDescription } from './playlist-description.js';
import { PlaylistRepository, PlaylistRow, PlaylistTrackRow } from './playlist.repository.js';

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
    return this.playlists.findByUser(session.userId).map((row) => toModel(row, tracks.get(row.id) ?? []));
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

function toModel(row: PlaylistRow, trackRows: PlaylistTrackRow[]): GeneratedPlaylist {
  const tracks = trackRows.map(
    (track): PlaylistTrack => ({
      uri: track.uri,
      title: track.title,
      artist: track.artist,
      durationMs: track.duration_ms,
      imageUrl: track.image_url,
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
  };
}

function groupTracks(rows: PlaylistTrackRow[]): Map<string, PlaylistTrackRow[]> {
  const grouped = new Map<string, PlaylistTrackRow[]>();
  for (const row of rows) {
    grouped.set(row.playlist_id, [...(grouped.get(row.playlist_id) ?? []), row]);
  }
  return grouped;
}

function earliestAddedAt(entries: PlaylistEntry[]): string | null {
  return entries.flatMap((entry) => (entry.addedAt ? [entry.addedAt] : [])).sort().at(0) ?? null;
}

/** Only this service writes the column (JSON of PlaylistSeed[]), so it is trusted like any other column. */
function parseSeeds(json: string): PlaylistSeed[] {
  return JSON.parse(json);
}
