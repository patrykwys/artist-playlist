/** 2-opt passes after the greedy chain; each is O(n²) lookups and they usually settle in three or four. */
const MAX_REPAIR_PASSES = 25;
/** A reversal must gain at least this much, so float noise can't make it flip back and forth. */
const MIN_GAIN = 1e-9;

/**
 * Orders tracks so neighbours sound alike. Starts with the first item, keeps appending the remaining item most
 * similar to the last one (greedy nearest neighbour), then repairs the chain with 2-opt. Never puts the same
 * artist twice in a row while another choice exists. Ties keep the original order.
 */
export function flowOrder<T>(
  items: readonly T[],
  similarity: (a: T, b: T) => number,
  artistOf: (item: T) => string,
): T[] {
  // Work on indices with every pair scored once: similarity is a tag cosine, and 2-opt asks for pairs often.
  const artists = items.map(artistOf);
  const scores = items.map((a, i) => items.map((b, j) => (i === j ? 0 : similarity(a, b))));
  const sim = (i: number, j: number): number => scores[i][j];
  const differentArtist = (i: number, j: number): boolean => artists[i] !== artists[j];
  const greedy = nearestNeighbourChain(items.length, sim, differentArtist);
  return repairWithTwoOpt(greedy, sim, differentArtist).map((index) => items[index]);
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

/**
 * Greedy chaining saves its worst joins for last: the tracks nobody was close to pile up at the end.
 * 2-opt reverses a stretch [i..j] whenever that makes the two joins at its ends more similar in total and
 * puts no artist next to itself; joins inside the stretch are unchanged by a reversal. The opener stays first.
 */
export function repairWithTwoOpt(
  chain: readonly number[],
  sim: (i: number, j: number) => number,
  differentArtist: (i: number, j: number) => boolean,
): number[] {
  const path = [...chain];
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {
    let improved = false;
    for (let i = 1; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const before = path[i - 1];
        const first = path[i];
        const last = path[j];
        const after = path.at(j + 1);
        const joinAfter = (a: number): number => (after === undefined ? 0 : sim(a, after));
        const gain = sim(before, last) + joinAfter(first) - sim(before, first) - joinAfter(last);
        const allowed = differentArtist(before, last) && (after === undefined || differentArtist(first, after));
        if (gain > MIN_GAIN && allowed) {
          path.splice(i, j - i + 1, ...path.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) {
      break;
    }
  }
  return path;
}
