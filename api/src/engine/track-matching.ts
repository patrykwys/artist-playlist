import { weightedShuffle } from './random.js';

export interface SpotifyTrackHit {
  uri: string;
  name: string;
  artists: string[];
  durationMs: number;
  imageUrl: string | null;
}

/** Intros, outros, interludes and skits make poor playlist tracks. */
const SKIP_TITLE = /\b(intro|outro|interlude|skit)\b/i;
const VERSION_WORDS = 'remaster(?:ed)?|mono|stereo|radio edit|single version|album version|explicit|clean';

/** Lowercase, no accents or punctuation, without "(feat. …)" and remaster/version suffixes. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[([](?:feat|ft|with)\.?\s[^)\]]*[)\]]/g, ' ')
    .replace(new RegExp(`[([][^)\\]]*\\b(?:${VERSION_WORDS})\\b[^)\\]]*[)\\]]`, 'g'), ' ')
    .replace(new RegExp(`\\s-\\s.*\\b(?:${VERSION_WORDS})\\b.*$`), ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim();
}

/** A hit counts only when the artist and the title both match after normalising. */
export function findMatch(hits: readonly SpotifyTrackHit[], artist: string, title: string): SpotifyTrackHit | null {
  const wantedArtist = normalizeName(artist);
  const wantedTitle = normalizeName(title);
  return (
    hits.find(
      (hit) =>
        normalizeName(hit.name) === wantedTitle && hit.artists.some((name) => normalizeName(name) === wantedArtist),
    ) ?? null
  );
}

/** One of an artist's top tracks on Last.fm. */
export interface TopTrack {
  title: string;
  listeners: number;
}

/** The Deep-cuts slider maps 0…1 onto α 2…0.4 in weight = listeners^α. */
export function deepCutsExponent(deepCuts: number): number {
  return 2 - 1.6 * deepCuts;
}

/**
 * Weighted shuffle of an artist's top tracks, so reruns differ: weight = listeners^α (`deepCutsExponent`).
 * At 0 the big hits nearly always come first; at 1 a track a tenth as popular often does.
 * Intros, skits and duplicate titles are dropped.
 */
export function orderTracks(tracks: readonly TopTrack[], deepCuts: number, random: () => number = Math.random): string[] {
  const seen = new Set<string>();
  const playable = tracks.filter((track) => {
    const key = normalizeName(track.title);
    if (SKIP_TITLE.test(track.title) || !key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const exponent = deepCutsExponent(deepCuts);
  return weightedShuffle(playable, (track) => Math.pow(Math.max(track.listeners, 1), exponent), random).map(
    (track) => track.title,
  );
}
