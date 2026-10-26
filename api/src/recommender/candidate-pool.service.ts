import { Injectable, Logger } from '@nestjs/common';
import { CandidatePool, PoolArtist, PoolSeed } from '../engine/ranking.js';
import { artistKey, shortlist } from '../engine/scoring.js';
import { RawTag, TagMap, blockedTagOf, normalizeTag, toTagMap, topRawTags, topTags } from '../engine/tags.js';
import { Edges, WalkScores, walkScores } from '../engine/walk.js';
import { LastfmApiService } from '../lastfm/lastfm-api.service.js';
import { CheckVerdict, ListenerFilter, PlaylistSeed, TraceSourceKind } from '../models.js';
import { GenerationTrace, NO_TRACE, TRACE_SAMPLE } from '../playlist/generation-trace.js';
import { WikidataApiService } from '../wikidata/wikidata-api.service.js';
import { ArtistCountryService } from './artist-country.service.js';
import { countryOfTags, isMainlyTagged, nationalTags } from './national-tags.js';

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
/**
 * Per national tag ("irish hip hop"): its top artists. They are exactly what a country filter asks for, so they
 * link to the seed at full strength and are checked before anyone else.
 */
const NATIONAL_TAG_ARTISTS = 100;
const NATIONAL_PICK_MATCH = 1;
/** Per selected country still short at the end: artists MusicBrainz has with the seeds' top tags. */
const COUNTRY_DISCOVERY_LIMIT = 60;
const COUNTRY_DISCOVERY_TAGS_PER_SEED = 4;
/**
 * With a country filter, the related artists are first probed with this many: a genre's global top artists are
 * mostly from elsewhere, and a probe that finds nobody from a country still short ends the digging.
 */
const WALK_PROBE = 24;
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
  /** Never candidates; the shortlist takes the next closest instead. */
  blockedArtists: string[];
  /** Last.fm tags; artists for whom one is a big part of their profile don't pass the filters. */
  blockedGenres: string[];
  /** Walks that pick the shortlist: the formula's own, or both so the old and new formulas see the same pool. */
  walks: WalkKind[];
}

type ArtistFilters = Pick<PoolRequest, 'listeners' | 'countries' | 'blockedGenres'>;

/** Reports one batch of related artists, opening the discovery stage with the first. */
type SourceReporter = (seed: string, via: TraceSourceKind, through: string, names: readonly string[]) => void;

/** Candidate key → country when a country filter is on (null otherwise). */
type Shortlist = Map<string, string | null>;

/** Where a national tag ("irish hip hop") placed an artist, and the genres of the tags that listed them. */
interface NationalOrigin {
  country: string;
  genres: Set<string>;
}

/** Artist key → where national tags placed them. */
type Origins = ReadonlyMap<string, NationalOrigin>;

interface ProfiledSeed {
  label: string;
  /** Null for a genre seed. */
  artistName: string | null;
  tags: TagMap;
  listeners: number | null;
  /** Artist key → link strength: Last.fm similar artists plus the top artists of the seed's tags. */
  direct: Map<string, number>;
  names: Map<string, string>;
  origins: Origins;
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

