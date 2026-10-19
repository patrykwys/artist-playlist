import { median } from './stats.js';
import { TagMap, cosine } from './tags.js';

/** Share of the held-out artists that appear in the first `k` of the ranking. */
export function recallAtK(ranking: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (relevant.size === 0) {
    return 0;
  }
  return ranking.slice(0, k).filter((key) => relevant.has(key)).length / relevant.size;
}

/**
 * Normalised discounted cumulative gain: like recall, but a hit at rank 1 counts more than one at rank 50.
 * 1 means every possible hit sits at the very top.
 */
export function ndcgAtK(ranking: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  const gain = (rank: number): number => 1 / Math.log2(rank + 2);
  const dcg = ranking.slice(0, k).reduce((sum, key, rank) => (relevant.has(key) ? sum + gain(rank) : sum), 0);
  let ideal = 0;
  for (let rank = 0; rank < Math.min(k, relevant.size); rank++) {
    ideal += gain(rank);
  }
  return ideal === 0 ? 0 : dcg / ideal;
}

/**
 * How many powers of ten bigger (+) or smaller (−) the ranked artists are than the seeds, as the median over
 * artists with a known listener count. +1 means the typical pick has ten times the seeds' listeners: the
 * "big names leak in" problem. Null when nothing has a count.
 */
export function popularityDrift(listeners: readonly (number | null)[], seedListeners: readonly (number | null)[]): number | null {
  const known = (values: readonly (number | null)[]): number[] =>
    values.flatMap((value) => (value === null ? [] : [Math.log10(value + 1)]));
  const picks = known(listeners);
  const seeds = known(seedListeners);
  return picks.length === 0 || seeds.length === 0 ? null : median(picks) - median(seeds);
}

/**
 * Mean tag cosine over every pair of the profiles: 1 = all alike, 0 = nothing in common. Plain tag weights,
 * so every formula is judged with the same ruler. Lower means more varied.
 */
export function sameness(profiles: readonly TagMap[]): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      total += cosine(profiles[i], profiles[j]);
      pairs++;
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}
