/** Neighbour key → link strength from 0 to 1 (Last.fm's similar-artist match). */
export type Edges = ReadonlyMap<string, number>;

export interface WalkScores {
  /** Direct links only. */
  oneHop: Map<string, number>;
  /** Direct links plus links through the seed's closest neighbours. */
  twoHop: Map<string, number>;
}

/**
 * Scores every artist reachable from one seed. Two hops: walk(c) = direct(c) + damping · Σₙ direct(n) · edge(n, c),
 * so an artist that several close neighbours point to outranks one that a single neighbour mentions.
 * Both maps are scaled so the best artist scores 1; `exclude` (the seeds) never scores.
 */
export function walkScores(
  direct: Edges,
  neighbours: ReadonlyMap<string, Edges>,
  damping: number,
  exclude: ReadonlySet<string>,
): WalkScores {
  const twoHop = new Map(direct);
  for (const [via, viaStrength] of direct) {
    for (const [key, strength] of neighbours.get(via) ?? []) {
      twoHop.set(key, (twoHop.get(key) ?? 0) + damping * viaStrength * strength);
    }
  }
  return { oneHop: normalized(direct, exclude), twoHop: normalized(twoHop, exclude) };
}

function normalized(scores: Edges, exclude: ReadonlySet<string>): Map<string, number> {
  const kept = [...scores].filter(([key, score]) => !exclude.has(key) && score > 0);
  const best = Math.max(0, ...kept.map(([, score]) => score));
  return new Map(best === 0 ? [] : kept.map(([key, score]) => [key, score / best]));
}
