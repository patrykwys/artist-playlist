import { Injectable, Logger } from '@nestjs/common';
import { CandidatePool, PoolArtist, PoolSeed } from '../engine/ranking.js';
import { artistKey, shortlist } from '../engine/scoring.js';
import { RawTag, TagMap, normalizeTag, toTagMap, topRawTags, topTags } from '../engine/tags.js';
import { Edges, WalkScores, walkScores } from '../engine/walk.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { ListenerFilter, PlaylistSeed } from '../models.js';
import { WikidataApiService } from '../wikidata/wikidata-api.service.js';
import { ArtistCountryService } from './artist-country.service.js';

/** How many related artists to read per seed. */
interface PoolDepth {
  similar: number;
  genreArtists: number;
}
const POOL_DEPTH: PoolDepth = { similar: 50, genreArtists: 60 };
/** A country filter drops most related artists, so read Last.fm's maximum instead. */
const DEEP_POOL_DEPTH: PoolDepth = { similar: 250, genreArtists: 250 };
const TAG_ARTISTS_LIMIT = 30;
const POOL_TAGS_PER_SEED = 3;
/** Direct-link strength of an artist found through the seed's top tags, before the rank discount. */
const SIMILAR_TAG_PICK_MATCH = 0.3;
const GENRE_PICK_MATCH = 0.9;
const MIN_PROFILE_TAGS = 3;
const WIKIDATA_TAG_WEIGHT = 50;
/** Second hop: the seed's closest neighbours whose own similar artists are read (one Last.fm call each). */
const SECOND_HOP_NEIGHBOURS = 8;
const SECOND_HOP_SIMILAR = 50;
const SECOND_HOP_DAMPING = 0.5;
/** Per selected country: artists found by the seeds' top tags (one MusicBrainz search per country). */
const COUNTRY_DISCOVERY_LIMIT = 60;
const COUNTRY_DISCOVERY_TAGS_PER_SEED = 4;
/** Each lookup is one Last.fm call (cached after); 400 is about 100 s on a first run. */
const MAX_FILTER_LOOKUPS = 400;

export type WalkKind = keyof WalkScores;

export interface PoolRequest {
  seeds: PlaylistSeed[];
  /** Candidates kept per seed (per walk) before filters; each costs Last.fm lookups on a first run. */
  perSeed: number;
  /** How many candidates the filters should try to leave. */
  wanted: number;
  listeners: ListenerFilter | null;
  /** ISO 3166-1 alpha-2; each gets an equal share of `wanted`. */
  countries: string[];
  /** Walks that pick the shortlist: the formula's own, or both so the old and new formulas see the same pool. */
  walks: WalkKind[];
}

type ArtistFilters = Pick<PoolRequest, 'listeners' | 'countries'>;

/** Candidate key → country when a country filter is on (null otherwise). */
type Shortlist = Map<string, string | null>;

interface ProfiledSeed {
  label: string;
  /** Null for a genre seed. */
  artistName: string | null;
  tags: TagMap;
  listeners: number | null;
  /** Artist key → link strength: Last.fm similar artists plus the top artists of the seed's tags. */
  direct: Map<string, number>;
  names: Map<string, string>;
}

/**
 * Fetches everything a ranking needs from Last.fm, MusicBrainz and Wikidata (all cached), and nothing more:
 * scoring the result is the pure `rankPool`, so the generator and the evaluation harness rank the same data.
 */
@Injectable()
export class CandidatePoolService {
  private readonly logger = new Logger(CandidatePoolService.name);

  constructor(
    private readonly lastfm: LastfmApiService,
    private readonly wikidata: WikidataApiService,
    private readonly artistCountries: ArtistCountryService,
  ) {}

