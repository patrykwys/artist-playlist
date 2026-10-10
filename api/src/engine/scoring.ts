/** Lowercased, accent-free artist name used to merge the same artist across sources. */
export function artistKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim();
}

/** The `perSeed` best-scored artists of each seed: the only candidates worth spending tag lookups on. */
export function shortlist(
  scoresPerSeed: readonly ReadonlyMap<string, number>[],
  perSeed: number,
  exclude: ReadonlySet<string>,
): string[] {
  const keys = new Set<string>();
  for (const scores of scoresPerSeed) {
    [...scores]
      .filter(([key]) => !exclude.has(key))
      .sort((a, b) => b[1] - a[1])
      .slice(0, perSeed)
      .forEach(([key]) => keys.add(key));
  }
  return [...keys];
}

/** Splits a total as evenly as possible: quotas(10, 3) → [4, 3, 3]. */
export function quotas(total: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, index) => Math.floor(total / parts) + (index < total % parts ? 1 : 0));
}

/** Round-robin across lists: [[a1, a2], [b1]] → [a1, b1, a2]. */
export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < longest; index++) {
    for (const list of lists) {
      const item = list.at(index);
      if (item !== undefined) {
        result.push(item);
      }
    }
  }
  return result;
}

/** Takes turns between groups, keeping the order inside each: [a1, a2, b1] → [a1, b1, a2]. */
export function alternateGroups<T, G>(items: readonly T[], groupOf: (item: T) => G): T[] {
  const groups = new Map<G, T[]>();
  for (const item of items) {
    const group = groupOf(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return interleave([...groups.values()]);
}
