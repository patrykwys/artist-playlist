/** Mirrors api/src/models.ts. */

export interface ArtistSeed {
  type: 'artist';
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface GenreSeed {
  type: 'genre';
  name: string;
  reach: number;
}

export type Seed = ArtistSeed | GenreSeed;

export interface SearchResults {
  artists: ArtistSeed[];
  genres: GenreSeed[];
}

export interface SpotifyUser {
  id: string;
  displayName: string;
}

export const EMPTY_RESULTS: SearchResults = { artists: [], genres: [] };

export function seedKey(seed: Seed): string {
  return seed.type === 'artist' ? `artist:${seed.id}` : `genre:${seed.name.toLowerCase()}`;
}

/** Nest's error body. Validation failures send one message per invalid field. */
export interface ApiError {
  statusCode: number;
  message: string | string[];
}
