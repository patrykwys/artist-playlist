import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config.js';
import { ApiCacheService, CachedLoader } from '../cache/api-cache.service.js';
import { DAY_MS, RequestQueue, UpstreamError, request, toArray } from '../common/http.js';
import { RawTag } from '../engine/tags.js';
import { GenreSeed } from '../models.js';

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const NOT_FOUND = 6;
const RATE_LIMITED = 29;
const CACHE_TTL_MS = 7 * DAY_MS;

export interface SimilarArtist {
  name: string;
  match: number;
}

export interface ArtistInfo {
  name: string;
  mbid: string | null;
  listeners: number;
}

interface LastfmError {
  error: number;
  message: string;
}

type Many<T> = T | T[];

interface TopTagsResponse {
  toptags?: { tag?: Many<{ name: string; count: number | string }> };
}

interface SimilarResponse {
  similarartists?: { artist?: Many<{ name: string; match: number | string }> };
}

interface TagTopArtistsResponse {
  topartists?: { artist?: Many<{ name: string }> };
}

interface TopTracksResponse {
  toptracks?: { track?: Many<{ name: string }> };
}

interface ArtistInfoResponse {
  artist?: { name: string; mbid?: string; stats?: { listeners?: number | string } };
}

interface TagInfoResponse {
  tag?: { name: string; reach?: number | string; total?: number | string };
}

/** Last.fm's "rate limit exceeded" holds every request back this long, not just the one that hit it. */
const RATE_LIMIT_PAUSE_MS = 2000;

/** Last.fm is the musical brain: tags stand in for genres, similar artists replace Spotify's removed endpoints. */
@Injectable()
export class LastfmApiService {
  // Last.fm asks for no more than ~5 requests a second.
  readonly #queue = new RequestQueue(220);
  // Stored in SQLite for 7 days (ApiCacheService).
  readonly #tags: CachedLoader<RawTag[]>;
  readonly #similar: CachedLoader<SimilarArtist[]>;
  readonly #tagArtists: CachedLoader<string[]>;
  readonly #topTracks: CachedLoader<string[]>;
  readonly #info: CachedLoader<ArtistInfo | null>;
  readonly #tagInfo: CachedLoader<GenreSeed | null>;

  constructor(
    private readonly config: AppConfig,
    cache: ApiCacheService,
  ) {
    this.#tags = cache.loader('lastfm:artist-tags', CACHE_TTL_MS);
    this.#similar = cache.loader('lastfm:similar', CACHE_TTL_MS);
    this.#tagArtists = cache.loader('lastfm:tag-artists', CACHE_TTL_MS);
    this.#topTracks = cache.loader('lastfm:top-tracks', CACHE_TTL_MS);
    this.#info = cache.loader('lastfm:artist-info', CACHE_TTL_MS);
    this.#tagInfo = cache.loader('lastfm:tag-info', CACHE_TTL_MS);
  }

  artistTopTags(artist: string): Promise<RawTag[]> {
    return this.#tags.get(key(artist), async () => {
      const response = await this.#call<TopTagsResponse>('artist.getTopTags', { artist, autocorrect: '1' });
      return toArray(response?.toptags?.tag).map((tag) => ({ name: tag.name, count: Number(tag.count) }));
    });
  }

  similarArtists(artist: string, limit: number): Promise<SimilarArtist[]> {
    return this.#similar.get(key(artist, limit), async () => {
      const response = await this.#call<SimilarResponse>('artist.getSimilar', {
        artist,
        limit: String(limit),
        autocorrect: '1',
      });
      return toArray(response?.similarartists?.artist).map((item) => ({ name: item.name, match: Number(item.match) }));
    });
  }

  /** Artist names for a tag, most-tagged first. */
  tagTopArtists(tag: string, limit: number): Promise<string[]> {
    return this.#tagArtists.get(key(tag, limit), async () => {
      const response = await this.#call<TagTopArtistsResponse>('tag.getTopArtists', { tag, limit: String(limit) });
      return toArray(response?.topartists?.artist).map((item) => item.name);
    });
  }

  /** Titles, most-listened first. */
  artistTopTracks(artist: string, limit: number): Promise<string[]> {
    return this.#topTracks.get(key(artist, limit), async () => {
      const response = await this.#call<TopTracksResponse>('artist.getTopTracks', {
        artist,
        limit: String(limit),
        autocorrect: '1',
      });
      return toArray(response?.toptracks?.track).map((track) => track.name);
    });
  }

  artistInfo(artist: string): Promise<ArtistInfo | null> {
    return this.#info.get(key(artist), async () => {
      const response = await this.#call<ArtistInfoResponse>('artist.getInfo', { artist, autocorrect: '1' });
      const info = response?.artist;
      return info
        ? { name: info.name, mbid: info.mbid || null, listeners: Number(info.stats?.listeners ?? 0) }
        : null;
    });
  }

  /** A genre search hit, or null when nobody on Last.fm uses that tag. */
  tagInfo(tag: string): Promise<GenreSeed | null> {
    return this.#tagInfo.get(key(tag), async () => {
      const response = await this.#call<TagInfoResponse>('tag.getInfo', { tag });
      const info = response?.tag;
      const reach = Number(info?.reach ?? 0);
      return info && reach > 0 ? { type: 'genre', name: info.name.toLowerCase(), reach } : null;
    });
  }

  /** Returns null when Last.fm says the artist or tag does not exist. */
  async #call<T>(method: string, params: Record<string, string>, attempt = 0): Promise<T | null> {
    const query = new URLSearchParams({ method, ...params, api_key: this.config.lastfmApiKey, format: 'json' });
    const response = await this.#queue.run(() => request('Last.fm', `${BASE_URL}?${query}`));
    const body: (T & Partial<LastfmError>) | null = await response.json().catch(() => null);

    if (body?.error !== undefined) {
      if (body.error === NOT_FOUND) {
        return null;
      }
      if (body.error === RATE_LIMITED && attempt < 2) {
        this.#queue.pauseFor(RATE_LIMIT_PAUSE_MS);
        return this.#call<T>(method, params, attempt + 1);
      }
      throw new UpstreamError('Last.fm', response.status, `Last.fm error ${body.error}: ${body.message ?? method}`);
    }
    if (!response.ok || body === null) {
      throw new UpstreamError('Last.fm', response.status, `Last.fm ${response.status} on ${method}`);
    }
    return body;
  }
}

function key(name: string, limit?: number): string {
  return `${name.trim().toLowerCase()}|${limit ?? ''}`;
}
