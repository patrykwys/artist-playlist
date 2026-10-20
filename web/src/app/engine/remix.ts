import { TraceRanked, TraceScoreParts } from '../core/models';
import { RankBucket } from './engine-scene';

/** The mixing desk's faders: the formula's weights, and Variety as on the Generate page (0…1). */
export interface DeskWeights {
  walk: number;
  tags: number;
  popularity: number;
  variety: number;
}

export interface RemixedArtist {
  key: string;
  name: string;
  relevance: number;
  /** Place in the run's own picking order (seed artists left out); null when it wasn't in the run's top. */
  runPlace: number | null;
}

/** The API's Variety slider: 0…1 onto λ 1…0.4 (engine/ranking.ts lambdaForVariety). */
export function lambdaForVariety(variety: number): number {
  return 1 - 0.6 * variety;
}

export function varietyForLambda(lambda: number): number {
  return Math.min(1, Math.max(0, (1 - lambda) / 0.6));
}

/** relevance = walk · links + tags · tag match − popularity · size gap; Bridge takes the weakest seed. */
export function relevanceOf(artist: TraceRanked, weights: DeskWeights): number {
  const score = ({ walk, tags, popularityGap }: TraceScoreParts): number =>
    weights.walk * walk + weights.tags * tags - weights.popularity * popularityGap;
  return artist.perSeed?.length ? Math.min(...artist.perSeed.map(score)) : score(artist);
}

/**
 * Re-ranks a bucket's scored artists with other weights, as the API would (engine/ranking.ts and mmr.ts): by
 * relevance, then MMR with the bucket's tag similarities. Only the artists the run sent (its top 40 by
 * relevance) can be re-ranked; one further down could rise with other weights, and the desk can't see it.
 * `runOrder` is the run's picking order (keys), for comparing.
 */
export function remix(bucket: RankBucket, weights: DeskWeights, runOrder: readonly string[]): RemixedArtist[] {
  const lambda = lambdaForVariety(weights.variety);
  const remaining = bucket.artists.map((artist, index) => ({
    index,
    relevance: relevanceOf(artist, weights),
    closest: 0,
  }));
  const picked: typeof remaining = [];
  if (lambda >= 1) {
    picked.push(...remaining.sort((a, b) => b.relevance - a.relevance));
  } else {
    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestValue = Number.NEGATIVE_INFINITY;
      remaining.forEach((entry, position) => {
        const value = lambda * entry.relevance - (1 - lambda) * entry.closest;
        if (value > bestValue) {
          bestValue = value;
          bestIndex = position;
        }
      });
      const [next] = remaining.splice(bestIndex, 1);
      picked.push(next);
      for (const entry of remaining) {
        entry.closest = Math.max(entry.closest, bucket.similarity[entry.index]?.[next.index] ?? 0);
      }
    }
  }
  return picked.map(({ index, relevance }) => {
    const { key, name } = bucket.artists[index];
    const place = runOrder.indexOf(key);
    return { key, name, relevance, runPlace: place < 0 ? null : place };
  });
}

/** How many of the top `count` both orders share. */
export function overlap(remixed: readonly RemixedArtist[], runOrder: readonly string[], count: number): number {
  const runTop = new Set(runOrder.slice(0, count));
  return remixed.slice(0, count).filter((artist) => runTop.has(artist.key)).length;
}
