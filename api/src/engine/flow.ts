/**
 * Orders tracks so neighbours sound alike. Starts with the first item, keeps appending the remaining item most
 * similar to the last one (greedy nearest neighbour). Never puts the same artist twice in a row while another
 * choice exists. Ties keep the original order.
 */
export function flowOrder<T>(
  items: readonly T[],
  similarity: (a: T, b: T) => number,
  artistOf: (item: T) => string,
): T[] {
  // Work on indices with every pair scored once.
  const artists = items.map(artistOf);
  const scores = items.map((a, i) => items.map((b, j) => (i === j ? 0 : similarity(a, b))));
  const sim = (i: number, j: number): number => scores[i][j];
  const differentArtist = (i: number, j: number): boolean => artists[i] !== artists[j];
  return nearestNeighbourChain(items.length, sim, differentArtist).map((index) => items[index]);
}

/** The greedy pass on its own: from item 0, always the most similar remaining item, other artists first. */
export function nearestNeighbourChain(
  count: number,
  sim: (i: number, j: number) => number,
  differentArtist: (i: number, j: number) => boolean,
): number[] {
  const remaining = Array.from({ length: count }, (_, index) => index);
  const chain: number[] = [];
  let current = remaining.shift();
  while (current !== undefined) {
    chain.push(current);
    const last = current;
    const otherArtists = remaining.filter((index) => differentArtist(index, last));
    const choices = otherArtists.length > 0 ? otherArtists : remaining;
    let next: number | undefined;
    let nextSimilarity = Number.NEGATIVE_INFINITY;
    for (const index of choices) {
      if (sim(last, index) > nextSimilarity) {
        nextSimilarity = sim(last, index);
        next = index;
      }
    }
    if (next !== undefined) {
      remaining.splice(remaining.indexOf(next), 1);
    }
    current = next;
  }
  return chain;
}
