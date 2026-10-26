import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config.js';
import { ApiCacheService, CachedLoader } from '../cache/api-cache.service.js';
import { DAY_MS, RequestQueue, UpstreamError, request, toArray } from '../common/http.js';
import { RawTag } from '../engine/tags.js';
import { TopTrack } from '../engine/track-matching.js';
import { GenreSeed } from '../models.js';

const BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const NOT_FOUND = 6;
const RATE_LIMITED = 29;
const CACHE_TTL_MS = 7 * DAY_MS;
/** Last.fm's most used tags read for genre suggestions, in one call (1,000 is as many as it sends at once). */
const TOP_TAGS = 1000;

export interface SimilarArtist {
  name: string;
  match: number;
}

/** A song Last.fm listeners play alongside another one (track.getSimilar), 0 < match ≤ 1. */
export interface SimilarTrack {
  title: string;
  artist: string;
  match: number;
}

export interface ArtistInfo {
  name: string;
  mbid: string | null;
  listeners: number;
  /**
   * The page says several artists share the name ("There are two artists by this name"): its tags, top tracks
   * and MusicBrainz id may each belong to a different one of them.
   */
  isShared: boolean;
}

/**
 * How Last.fm bios open a page that several artists share: "There are two artists by this name", "There are
 * multiple artists tracked as …", or straight into a numbered list ("1) Nugget are a punk group … 2) …").
 */
const SHARED_PAGE = [
  /there (?:are|is) (?:more than one|multiple|several|many|two|three|four|five|six|seven|eight|nine|ten|\d+) (?:different )?(?:artists?|bands|groups|acts|musicians)/i,
  /^\s*1\)[\s\S]*\s2\)/,
];

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
  toptracks?: { track?: Many<{ name: string; listeners?: number | string }> };
}

interface SimilarTracksResponse {
  similartracks?: { track?: Many<{ name: string; match: number | string; artist?: { name?: string } }> };
}

interface ArtistInfoResponse {
  artist?: { name: string; mbid?: string; stats?: { listeners?: number | string }; bio?: { summary?: string } };
}

interface TagInfoResponse {
  tag?: { name: string; reach?: number | string; total?: number | string };
}

interface ChartTopTagsResponse {
  tags?: { tag?: Many<{ name: string; reach?: number | string }> };
}

/** Last.fm's "rate limit exceeded" holds every request back this long, not just the one that hit it. */
const RATE_LIMIT_PAUSE_MS = 2000;

/** Last.fm is the musical brain: tags stand in for genres, similar artists replace Spotify's removed endpoints. */
@Injectable()
export class LastfmApiService {
  // Last.fm asks for no more than ~5 requests a second.
  readonly #queue = new RequestQueue(220);
  // Stored in SQLite: fresh for about 7 days, then served stale while refreshed in the background (ApiCacheService).
  readonly #tags: CachedLoader<RawTag[]>;
  readonly #similar: CachedLoader<SimilarArtist[]>;
  readonly #tagArtists: CachedLoader<string[]>;
  readonly #topTracks: CachedLoader<TopTrack[]>;
  readonly #similarTracks: CachedLoader<SimilarTrack[]>;
  readonly #info: CachedLoader<ArtistInfo | null>;
  readonly #tagInfo: CachedLoader<GenreSeed | null>;
  readonly #topTags: CachedLoader<GenreSeed[]>;

  constructor(
    private readonly config: AppConfig,
    cache: ApiCacheService,
  ) {
    this.#tags = cache.loader('lastfm:artist-tags', CACHE_TTL_MS);
    this.#similar = cache.loader('lastfm:similar', CACHE_TTL_MS);
    this.#tagArtists = cache.loader('lastfm:tag-artists', CACHE_TTL_MS);
    // v2: entries became { title, listeners } instead of titles.
    this.#topTracks = cache.loader('lastfm:top-tracks:v2', CACHE_TTL_MS);
    this.#similarTracks = cache.loader('lastfm:similar-tracks', CACHE_TTL_MS);
    // v3: entries say whether several artists share the page.
    this.#info = cache.loader('lastfm:artist-info:v3', CACHE_TTL_MS);
    this.#tagInfo = cache.loader('lastfm:tag-info', CACHE_TTL_MS);
    this.#topTags = cache.loader('lastfm:top-tags', CACHE_TTL_MS);
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

  /** Most-listened first, with how many people listened to each. */
  artistTopTracks(artist: string, limit: number): Promise<TopTrack[]> {
    return this.#topTracks.get(key(artist, limit), async () => {
      const response = await this.#call<TopTracksResponse>('artist.getTopTracks', {
        artist,
        limit: String(limit),
        autocorrect: '1',
      });
      return toArray(response?.toptracks?.track).map((track) => ({
        title: track.name,
        listeners: Number(track.listeners ?? 0),
      }));
    });
  }

  /** Songs by any artist that listeners of this one also play, closest first (listening data, not tags). */
  similarTracks(artist: string, track: string, limit: number): Promise<SimilarTrack[]> {
    return this.#similarTracks.get(`${key(artist)}${key(track, limit)}`, async () => {
      const response = await this.#call<SimilarTracksResponse>('track.getSimilar', {
        artist,
        track,
        limit: String(limit),
        autocorrect: '1',
      });
      return toArray(response?.similartracks?.track).flatMap((item) =>
        item.artist?.name ? [{ title: item.name, artist: item.artist.name, match: Number(item.match) }] : [],
      );
    });
  }

  artistInfo(artist: string): Promise<ArtistInfo | null> {
    return this.#info.get(key(artist), async () => {
      const response = await this.#call<ArtistInfoResponse>('artist.getInfo', { artist, autocorrect: '1' });
      const info = response?.artist;
      return info
        ? {
            name: info.name,
            mbid: info.mbid || null,
            listeners: Number(info.stats?.listeners ?? 0),
            isShared: isSharedPage(info.bio?.summary ?? ''),
          }
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

  /** Last.fm's most used tags, those reaching the most listeners first: what genre suggestions are drawn from. */
  topTags(): Promise<GenreSeed[]> {
    return this.#topTags.get(key('chart', TOP_TAGS), async () => {
      const response = await this.#call<ChartTopTagsResponse>('chart.getTopTags', { limit: String(TOP_TAGS) });
      return toArray(response?.tags?.tag).map(
        (tag): GenreSeed => ({ type: 'genre', name: tag.name.toLowerCase(), reach: Number(tag.reach ?? 0) }),
      );
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

/** Whether an artist bio says several artists share the page (only its opening says so). */
export function isSharedPage(bio: string): boolean {
  const opening = bio.slice(0, 600);
  return SHARED_PAGE.some((pattern) => pattern.test(opening));
}

function key(name: string, limit?: number): string {
  return `${name.trim().toLowerCase()}|${limit ?? ''}`;
}
