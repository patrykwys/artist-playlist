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

