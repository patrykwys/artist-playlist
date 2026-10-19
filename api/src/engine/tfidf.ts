import { TagMap } from './tags.js';

export type TagWeigher = (tags: TagMap) => TagMap;

/**
 * TF-IDF over a set of tag profiles (one request's candidates). A tag half the candidates share says little
 * about which of them fits, so it weighs less: idf = ln((n + 1) / (df + 1)) + 1, never below 1.
 * Tags no profile has (seen only on a seed) get the highest weight.
 */
export function tfidf(profiles: readonly TagMap[]): TagWeigher {
  const documentFrequency = new Map<string, number>();
  for (const profile of profiles) {
    for (const tag of profile.keys()) {
      documentFrequency.set(tag, (documentFrequency.get(tag) ?? 0) + 1);
    }
  }
  const idf = (tag: string): number => Math.log((profiles.length + 1) / ((documentFrequency.get(tag) ?? 0) + 1)) + 1;
  return (tags) => new Map([...tags].map(([tag, weight]) => [tag, weight * idf(tag)]));
}

/** Leaves weights as they are: the original formula's plain tag overlap. */
export const unweighted: TagWeigher = (tags) => tags;
