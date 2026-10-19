/**
 * Maximal marginal relevance: picks one item at a time, each maximising
 * λ · relevance − (1 − λ) · (similarity to the closest item already picked).
 * λ = 1 is a plain sort by relevance; lower values trade relevance for variety.
 */
export function mmr<T>(
  items: readonly T[],
  relevance: (item: T) => number,
  similarity: (a: T, b: T) => number,
  lambda: number,
): T[] {
  const remaining = items.map((item) => ({ item, relevance: relevance(item), closest: 0 }));
  if (lambda >= 1) {
    return remaining.sort((a, b) => b.relevance - a.relevance).map((entry) => entry.item);
  }

  const picked: T[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    remaining.forEach((entry, index) => {
      const value = lambda * entry.relevance - (1 - lambda) * entry.closest;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    picked.push(next.item);
    for (const entry of remaining) {
      entry.closest = Math.max(entry.closest, similarity(entry.item, next.item));
    }
  }
  return picked;
}
