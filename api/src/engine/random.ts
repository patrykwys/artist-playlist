/** A seeded random source (mulberry32): the same seed always gives the same sequence, so evaluations repeat. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable 32-bit number for a string (FNV-1a), to seed `seededRandom` per playlist. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Weighted order without replacement (Efraimidis–Spirakis): key = u^(1/w), highest first.
 * Heavier items tend to come first, but any item can.
 */
export function weightedShuffle<T>(items: readonly T[], weightOf: (item: T) => number, random: () => number): T[] {
  return items
    .map((item) => ({ item, key: Math.pow(random(), 1 / Math.max(weightOf(item), Number.MIN_VALUE)) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.item);
}

/** `count` distinct items picked uniformly at random. */
export function sample<T>(items: readonly T[], count: number, random: () => number): T[] {
  return weightedShuffle(items, () => 1, random).slice(0, count);
}
