import type { TagMap } from '../engine/tags.js';

/**
 * How Last.fm listeners tag music by where it is from ("irish hip hop", "polish rap", "uk garage"), by ISO 3166-1
 * alpha-2 code, the most used word first. Countries missing here are only found through MusicBrainz.
 */
const DEMONYMS: Record<string, readonly string[]> = {
  AR: ['argentine', 'argentinian'],
  AT: ['austrian'],
  AU: ['australian', 'aussie'],
  BE: ['belgian'],
  BG: ['bulgarian'],
  BR: ['brazilian'],
  BY: ['belarusian'],
  CA: ['canadian'],
  CH: ['swiss'],
  CL: ['chilean'],
  CN: ['chinese'],
  CO: ['colombian'],
  CU: ['cuban'],
  CZ: ['czech'],
  DE: ['german'],
  DK: ['danish'],
  DZ: ['algerian'],
  EE: ['estonian'],
  EG: ['egyptian'],
  ES: ['spanish'],
  FI: ['finnish'],
  FR: ['french'],
  GB: ['uk', 'british'],
  GH: ['ghanaian'],
  GR: ['greek'],
  HR: ['croatian'],
  HU: ['hungarian'],
  ID: ['indonesian'],
  IE: ['irish'],
  IL: ['israeli'],
  IN: ['indian'],
  IR: ['iranian', 'persian'],
  IS: ['icelandic'],
  IT: ['italian'],
  JM: ['jamaican'],
  JP: ['japanese'],
  KE: ['kenyan'],
  KR: ['korean'],
  LB: ['lebanese'],
  LT: ['lithuanian'],
  LV: ['latvian'],
  MA: ['moroccan'],
  MX: ['mexican'],
  MY: ['malaysian'],
  NG: ['nigerian'],
  NL: ['dutch'],
  NO: ['norwegian'],
  NZ: ['new zealand', 'nz'],
  PE: ['peruvian'],
  PH: ['filipino'],
  PK: ['pakistani'],
  PL: ['polish'],
  PR: ['puerto rican'],
  PT: ['portuguese'],
  RO: ['romanian'],
  RS: ['serbian'],
  RU: ['russian'],
  SE: ['swedish'],
  SG: ['singaporean'],
  SI: ['slovenian'],
  SK: ['slovak'],
  SN: ['senegalese'],
  TH: ['thai'],
  TN: ['tunisian'],
  TR: ['turkish'],
  TW: ['taiwanese'],
  UA: ['ukrainian'],
  US: ['american', 'us'],
  VE: ['venezuelan'],
  VN: ['vietnamese'],
  ZA: ['south african'],
};

/** Weight (0–100) from which an artist's own nationality tag says where they are from: Kneecap's "irish" is 100. */
const OWN_TAG_MIN_WEIGHT = 5;

const COUNTRY_BY_DEMONYM = new Map(
  Object.entries(DEMONYMS).flatMap(([country, demonyms]) => demonyms.map((demonym) => [demonym, country] as const)),
);

/**
 * The country an artist's own Last.fm tags name ("irish", "polish"), the strongest one, or null. For artists
 * MusicBrainz can't place: Last.fm often has no MusicBrainz id for them, but its listeners tag where they are from.
 */
export function countryOfTags(tags: readonly { name: string; count: number }[]): string | null {
  const named = tags
    .filter((tag) => tag.count >= OWN_TAG_MIN_WEIGHT && COUNTRY_BY_DEMONYM.has(tag.name.trim().toLowerCase()))
    .sort((a, b) => b.count - a.count);
  return named.length > 0 ? (COUNTRY_BY_DEMONYM.get(named[0].name.trim().toLowerCase()) ?? null) : null;
}

/**
 * Whether `genre` (normalised) is what the artist is mainly tagged with: no tag outweighs the strongest one that
 * names it ("hip hop", "irish hip hop", "underground hip hop" all name hip hop). Kojaque's hip hop (100) is;
 * Intox's irish hip hop (66) is not, under hardcore punk (100).
 */
export function isMainlyTagged(tags: TagMap, genre: string): boolean {
  const names = new RegExp(`(^| )${genre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
  const strongest = Math.max(0, ...tags.values());
  const genreWeight = Math.max(0, ...[...tags].filter(([tag]) => names.test(tag)).map(([, weight]) => weight));
  return genreWeight > 0 && genreWeight >= strongest;
}

/**
 * Last.fm tags for `genre` as made in `country`: nationalTags('hip hop', 'IE') → ['irish hip hop', 'irish hip-hop'].
 * Both spellings, since Last.fm keeps "hip hop" and "hip-hop" apart. Empty for a country without a known demonym.
 */
export function nationalTags(genre: string, country: string): string[] {
  const name = genre.trim().toLowerCase();
  const spellings = [...new Set([name, name.replace(/ /g, '-'), name.replace(/-/g, ' ')])];
  return (DEMONYMS[country] ?? []).flatMap((demonym) => spellings.map((spelling) => `${demonym} ${spelling}`));
}