  async gather(request: PoolRequest): Promise<CandidatePool> {
    const depth = request.countries.length > 0 ? DEEP_POOL_DEPTH : POOL_DEPTH;
    const profiled = await Promise.all(request.seeds.map((seed) => this.#profile(seed, depth)));
    const names = new Map(profiled.flatMap((seed) => [...seed.names]));
    const seedKeys = new Set(profiled.flatMap((seed) => (seed.artistName ? [artistKey(seed.artistName)] : [])));
    const walks = await Promise.all(profiled.map((seed) => this.#walk(seed, seedKeys, names)));

    const ordering = walks.flatMap((walk) => request.walks.map((kind) => walk[kind]));

    const isFiltered = request.listeners !== null || request.countries.length > 0;
    const keys: Shortlist = isFiltered
      ? await this.#filteredShortlist(ordering, profiled, seedKeys, names, request)
      : new Map(shortlist(ordering, request.perSeed, seedKeys).map((key) => [key, null]));

    const artists = await Promise.all(
      [...keys].map(([key, country]) => this.#poolArtist(key, names.get(key) ?? key, country)),
    );
    const seeds = profiled.map(
      (seed, index): PoolSeed => ({
        label: seed.label,
        artist: seed.artistName
          ? {
              key: artistKey(seed.artistName),
              name: seed.artistName,
              tags: seed.tags,
              listeners: seed.listeners,
              country: null,
            }
          : null,
        tags: seed.tags,
        listeners: seed.listeners,
        oneHop: walks[index].oneHop,
        twoHop: walks[index].twoHop,
      }),
    );
    return { seeds, artists };
  }

  async #profile(seed: PlaylistSeed, depth: PoolDepth): Promise<ProfiledSeed> {
    const direct = new Map<string, number>();
    const names = new Map<string, string>();
    const link = (name: string, strength: number): void => {
      const key = artistKey(name);
      if (key) {
        names.set(key, names.get(key) ?? name);
        direct.set(key, Math.max(direct.get(key) ?? 0, strength));
      }
    };

    if (seed.type === 'genre') {
      const tags = new Map([[normalizeTag(seed.name), 100]]);
      const artists = await this.lastfm.tagTopArtists(seed.name, depth.genreArtists);
      artists.forEach((name, rank) => link(name, rankDiscount(GENRE_PICK_MATCH, rank, artists.length)));
      return { label: seed.name, artistName: null, tags, listeners: null, direct, names };
    }

    const [rawTags, info] = await Promise.all([this.#artistTags(seed.name), this.lastfm.artistInfo(seed.name)]);
    const [similar, tagLists] = await Promise.all([
      this.lastfm.similarArtists(seed.name, depth.similar),
      Promise.all(
        topRawTags(rawTags, POOL_TAGS_PER_SEED).map((tag) => this.lastfm.tagTopArtists(tag, TAG_ARTISTS_LIMIT)),
      ),
    ]);
    similar.forEach((artist) => link(artist.name, artist.match));
    tagLists.forEach((list) =>
      list.forEach((name, rank) => link(name, rankDiscount(SIMILAR_TAG_PICK_MATCH, rank, list.length))),
    );
    return {
      label: seed.name,
      artistName: seed.name,
      tags: toTagMap(rawTags),
      listeners: info?.listeners ?? null,
      direct,
      names,
    };
  }

  /** Last.fm tags, topped up with Wikidata genres when Last.fm has too few to go on. */
  async #artistTags(artist: string): Promise<RawTag[]> {
    const lastfmTags = await this.lastfm.artistTopTags(artist);
    if (toTagMap(lastfmTags).size >= MIN_PROFILE_TAGS) {
      return lastfmTags;
    }
    const info = await this.lastfm.artistInfo(artist);
    const genres = info?.mbid ? await this.wikidata.genresByMusicBrainzId(info.mbid) : [];
    this.logger.log(`Thin Last.fm tags for ${artist}; added ${genres.length} Wikidata genres`);
    return [...lastfmTags, ...genres.map((name) => ({ name, count: WIKIDATA_TAG_WEIGHT }))];
  }

  /** Reads the similar artists of the seed's closest neighbours, then scores one and two hops out. */
  async #walk(seed: ProfiledSeed, exclude: ReadonlySet<string>, names: Map<string, string>): Promise<WalkScores> {
    const closest = [...seed.direct]
      .filter(([key]) => !exclude.has(key))
      .sort((a, b) => b[1] - a[1])
      .slice(0, SECOND_HOP_NEIGHBOURS);
    const neighbours = new Map<string, Edges>(
      await Promise.all(
        closest.map(async ([key]): Promise<[string, Edges]> => {
          const neighbour = names.get(key) ?? key;
          const similar = await this.lastfm.similarArtists(neighbour, SECOND_HOP_SIMILAR);
          const edges = new Map<string, number>();
          for (const artist of similar) {
            const similarKey = artistKey(artist.name);
            names.set(similarKey, names.get(similarKey) ?? artist.name);
            edges.set(similarKey, Math.max(edges.get(similarKey) ?? 0, artist.match));
          }
          return [key, edges];
        }),
      ),
    );
    return walkScores(seed.direct, neighbours, SECOND_HOP_DAMPING, exclude);
  }

  async #poolArtist(key: string, name: string, country: string | null): Promise<PoolArtist> {
    const [tags, info] = await Promise.all([this.lastfm.artistTopTags(name), this.lastfm.artistInfo(name)]);
    return { key, name, tags: toTagMap(tags), listeners: info?.listeners ?? null, country };
  }

  /**
   * Related artists that pass the filters. The closest matches are often all small (or all big, or all from
   * one country), so filtering one shortlist can leave nothing: widen it in rounds until every selected
   * country (or the pool as a whole) has its share, the related artists run out, or the lookup cap is hit.
   * A seed's related artists rarely span every country asked for, so countries still short after that are
   * topped up with artists from there that share the seeds' top tags.
   */
  async #filteredShortlist(
    ordering: ReadonlyMap<string, number>[],
    profiled: ProfiledSeed[],
    exclude: ReadonlySet<string>,
    names: Map<string, string>,
    request: PoolRequest,
  ): Promise<Shortlist> {
    const pool: Shortlist = new Map();
    const checked = new Set<string>();
    const perCountry = Math.ceil(request.wanted / Math.max(request.countries.length, 1));
    const shortCountries = (): string[] =>
      request.countries.filter((country) => countryCount(pool, country) < perCountry);
    const isFull = (): boolean =>
      request.countries.length === 0 ? pool.size >= request.wanted : shortCountries().length === 0;

    for (let size = request.perSeed; !isFull() && checked.size < MAX_FILTER_LOOKUPS; size *= 2) {
      const fresh = shortlist(ordering, size, exclude)
        .filter((key) => !checked.has(key))
        .slice(0, MAX_FILTER_LOOKUPS - checked.size);
      if (fresh.length === 0) {
        break;
      }
      fresh.forEach((key) => checked.add(key));
      const before = new Map(request.countries.map((country) => [country, countryCount(pool, country)]));
      for (const [key, country] of await this.#matching(fresh, names, request, new Map())) {
        pool.set(key, country);
      }
      // Stop once a round found nobody from any country still short: digging deeper rarely reaches them,
      // the tag search below does.
      const lagging = shortCountries();
      if (lagging.length > 0 && lagging.every((country) => countryCount(pool, country) === before.get(country))) {
        break;
      }
    }
    const related = pool.size;

    const short = shortCountries();
    if (short.length > 0) {
      const seedTags = profiled.map((seed) => seed.tags);
      const discovered = await this.#discoverByCountry(seedTags, short, exclude, names);
      const fresh = [...discovered.keys()].filter((key) => !checked.has(key));
      for (const [key, country] of await this.#matching(fresh, names, request, discovered)) {
        pool.set(key, country);
      }
    }

    const byCountry = request.countries.map((country) => `${country} ${countryCount(pool, country)}`).join(', ');
    this.logger.log(
      `Filters ${describeFilters(request)}: ${related} of ${checked.size} related artists pass, ` +
        `${pool.size - related} more found by tag${byCountry && ` (${byCountry})`}`,
    );
    return pool;
  }

  /** Artist key → country for artists found per country by the seeds' top tags. Registers their names. */
  async #discoverByCountry(
    seedTags: TagMap[],
    countries: string[],
    exclude: ReadonlySet<string>,
    names: Map<string, string>,
  ): Promise<Map<string, string>> {
    const tags = [...new Set(seedTags.flatMap((tagMap) => topTags(tagMap, COUNTRY_DISCOVERY_TAGS_PER_SEED)))];
    const discovered = new Map<string, string>();
    for (const [name, country] of await this.artistCountries.byTags(tags, countries, COUNTRY_DISCOVERY_LIMIT)) {
      const key = artistKey(name);
      if (key && !exclude.has(key) && !discovered.has(key)) {
        discovered.set(key, country);
        names.set(key, names.get(key) ?? name);
      }
    }
    return discovered;
  }

  /**
   * The keys that pass the filters, with their countries. The country comes from the MusicBrainz id Last.fm
   * has for the name, since that is the artist whose tracks get picked; `fallbackCountries` only covers names
   * Last.fm has no id for. Unknown listener counts count as 0; an unknown country never passes a country filter.
   */
  async #matching(
    keys: string[],
    names: Map<string, string>,
    { listeners, countries }: ArtistFilters,
    fallbackCountries: ReadonlyMap<string, string>,
  ): Promise<Shortlist> {
    const artists = await Promise.all(
      keys.map(async (key) => ({ key, info: await this.lastfm.artistInfo(names.get(key) ?? key) })),
    );
    const mbids = countries.length > 0 ? artists.flatMap(({ info }) => (info?.mbid ? [info.mbid] : [])) : [];
    const countryByMbid = await this.artistCountries.byMusicBrainzId(mbids);

    const kept: Shortlist = new Map();
    for (const { key, info } of artists) {
      const country = info?.mbid
        ? (countryByMbid.get(info.mbid.toLowerCase()) ?? null)
        : (fallbackCountries.get(key) ?? null);
      const inRange = listeners === null || withinRange(info?.listeners ?? 0, listeners);
      const inCountry = countries.length === 0 || (country !== null && countries.includes(country));
      if (inRange && inCountry) {
        kept.set(key, countries.length > 0 ? country : null);
      }
    }
    return kept;
  }
}

/** Rank 0 gets the full base strength, the last rank half of it. */
function rankDiscount(base: number, rank: number, count: number): number {
  return base * (1 - (0.5 * rank) / Math.max(count, 1));
}

function withinRange(listeners: number, { min, max }: ListenerFilter): boolean {
  return (min === null || listeners >= min) && (max === null || listeners <= max);
}

function countryCount(pool: Shortlist, country: string): number {
  return [...pool.values()].filter((value) => value === country).length;
}

/** For the log: "listeners 0–50000, countries PL IE". */
function describeFilters({ listeners, countries }: ArtistFilters): string {
  return [
    listeners && `listeners ${listeners.min ?? 0}–${listeners.max ?? '∞'}`,
    countries.length > 0 && `countries ${countries.join(' ')}`,
  ]
    .filter(Boolean)
    .join(', ');
}
