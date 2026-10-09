import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config.js';
import { ApiCacheService, CachedLoader } from '../cache/api-cache.service.js';
import { DAY_MS, RequestQueue, fetchJson } from '../common/http.js';
import { validMbids } from '../common/mbid.js';

const SPARQL_URL = 'https://query.wikidata.org/sparql';

interface SparqlResponse<Row extends string> {
  results: { bindings: Partial<Record<Row, { value: string }>>[] };
}

/**
 * Fallback genres: the structured "genre" (P136) behind Wikipedia infoboxes, found via MusicBrainz ID (P434).
 * Countries of MusicBrainz areas (P982), for artists that MusicBrainz only places in a city.
 */
@Injectable()
export class WikidataApiService {
  private readonly logger = new Logger(WikidataApiService.name);
  readonly #queue = new RequestQueue(1000);
  readonly #genres: CachedLoader<string[]>;
  readonly #areaCountries: CachedLoader<string | null>;

  constructor(
    private readonly config: AppConfig,
    cache: ApiCacheService,
  ) {
    this.#genres = cache.loader('wikidata:genres', 30 * DAY_MS);
    this.#areaCountries = cache.loader('wikidata:area-country', 180 * DAY_MS);
  }

  /** Never throws: a failed lookup returns no genres and is retried next time (failures are not cached). */
  async genresByMusicBrainzId(mbid: string): Promise<string[]> {
    const [safeId] = validMbids([mbid]);
    if (!safeId) {
      return [];
    }

    try {
      return await this.#genres.get(safeId, async () => {
        const response = await this.#query<'genreLabel'>(`SELECT DISTINCT ?genreLabel WHERE {
          ?artist wdt:P434 "${safeId}" .
          ?artist wdt:P136 ?genre .
          ?genre rdfs:label ?genreLabel .
          FILTER(LANG(?genreLabel) = "en")
        }`);
        return response.results.bindings.flatMap((row) => (row.genreLabel ? [row.genreLabel.value] : []));
      });
    } catch (error) {
      this.logger.warn(`Wikidata lookup failed for ${safeId}: ${String(error)}`);
      return [];
    }
  }

  /**
   * ISO 3166-1 alpha-2 country of each MusicBrainz area ('London' → 'GB'), in one query; null when unknown.
   * Never throws: on failure the areas stay unresolved and are retried next time.
   */
  async countriesByAreaIds(areaIds: string[]): Promise<Map<string, string | null>> {
    const valid = validMbids(areaIds);
    try {
      return await this.#areaCountries.getMany(valid, async (missing) => {
        const response = await this.#query<'area' | 'code'>(`SELECT ?area ?code WHERE {
          VALUES ?area { ${missing.map((id) => `"${id}"`).join(' ')} }
          ?place wdt:P982 ?area ; wdt:P17 ?country .
          ?country wdt:P297 ?code .
        }`);
        const countries = new Map<string, string | null>(missing.map((id) => [id, null]));
        for (const { area, code } of response.results.bindings) {
          if (area && code) {
            countries.set(area.value, code.value);
          }
        }
        return countries;
      });
    } catch (error) {
      this.logger.warn(`Wikidata area lookup failed for ${valid.length} areas: ${String(error)}`);
      return new Map();
    }
  }

  /** POST, so a query listing many ids doesn't outgrow the URL. */
  #query<Row extends string>(query: string): Promise<SparqlResponse<Row>> {
    const init: RequestInit = {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.config.userAgent,
      },
      body: new URLSearchParams({ query }),
    };
    return fetchJson<SparqlResponse<Row>>('Wikidata', SPARQL_URL, init, this.#queue);
  }
}
