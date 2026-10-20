import { MixMode, ScoringParams } from '../models.js';
import { mmr } from './mmr.js';
import { popularityGap } from './popularity.js';
import { TagMap, cosine } from './tags.js';
import { tfidf, unweighted } from './tfidf.js';

/** The formula before this rework: 0.6 × Last.fm match + 0.4 × plain tag overlap, sorted. */
export const BASELINE_PARAMS: ScoringParams = { walk: 0.6, tags: 0.4, popularity: 0, lambda: 1, hops: 1, tfidf: false };

/** The Variety slider maps 0…1 onto λ 1…0.4. */
export function lambdaForVariety(variety: number): number {
  return 1 - 0.6 * variety;
}

/** λ 0.85: a mild nudge away from near-duplicates. Not measured yet; the lab reports what it costs. */
export const DEFAULT_VARIETY = 0.25;

/**
 * Starting weights from the design (algorithm.md), not yet tuned: replace them with the lab's cross-validated
 * recommendation once a run says "better". λ here is the default Variety; generating a playlist replaces it
 * with the slider's value, and the harness scores relevance at λ = 1.
 */
export const DEFAULT_PARAMS: ScoringParams = {
  walk: 0.5,
  tags: 0.4,
  popularity: 0.2,
  lambda: lambdaForVariety(DEFAULT_VARIETY),
  hops: 2,
  tfidf: true,
};

export interface PoolArtist {
  key: string;
  name: string;
  /** Last.fm tags, normalised (engine/tags.ts). */
  tags: TagMap;
  /** Last.fm listeners; null when unknown. */
  listeners: number | null;
  /** ISO 3166-1 alpha-2, when a country filter asked for it. */
  country: string | null;
}

export interface PoolSeed {
  label: string;
  /** The seed artist itself; null for a genre seed. */
  artist: PoolArtist | null;
  tags: TagMap;
  listeners: number | null;
  /** Candidate key → walk score from this seed, 0…1. */
  oneHop: ReadonlyMap<string, number>;
  twoHop: ReadonlyMap<string, number>;
}

/** Everything fetched for one request: ranking it is pure and fast, so it can be re-ranked with other params. */
export interface CandidatePool {
  seeds: PoolSeed[];
  artists: PoolArtist[];
}

/** The parts of an artist's relevance, kept so a ranking can be explained. */
export interface Score {
  relevance: number;
  walk: number;
  tags: number;
  popularityGap: number;
}

export interface RankedArtist extends PoolArtist {
  score: Score;
}

export interface RankedBucket {
  label: string;
  artists: RankedArtist[];
}

/**
 * relevance(c, s) = walk · walk_s(c) + tags · cos(c, s) − popularity · gap(c, s)
 *
 * blend: one bucket per seed, ranked against that seed (each seed gets its share of the playlist).
 * bridge: one bucket ranked by the weakest relevance across the seeds, so only common ground rises.
 * Each bucket is then ordered by MMR with `lambda`, so near-identical artists don't take every slot.
 */
export function rankPool(pool: CandidatePool, params: ScoringParams, mode: MixMode): RankedBucket[] {
  const { scoreAgainst, vectorOf } = scorer(pool, params);
  const order = (artists: RankedArtist[]): RankedArtist[] =>
    mmr(
      artists,
      (artist) => artist.score.relevance,
      (a, b) => cosine(vectorOf(a), vectorOf(b)),
      params.lambda,
    );

  if (mode === 'bridge') {
    const ranked = pool.artists.map((artist): RankedArtist => {
      const scores = pool.seeds.map((_, index) => scoreAgainst(artist, index));
      const weakest = scores.reduce((low, score) => (score.relevance < low.relevance ? score : low));
      return { ...artist, score: weakest };
    });
    return [{ label: pool.seeds.map((seed) => seed.label).join(' + '), artists: order(ranked) }];
  }

  return pool.seeds.map((seed, index) => ({
    label: seed.label,
    artists: order(
      pool.artists
        .map((artist): RankedArtist => ({ ...artist, score: scoreAgainst(artist, index) }))
        // Unrelated to this seed by both links and tags: belongs in another seed's bucket.
        .filter((artist) => artist.score.walk > 0 || artist.score.tags > 0),
    ),
  }));
}

export interface Scorer {
  /** relevance(c, s) and its parts, against the seed at `seedIndex`. */
  scoreAgainst(artist: PoolArtist, seedIndex: number): Score;
  /** The artist's tag profile with the request's rarity weighting (TF-IDF or plain). */
  vectorOf(artist: PoolArtist): TagMap;
}

/** rankPool's building blocks, also for explaining a ranking (the Engine view's mixing desk). */
export function scorer(pool: CandidatePool, params: ScoringParams): Scorer {
  const weigh = params.tfidf ? tfidf(pool.artists.map((artist) => artist.tags)) : unweighted;
  const vectors = new Map(pool.artists.map((artist) => [artist.key, weigh(artist.tags)]));
  const seedVectors = pool.seeds.map((seed) => weigh(seed.tags));
  const vectorOf = (artist: PoolArtist): TagMap => vectors.get(artist.key) ?? weigh(artist.tags);
  return {
    vectorOf,
    scoreAgainst: (artist, seedIndex) => {
      const seed = pool.seeds[seedIndex];
      const walk = (params.hops === 2 ? seed.twoHop : seed.oneHop).get(artist.key) ?? 0;
      const tags = cosine(vectorOf(artist), seedVectors[seedIndex]);
      const gap = popularityGap(artist.listeners, seed.listeners);
      const relevance = params.walk * walk + params.tags * tags - params.popularity * gap;
      return { relevance, walk, tags, popularityGap: gap };
    },
  };
}
