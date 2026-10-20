import { seededRandom } from './random.js';

/** A mean with a 95% range: the true mean lies between `low` and `high` 19 times out of 20. */
export interface Interval {
  mean: number;
  low: number;
  high: number;
}

const BOOTSTRAP_ROUNDS = 2000;

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Percentile bootstrap of a mean: resample the values with replacement many times and take the middle 95% of
 * the resampled means. Fed per-playlist differences (new − old), it says whether a change is better on
 * playlists like these or just lucky on the ones measured. Seeded, so the same data gives the same range.
 */
export function bootstrapMean(values: readonly number[], rounds = BOOTSTRAP_ROUNDS, seed = 1): Interval {
  if (values.length === 0) {
    return { mean: 0, low: 0, high: 0 };
  }
  const random = seededRandom(seed);
  const means: number[] = [];
  for (let round = 0; round < rounds; round++) {
    let sum = 0;
    for (let draw = 0; draw < values.length; draw++) {
      sum += values[Math.floor(random() * values.length)];
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return {
    mean: mean(values),
    low: means[Math.floor(0.025 * (rounds - 1))],
    high: means[Math.ceil(0.975 * (rounds - 1))],
  };
}
