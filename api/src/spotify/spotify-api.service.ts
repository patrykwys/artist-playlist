import { Injectable } from '@nestjs/common';
import { SpotifyAuthService } from '../auth/spotify-auth.service.js';
import type { Session } from '../auth/session.service.js';
import { RequestQueue, fetchJson } from '../common/http.js';
import { ArtistSeed, PlaylistTrack } from '../models.js';

const BASE_URL = 'https://api.spotify.com/v1';
const SEARCH_LIMIT = 10; // Development Mode maximum since February 2026
const ADD_ITEMS_CHUNK = 100;
const PAGE_LIMIT = 50; // maximum for /me/playlists and /playlists/{id}/items
const MAX_LIBRARY_PAGES = 20; // up to 1,000 playlists scanned

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  snapshotId: string;
  ownerId: string;
  url: string;
  imageUrl: string | null;
}

export interface PlaylistLibrary {
  playlists: PlaylistSummary[];
  /** False when the library is bigger than MAX_LIBRARY_PAGES, so missing playlists may still exist. */
  complete: boolean;
}

export interface PlaylistEntry {
  addedAt: string | null;
  track: PlaylistTrack;
}

interface SpotifyImage {
  url: string;
  width: number | null;
}

interface SpotifyArtist {
  id: string;
  name: string;
  images?: SpotifyImage[];
}

interface SpotifyTrack {
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[];
  album?: { images?: SpotifyImage[] };
}

interface ArtistSearchResponse {
  artists: { items: (SpotifyArtist | null)[] };
}

interface PlaylistResponse {
  id: string;
  external_urls: { spotify: string };
}

interface SnapshotResponse {
  snapshot_id: string;
}

interface Page<T> {
  items: (T | null)[];
  next: string | null;
}

interface SimplifiedPlaylist {
  id: string;
  name: string;
  description: string | null;
  snapshot_id: string;
  owner: { id: string };
  external_urls: { spotify: string };
  images: SpotifyImage[] | null;
}

interface PlaylistItem {
  added_at: string | null;
  is_local: boolean;
  item: (SpotifyTrack & { type: 'track' }) | { type: 'episode' } | null;
}

@Injectable()
export class SpotifyApiService {
  readonly #queue = new RequestQueue(120);

  constructor(private readonly auth: SpotifyAuthService) {}

  async searchArtists(session: Session, query: string): Promise<ArtistSeed[]> {
    const params = new URLSearchParams({ q: query, type: 'artist', limit: String(SEARCH_LIMIT) });
    const response = await this.#request<ArtistSearchResponse>(session, `/search?${params}`);
    return response.artists.items
      .filter((artist): artist is SpotifyArtist => artist !== null)
      .map((artist) => ({ type: 'artist', id: artist.id, name: artist.name, imageUrl: pickImage(artist.images, 64) }));
  }

  async createPlaylist(session: Session, name: string, description: string): Promise<{ id: string; url: string }> {
    const playlist = await this.#request<PlaylistResponse>(session, '/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description, public: false }),
    });
    return { id: playlist.id, url: playlist.external_urls.spotify };
  }

  /** Appends in chunks of 100 and returns the playlist's snapshot id after the last chunk. */
  async addItems(session: Session, playlistId: string, uris: string[]): Promise<string | null> {
    let snapshotId: string | null = null;
    for (let start = 0; start < uris.length; start += ADD_ITEMS_CHUNK) {
      const response = await this.#request<SnapshotResponse>(session, `/playlists/${playlistId}/items`, {
        method: 'POST',
        body: JSON.stringify({ uris: uris.slice(start, start + ADD_ITEMS_CHUNK) }),
      });
      snapshotId = response.snapshot_id;
    }
    return snapshotId;
  }

  /** Every playlist in the user's library (owned and followed), as Spotify orders them. */
  async myPlaylists(session: Session): Promise<PlaylistLibrary> {
    const { items, complete } = await this.#pages<SimplifiedPlaylist>(session, '/me/playlists', MAX_LIBRARY_PAGES);
    const playlists = items.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      snapshotId: playlist.snapshot_id,
      ownerId: playlist.owner.id,
      url: playlist.external_urls.spotify,
      imageUrl: pickImage(playlist.images ?? undefined, 300),
    }));
    return { playlists, complete };
  }

  /** Tracks of a playlist the user owns or collaborates on (Spotify returns 403 for others). */
  async playlistItems(session: Session, playlistId: string): Promise<PlaylistEntry[]> {
    const { items } = await this.#pages<PlaylistItem>(session, `/playlists/${playlistId}/items`, Number.POSITIVE_INFINITY);
    return items.flatMap((entry) => {
      const track = entry.item;
      if (entry.is_local || !track || track.type !== 'track') {
        return [];
      }
      return [
        {
          addedAt: entry.added_at,
          track: {
            uri: track.uri,
            title: track.name,
            artist: track.artists.at(0)?.name ?? '',
            durationMs: track.duration_ms,
            imageUrl: pickImage(track.album?.images, 300),
          },
        },
      ];
    });
  }

  async #pages<T>(session: Session, path: string, maxPages: number): Promise<{ items: T[]; complete: boolean }> {
    const items: T[] = [];
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(page * PAGE_LIMIT) });
      const response = await this.#request<Page<T>>(session, `${path}?${params}`);
      items.push(...response.items.filter((item): item is T => item !== null));
      if (!response.next) {
        return { items, complete: true };
      }
    }
    return { items, complete: false };
  }

  async #request<T>(session: Session, path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.auth.accessToken(session);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    return fetchJson<T>('Spotify', `${BASE_URL}${path}`, { ...init, headers }, this.#queue);
  }
}

/** The smallest image at least `minWidth` wide (Spotify sends 64, 300 and 640 px), else the largest there is. */
function pickImage(images: SpotifyImage[] | undefined, minWidth: number): string | null {
  const sorted = [...(images ?? [])].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((image) => (image.width ?? 0) >= minWidth) ?? sorted.at(-1))?.url ?? null;
}
