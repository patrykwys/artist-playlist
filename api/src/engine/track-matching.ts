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
    .replace(/[̀-ͯ]/g, '')
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

/** An artist's top tracks in Last.fm's order (most played first), without intros, skits and duplicate titles. */
export function orderTracks(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  return titles.filter((title) => {
    const key = normalizeName(title);
    if (SKIP_TITLE.test(title) || !key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
