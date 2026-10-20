export type TagMap = ReadonlyMap<string, number>;

export interface RawTag {
  name: string;
  count: number;
}

/** Tags that say nothing about how the music sounds. */
const JUNK_TAGS = new Set([
  'seen live',
  'favorites',
  'favourites',
  'favorite',
  'favourite',
  'my favorite',
  'my favourites',
  'love',
  'loved',
  'awesome',
  'amazing',
  'beautiful',
  'cool',
  'good',
  'best',
  'all',
  'albums i own',
  'under 2000 listeners',
  'spotify',
  'check out',
  'male vocalists',
  'female vocalists',
  'male vocalist',
  'female vocalist',
  'vocalist',
  'singer songwriter',
  'artist',
  'band',
]);

const PLACE_TAGS = new Set([
  'american',
  'usa',
  'us',
  'british',
  'uk',
  'english',
  'irish',
  'scottish',
  'welsh',
  'australian',
  'australia',
  'canadian',
  'canada',
  'german',
  'french',
  'swedish',
  'norwegian',
  'finnish',
  'danish',
  'dutch',
  'belgian',
  'polish',
  'italian',
  'spanish',
  'japanese',
  'korean',
  'brazilian',
  'mexican',
  'ghanaian',
  'nigerian',
  'african',
  'european',
  'new york',
  'london',
  'los angeles',
  'atlanta',
  'chicago',
]);

const ALIASES = new Map([
  ['hiphop', 'hip hop'],
  ['r and b', 'rnb'],
  ['randb', 'rnb'],
  ['r b', 'rnb'],
  ['synth pop', 'synthpop'],
  ['electro pop', 'electropop'],
  ['lo fi', 'lofi'],
]);

export function normalizeTag(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[_/-]+/g, ' ')
    .replace(/[^a-z0-9 +]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES.get(cleaned) ?? cleaned;
}

export function isUsableTag(tag: string): boolean {
  return tag.length > 1 && !JUNK_TAGS.has(tag) && !PLACE_TAGS.has(tag) && !/^\d+$/.test(tag);
}

/** Weighted tag profile: junk and low-weight tags dropped, spellings merged (strongest weight wins). */
export function toTagMap(tags: readonly RawTag[], minWeight = 10): Map<string, number> {
  const map = new Map<string, number>();
  for (const tag of tags) {
    if (!Number.isFinite(tag.count) || tag.count < minWeight) {
      continue;
    }
    const name = normalizeTag(tag.name);
    if (isUsableTag(name)) {
      map.set(name, Math.max(map.get(name) ?? 0, tag.count));
    }
  }
  return map;
}

export function cosine(a: TagMap, b: TagMap): number {
  let dot = 0;
  for (const [tag, weight] of a) {
    dot += weight * (b.get(tag) ?? 0);
  }
  const norm = magnitude(a) * magnitude(b);
  return norm === 0 ? 0 : dot / norm;
}

/**
 * The strongest usable tags as Last.fm spells them ("hip-hop", not "hip hop"),
 * because tag lookups on Last.fm are exact.
 */
export function topRawTags(tags: readonly RawTag[], count: number, minWeight = 10): string[] {
  const seen = new Set<string>();
  return [...tags]
    .filter((tag) => tag.count >= minWeight)
    .sort((a, b) => b.count - a.count)
    .filter((tag) => {
      const name = normalizeTag(tag.name);
      if (!isUsableTag(name) || seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .slice(0, count)
    .map((tag) => tag.name);
}

function magnitude(map: TagMap): number {
  let sum = 0;
  for (const weight of map.values()) {
    sum += weight * weight;
  }
  return Math.sqrt(sum);
}

/** The `count` heaviest tags of a profile, heaviest first. */
export function topTags(tags: TagMap, count: number): string[] {
  return [...tags]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([tag]) => tag);
}

/**
 * The tags two profiles have in common, the heaviest product of weights first: with TF-IDF weights, the
 * rare, strongly held tags that best explain why two artists match.
 */
export function sharedTags(a: TagMap, b: TagMap, count: number): string[] {
  return [...a]
    .flatMap(([tag, weight]): [string, number][] => (b.has(tag) ? [[tag, weight * (b.get(tag) ?? 0)]] : []))
    .sort((x, y) => y[1] - x[1])
    .slice(0, count)
    .map(([tag]) => tag);
}

/**
 * Weight (0–100, the artist's top tag being 100) from which a tag counts as part of who the artist is:
 * Deftones' "metal" (46) does, Radiohead's "electronic" (11) does not.
 */
export const BLOCKED_TAG_WEIGHT = 20;

/** Whether one of the blocked tags (normalised) is a big part of the profile. Exact tags only: "metal" ≠ "nu metal". */
export function hasBlockedTag(tags: TagMap, blocked: ReadonlySet<string>): boolean {
  return blockedTagOf(tags, blocked) !== null;
}

/** The first blocked tag that weighs enough in the profile to leave the artist out, or null. */
export function blockedTagOf(tags: TagMap, blocked: ReadonlySet<string>): string | null {
  return [...blocked].find((tag) => (tags.get(tag) ?? 0) >= BLOCKED_TAG_WEIGHT) ?? null;
}

/** Several profiles as one: weights summed per tag (the seeds of a Bridge playlist together). */
export function combineTags(profiles: readonly TagMap[]): Map<string, number> {
  const combined = new Map<string, number>();
  for (const profile of profiles) {
    for (const [tag, weight] of profile) {
      combined.set(tag, (combined.get(tag) ?? 0) + weight);
    }
  }
  return combined;
}
