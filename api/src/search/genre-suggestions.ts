import { isUsableTag, normalizeTag } from '../engine/tags.js';
import { GenreSeed } from '../models.js';

/**
 * Genres whose name contains the text, best first: the genre itself, then those with a word starting with it
 * ("metal" → "black metal"), then the rest ("pop" → "synthpop"); the most listeners reached first within each.
 * Junk tags ("seen live") and second spellings of a genre ("synth pop" after "synthpop") are left out.
 */
export function suggestGenres(vocabulary: readonly GenreSeed[], query: string, limit: number): GenreSeed[] {
  const text = normalizeTag(query);
  if (!text) {
    return [];
  }
  const seen = new Set<string>();
  const matches: { genre: GenreSeed; rank: number }[] = [];
  for (const genre of [...vocabulary].sort((a, b) => b.reach - a.reach)) {
    const name = normalizeTag(genre.name);
    if (!isUsableTag(name) || seen.has(name) || !name.includes(text)) {
      continue;
    }
    seen.add(name);
    matches.push({ genre, rank: name === text ? 0 : ` ${name}`.includes(` ${text}`) ? 1 : 2 });
  }
  return matches
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ genre }) => genre);
}