  async gather(request: PoolRequest, trace: GenerationTrace = NO_TRACE): Promise<CandidatePool> {
    const depth = request.countries.length > 0 ? DEEP_POOL_DEPTH : POOL_DEPTH;
    let discovering = false;
    const reportSource: SourceReporter = (seed, via, through, found) => {
      if (!discovering) {
        discovering = true;
        trace.emit({ type: 'stage', stage: 'discover' });
      }
      trace.emit({ type: 'source', seed, via, through, total: found.length, sample: found.slice(0, TRACE_SAMPLE) });
    };
    trace.emit({ type: 'stage', stage: 'seeds' });
    const profiled = await Promise.all(
      request.seeds.map((seed) => this.#profile(seed, depth, request.countries, trace, reportSource)),
    );
    const names = new Map(profiled.flatMap((seed) => [...seed.names]));
    const origins = new Map<string, NationalOrigin>();
    for (const [key, { country, genres }] of profiled.flatMap((seed) => [...seed.origins])) {
      const known = origins.get(key) ?? { country, genres: new Set() };
      genres.forEach((genre) => known.genres.add(genre));
      origins.set(key, known);
    }
    const seedKeys = new Set(profiled.flatMap((seed) => (seed.artistName ? [artistKey(seed.artistName)] : [])));
    const walks = await Promise.all(profiled.map((seed) => this.#walk(seed, seedKeys, names, reportSource)));

    // Blocked artists still link others in the walk; they just never become candidates.
    const exclude = new Set([...seedKeys, ...request.blockedArtists.map(artistKey)]);
    const ordering = walks.flatMap((walk) => request.walks.map((kind) => walk[kind]));
    trace.emit({ type: 'reached', artists: new Set(ordering.flatMap((scores) => [...scores.keys()])).size });
    trace.emit({ type: 'stage', stage: 'filter' });
    // Only for the trace: the excluded artists that would otherwise have been among the closest.
    for (const key of shortlist(ordering, request.perSeed, new Set()).filter((key) => exclude.has(key))) {
      const verdict: CheckVerdict = seedKeys.has(key) ? 'seed' : 'blocked';
      const artist = { key, name: names.get(key) ?? key, listeners: null, country: null };
      trace.emit({ type: 'check', artist, verdict, detail: null });
    }

    const isFiltered = request.listeners !== null || request.countries.length > 0 || request.blockedGenres.length > 0;
    const keys: Shortlist = isFiltered
      ? await this.#filteredShortlist(ordering, profiled, exclude, names, origins, request, trace)
      : new Map(shortlist(ordering, request.perSeed, exclude).map((key) => [key, null]));

    const artists = await Promise.all(
      [...keys].map(([key, country]) => this.#poolArtist(key, names.get(key) ?? key, country)),
    );
    if (!isFiltered) {
      // Nothing to filter on: every shortlisted artist passes, now that their listeners are known.
      for (const { key, name, listeners, country } of artists) {
        trace.emit({ type: 'check', artist: { key, name, listeners, country }, verdict: 'pass', detail: null });
      }
    }
    trace.emit({ type: 'pool', artists: artists.length });
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

  async #profile(
    seed: PlaylistSeed,
    depth: PoolDepth,
    countries: readonly string[],
    trace: GenerationTrace,
    reportSource: SourceReporter,
  ): Promise<ProfiledSeed> {
    const direct = new Map<string, number>();
    const names = new Map<string, string>();
    const origins = new Map<string, NationalOrigin>();
    const link = (name: string, strength: number): void => {
      const key = artistKey(name);
      if (key) {
        names.set(key, names.get(key) ?? name);
        direct.set(key, Math.max(direct.get(key) ?? 0, strength));
      }
    };
    // The countries' own take on the seed's genres: Last.fm's "irish hip hop" lists far more Irish rappers than
    // MusicBrainz or Wikidata know, and being listed there places them in the country (see #matching).
    const linkNational = async (genres: readonly string[]): Promise<void> => {
      const lists = await Promise.all(
        countries.flatMap((country) =>
          genres.flatMap((genre) =>
            nationalTags(genre, country).map(async (tag) => ({
              country,
              genre: normalizeTag(genre),
              tag,
              found: await this.lastfm.tagTopArtists(tag, NATIONAL_TAG_ARTISTS),
            })),
          ),
        ),
      );
      for (const { country, genre, tag, found } of lists.filter((list) => list.found.length > 0)) {
        reportSource(seed.name, 'tag', tag, found);
        found.forEach((name, rank) => {
          link(name, rankDiscount(NATIONAL_PICK_MATCH, rank, found.length));
          const key = artistKey(name);
          const origin = origins.get(key) ?? { country, genres: new Set<string>() };
          if (key && origin.country === country) {
            origin.genres.add(genre);
            origins.set(key, origin);
          }
        });
      }
    };

    if (seed.type === 'genre') {
      const tags = new Map([[normalizeTag(seed.name), 100]]);
      const profile = [{ name: seed.name, weight: 100 }];
      trace.emit({ type: 'seed', seed: seed.name, kind: 'genre', tags: profile, listeners: null });
      const [artists] = await Promise.all([
        this.lastfm.tagTopArtists(seed.name, depth.genreArtists),
        linkNational([seed.name]),
      ]);
      reportSource(seed.name, 'genre', seed.name, artists);
      artists.forEach((name, rank) => link(name, rankDiscount(GENRE_PICK_MATCH, rank, artists.length)));
      return { label: seed.name, artistName: null, tags, listeners: null, direct, names, origins };
    }

    const [rawTags, info] = await Promise.all([
      this.#artistTags(seed.name, trace),
      this.lastfm.artistInfo(seed.name),
    ]);
    const tagMap = toTagMap(rawTags);
    trace.emit({
      type: 'seed',
      seed: seed.name,
      kind: 'artist',
      tags: topTags(tagMap, TRACE_SAMPLE).map((name) => ({ name, weight: tagMap.get(name) ?? 0 })),
      listeners: info?.listeners ?? null,
    });
    const topSeedTags = topRawTags(rawTags, POOL_TAGS_PER_SEED);
    const [similar, tagLists] = await Promise.all([
      this.lastfm.similarArtists(seed.name, depth.similar).then((found) => {
        reportSource(seed.name, 'similar', seed.name, found.map((artist) => artist.name));
        return found;
      }),
      Promise.all(
        topSeedTags.map(async (tag) => {
          const found = await this.lastfm.tagTopArtists(tag, TAG_ARTISTS_LIMIT);
          reportSource(seed.name, 'tag', tag, found);
          return found;
        }),
      ),
      linkNational(topSeedTags),
    ]);
    similar.forEach((artist) => link(artist.name, artist.match));
    tagLists.forEach((list) =>
      list.forEach((name, rank) => link(name, rankDiscount(SIMILAR_TAG_PICK_MATCH, rank, list.length))),
    );
    return {
      label: seed.name,
      artistName: seed.name,
      tags: tagMap,
      listeners: info?.listeners ?? null,
      direct,
      names,
      origins,
    };
  }

  /** Last.fm tags, topped up with Wikidata genres when Last.fm has too few to go on. */
  async #artistTags(artist: string, trace: GenerationTrace): Promise<RawTag[]> {
    const lastfmTags = await this.lastfm.artistTopTags(artist);
    if (toTagMap(lastfmTags).size >= MIN_PROFILE_TAGS) {
      return lastfmTags;
    }
    const info = await this.lastfm.artistInfo(artist);
    const genres = info?.mbid ? await this.wikidata.genresByMusicBrainzId(info.mbid) : [];
    this.logger.log(`Thin Last.fm tags for ${artist}; added ${genres.length} Wikidata genres`);
    trace.emit({ type: 'wikidata', seed: artist, genres });
    return [...lastfmTags, ...genres.map((name) => ({ name, count: WIKIDATA_TAG_WEIGHT }))];
  }

  /** Reads the similar artists of the seed's closest neighbours, then scores one and two hops out. */
  async #walk(
    seed: ProfiledSeed,
    exclude: ReadonlySet<string>,
    names: Map<string, string>,
    reportSource: SourceReporter,
  ): Promise<WalkScores> {
    const closest = [...seed.direct]
      .filter(([key]) => !exclude.has(key))
      .sort((a, b) => b[1] - a[1])
      .slice(0, SECOND_HOP_NEIGHBOURS);
    const neighbours = new Map<string, Edges>(
      await Promise.all(
        closest.map(async ([key]): Promise<[string, Edges]> => {
          const neighbour = names.get(key) ?? key;
          const similar = await this.lastfm.similarArtists(neighbour, SECOND_HOP_SIMILAR);
          reportSource(seed.label, 'hop', neighbour, similar.map((artist) => artist.name));
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
   * Related artists that pass the filters. With a country filter, the artists national tags placed there go
   * first: they are what was asked for. Then the related artists, closest first, in rounds that double until
   * every selected country (or the pool as a whole) has its share, the related artists run out or the lookup cap
   * is hit. The closest matches are often all small (or all big, or all from one country), which is why one round
   * is rarely enough. With a country filter the first round is a probe, and a round that finds nobody from a
   * country still short ends the digging. Countries still short after that are topped up with artists
   * MusicBrainz has from there with the seeds' top tags.
   */
  async #filteredShortlist(
    ordering: ReadonlyMap<string, number>[],
    profiled: ProfiledSeed[],
    exclude: ReadonlySet<string>,
    names: Map<string, string>,
    origins: Origins,
    request: PoolRequest,
    trace: GenerationTrace,
  ): Promise<Shortlist> {
    const pool: Shortlist = new Map();
    const checked = new Set<string>();
    const perCountry = Math.ceil(request.wanted / Math.max(request.countries.length, 1));
    const shortCountries = (): string[] =>
      request.countries.filter((country) => countryCount(pool, country) < perCountry);
    const isFull = (): boolean =>
      request.countries.length === 0 ? pool.size >= request.wanted : shortCountries().length === 0;
    const check = async (keys: string[]): Promise<void> => {
      keys.forEach((key) => checked.add(key));
      for (const [key, country] of await this.#matching(keys, names, request, origins, trace)) {
        pool.set(key, country);
      }
    };

    const national = [...origins.keys()].filter((key) => !exclude.has(key)).slice(0, MAX_FILTER_LOOKUPS);
    if (national.length > 0) {
      await check(national);
    }
    const fromNational = pool.size;

    const isProbing = request.countries.length > 0;
    for (let size = request.perSeed, round = 0; !isFull() && checked.size < MAX_FILTER_LOOKUPS; size *= 2, round++) {
      const fresh = shortlist(ordering, size, exclude)
        .filter((key) => !checked.has(key))
        .slice(0, round === 0 && isProbing ? WALK_PROBE : MAX_FILTER_LOOKUPS - checked.size);
      if (fresh.length === 0) {
        break;
      }
      const before = new Map(request.countries.map((country) => [country, countryCount(pool, country)]));
      await check(fresh);
      // Stop once a round found nobody from any country still short: digging deeper rarely reaches them,
      // the MusicBrainz search below sometimes does.
      const lagging = shortCountries();
      if (lagging.length > 0 && lagging.every((country) => countryCount(pool, country) === before.get(country))) {
        break;
      }
    }
    const related = pool.size - fromNational;

    const short = shortCountries();
    if (short.length > 0) {
      const seedTags = profiled.map((seed) => seed.tags);
      const discovered = await this.#discoverByCountry(seedTags, short, exclude, names);
      await check(discovered.filter((key) => !checked.has(key)));
    }

    const byCountry = request.countries.map((country) => `${country} ${countryCount(pool, country)}`).join(', ');
    this.logger.log(
      `Filters ${describeFilters(request)}: ${pool.size} of ${checked.size} checked artists pass ` +
        `(${fromNational} by national tag, ${related} related, ${pool.size - fromNational - related} from ` +
        `MusicBrainz)${byCountry && `, ${byCountry}`}`,
    );
    return pool;
  }

  /**
   * Keys of artists MusicBrainz has from the countries with the seeds' top tags. Registers their names. Their
   * country still has to be confirmed by the artist Last.fm has under that name, since that one's tracks get picked:
   * MusicBrainz's Irish "Buckshot" is not the Buckshot whose songs Spotify would find.
   */
  async #discoverByCountry(
    seedTags: TagMap[],
    countries: string[],
    exclude: ReadonlySet<string>,
    names: Map<string, string>,
  ): Promise<string[]> {
    const tags = [...new Set(seedTags.flatMap((tagMap) => topTags(tagMap, COUNTRY_DISCOVERY_TAGS_PER_SEED)))];
    const discovered = new Set<string>();
    for (const name of (await this.artistCountries.byTags(tags, countries, COUNTRY_DISCOVERY_LIMIT)).keys()) {
      const key = artistKey(name);
      if (key && !exclude.has(key)) {
        discovered.add(key);
        names.set(key, names.get(key) ?? name);
      }
    }
    return [...discovered];
  }

  /**
   * The keys that pass the filters, with their countries. The country is the one a national tag placed the artist
   * in, as long as that genre is what the artist is mainly tagged with (Last.fm's "Intox" is a Serbian punk band
   * that a few people tagged irish hip hop); else the one MusicBrainz has for the id Last.fm keeps for the name
   * (that is the artist whose tracks get picked); else the one the artist's own Last.fm tags name ("irish").
   * A page several artists share gets no country at all: its tags, songs and id may each be someone else's.
   * Unknown listener counts count as 0; an unknown country never passes a country filter. Blocked genres and
   * countries cost one more Last.fm call per artist (their tags, which every candidate needs anyway).
   */
  async #matching(
    keys: string[],
    names: Map<string, string>,
    { listeners, countries, blockedGenres }: ArtistFilters,
    origins: Origins,
    trace: GenerationTrace,
  ): Promise<Shortlist> {
    const blocked = new Set(blockedGenres.map(normalizeTag));
    const artists = await Promise.all(
      keys.map(async (key) => {
        const name = names.get(key) ?? key;
        const [info, rawTags] = await Promise.all([
          this.lastfm.artistInfo(name),
          blocked.size > 0 || countries.length > 0 ? this.lastfm.artistTopTags(name) : [],
        ]);
        const tags = toTagMap(rawTags);
        const origin = origins.get(key);
        const national = origin && [...origin.genres].some((genre) => isMainlyTagged(tags, genre)) ? origin.country : null;
        return { key, info, rawTags, tags, national };
      }),
    );
    const mbids =
      countries.length > 0
        ? artists.flatMap(({ info, national }) => (info?.mbid && !info.isShared && !national ? [info.mbid] : []))
        : [];
    const countryByMbid = await this.artistCountries.byMusicBrainzId(mbids);

    const kept: Shortlist = new Map();
    for (const { key, info, rawTags, tags, national } of artists) {
      const country =
        countries.length === 0 || info?.isShared
          ? null
          : (national ??
            (info?.mbid ? countryByMbid.get(info.mbid.toLowerCase()) : undefined) ??
            countryOfTags(rawTags));
      const inRange = listeners === null || withinRange(info?.listeners ?? 0, listeners);
      const inCountry = countries.length === 0 || (country !== null && countries.includes(country));
      const blockedTag = blockedTagOf(tags, blocked);
      const verdict: CheckVerdict = !inRange ? 'listeners' : !inCountry ? 'country' : blockedTag ? 'genre' : 'pass';
      if (verdict === 'pass') {
        kept.set(key, countries.length > 0 ? country : null);
      }
      trace.emit({
        type: 'check',
        artist: { key, name: names.get(key) ?? key, listeners: info?.listeners ?? null, country },
        verdict,
        detail: verdict === 'genre' ? blockedTag : null,
      });
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

/** For the log: "listeners 0–50000, countries PL IE, not metal, emo". */
function describeFilters({ listeners, countries, blockedGenres }: ArtistFilters): string {
  return [
    listeners && `listeners ${listeners.min ?? 0}–${listeners.max ?? '∞'}`,
    countries.length > 0 && `countries ${countries.join(' ')}`,
    blockedGenres.length > 0 && `not ${blockedGenres.join(', ')}`,
  ]
    .filter(Boolean)
    .join(', ');
}
