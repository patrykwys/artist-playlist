/** A stable hue per artist name, for the initials disc. */
export function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** "Snow Strippers" → "SS", "Grimes" → "GR". */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Same as the API's artistKey (engine/scoring.ts): how one artist is recognised across sources. */
export function artistKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim();
}

/** 'yes' for the followed artist's cards, 'no' for every other card while one is followed. */
export function pinState(pinned: string | null, ...keys: string[]): 'yes' | 'no' | null {
  return pinned === null ? null : keys.includes(pinned) ? 'yes' : 'no';
}
