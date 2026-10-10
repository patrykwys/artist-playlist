import { MixMode, PlaylistSeed } from '../models.js';

/**
 * The Spotify playlist description is the only place a generated playlist remembers how it was made,
 * so it doubles as the marker that tells this app's playlists apart from everything else in the library.
 */
const MARKER = 'Made with Artist mix and Last.fm data.';
const LEGACY_MARKER = 'Built with Last.fm data.';
const SEPARATOR = ' · ';
const MAX_LENGTH = 300;

export interface ParsedDescription {
  seeds: PlaylistSeed[];
  mode: MixMode | null;
}

export function buildDescription(seeds: readonly PlaylistSeed[], mode: MixMode): string {
  const names = seeds.map((seed) => (seed.type === 'genre' ? `${seed.name} (genre)` : seed.name)).join(SEPARATOR);
  const tail = `. Mix: ${mode}. ${MARKER}`;
  return `Seeds: ${names.slice(0, MAX_LENGTH - tail.length - 'Seeds: '.length)}${tail}`;
}

export function isMadeByApp(description: string | null): boolean {
  const text = decodeHtml(description ?? '');
  return text.includes(MARKER) || text.includes(LEGACY_MARKER);
}

/** Reads both the current format and the first version ("Seeds: a, b. Mode: blend. Built with Last.fm data."). */
export function parseDescription(description: string | null): ParsedDescription {
  const match = /Seeds: (.*?)\.\s+(?:Mix|Mode): (blend|bridge)\./.exec(decodeHtml(description ?? ''));
  if (!match) {
    return { seeds: [], mode: null };
  }
  const [, list, mode] = match;
  const parts = list.includes(SEPARATOR.trim()) ? list.split(SEPARATOR.trim()) : list.split(',');
  const seeds = parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part): PlaylistSeed => {
      const genre = /^(.*) \(genre\)$/.exec(part);
      return genre ? { type: 'genre', name: genre[1] } : { type: 'artist', name: part };
    });
  return { seeds, mode: mode === 'bridge' ? 'bridge' : 'blend' };
}

/** Spotify returns descriptions HTML-escaped ("Guns N&#x27; Roses"). */
export function decodeHtml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
