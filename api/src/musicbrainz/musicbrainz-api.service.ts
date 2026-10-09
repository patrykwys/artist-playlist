import { Injectable } from '@nestjs/common';
import { ApiCacheService, CachedLoader } from '../cache/api-cache.service.js';
import { DAY_MS, RequestQueue, fetchJson } from '../common/http.js';
import { validMbids } from '../common/mbid.js';
import { AppConfig } from '../config.js';

const SEARCH_URL = 'https://musicbrainz.org/ws/2/artist';
/** The search endpoint's maximum page size. */
const MAX_PAGE = 100;
const CACHE_TTL_MS = 30 * DAY_MS;

/** Where an artist is from. `country` is an ISO 3166-1 alpha-2 code; often only the city (`areaId`) is known. */
export interface ArtistOrigin {
  country: string | null;
  areaId: string | null;
}

interface ArtistSearchResponse {
  artists: { id: string; name: string; country?: string; area?: { id: string } }[];
}

@Injectable()
export class MusicBrainzApiService {
  // MusicBrainz allows one request a second.
  readonly #queue = new RequestQueue(1100);
  readonly #origins: CachedLoader<ArtistOrigin | null>;
  readonly #tagged: CachedLoader<string[]>;

  constructor(
    private readonly config: AppConfig,
    cache: ApiCacheService,
  ) {
    this.#origins = cache.loader('musicbrainz:origin', CACHE_TTL_MS);
    this.#tagged = cache.loader('musicbrainz:tagged', CACHE_TTL_MS);
  }

  /** Origins by MusicBrainz id, 100 artists per request; null for ids MusicBrainz doesn't know. */
  origins(mbids: string[]): Promise<Map<string, ArtistOrigin | null>> {
    return this.#origins.getMany(validMbids(mbids), async (missing) => {
      const origins = new Map<string, ArtistOrigin | null>(missing.map((mbid) => [mbid, null]));
      for (let start = 0; start < missing.length; start += MAX_PAGE) {
        const batch = missing.slice(start, start + MAX_PAGE);
        for (const artist of (await this.#search(`arid:(${batch.join(' OR ')})`, MAX_PAGE)).artists) {
          if (origins.has(artist.id)) {
            origins.set(artist.id, { country: artist.country ?? null, areaId: artist.area?.id ?? null });
          }
        }
      }
      return origins;
    });
  }

  /**
   * Names of artists from `country` (ISO 3166-1 alpha-2) tagged with any of `tags`, best match first.
   * MusicBrainz tags are lowercase genre names ("french house"), like normalized Last.fm tags.
   */
  artistsByTags(tags: string[], country: string, limit: number): Promise<string[]> {
    const terms = [...new Set(tags)].sort().map((tag) => `"${tag.replace(/["\\]/g, '')}"`);
    return this.#tagged.get(`${country}|${limit}|${terms.join(' ')}`, async () => {
      const response = await this.#search(`tag:(${terms.join(' OR ')}) AND country:${country}`, limit);
      return response.artists.map((artist) => artist.name);
    });
  }

  #search(query: string, limit: number): Promise<ArtistSearchResponse> {
    const params = new URLSearchParams({ query, limit: String(Math.min(limit, MAX_PAGE)), fmt: 'json' });
    const headers = { Accept: 'application/json', 'User-Agent': this.config.userAgent };
    return fetchJson<ArtistSearchResponse>('MusicBrainz', `${SEARCH_URL}?${params}`, { headers }, this.#queue);
  }
}
