import { MixMode } from '../models.js';
import { TagMap, cosine } from './tags.js';

/** relevance = MATCH_WEIGHT × Last.fm match + TAG_WEIGHT × tag overlap. */
const MATCH_WEIGHT = 0.6;
const TAG_WEIGHT = 0.4;

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
  /** Candidate key → how closely Last.fm links it to this seed, 0…1. */
  matches: ReadonlyMap<string, number>;
}

/** Everything fetched for one request: ranking it is pure and fast. */
export interface CandidatePool {
  seeds: PoolSeed[];
  artists: PoolArtist[];
}

/** The parts of an artist's relevance, kept so a ranking can be explained. */
export interface Score {
  relevance: number;
  match: number;
  tags: number;
}

export interface RankedArtist extends PoolArtist {
  score: Score;
}

export interface RankedBucket {
  label: string;
  artists: RankedArtist[];
}

/**
 * relevance(c, s) = 0.6 · match_s(c) + 0.4 · cos(tags_c, tags_s)
 *
 * blend: one bucket per seed, ranked against that seed (each seed gets its share of the playlist).
 * bridge: one bucket ranked by the weakest relevance across the seeds, so only common ground rises.
 */
export function rankPool(pool: CandidatePool, mode: MixMode): RankedBucket[] {
  const byRelevance = (artists: RankedArtist[]): RankedArtist[] =>
    artists.sort((a, b) => b.score.relevance - a.score.relevance);

  if (mode === 'bridge') {
    const ranked = pool.artists.map((artist): RankedArtist => {
      const scores = pool.seeds.map((seed) => scoreAgainst(artist, seed));
      const weakest = scores.reduce((low, score) => (score.relevance < low.relevance ? score : low));
      return { ...artist, score: weakest };
    });
    return [{ label: pool.seeds.map((seed) => seed.label).join(' + '), artists: byRelevance(ranked) }];
  }

  return pool.seeds.map((seed) => ({
    label: seed.label,
    artists: byRelevance(
      pool.artists
        .map((artist): RankedArtist => ({ ...artist, score: scoreAgainst(artist, seed) }))
        // Unrelated to this seed by both links and tags: belongs in another seed's bucket.
        .filter((artist) => artist.score.match > 0 || artist.score.tags > 0),
    ),
  }));
}

export function scoreAgainst(artist: PoolArtist, seed: PoolSeed): Score {
  const match = seed.matches.get(artist.key) ?? 0;
  const tags = cosine(artist.tags, seed.tags);
  return { relevance: MATCH_WEIGHT * match + TAG_WEIGHT * tags, match, tags };
}
