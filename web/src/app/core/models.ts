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

export type MixMode = 'blend' | 'bridge';

/** null on a side = no limit there. */
export interface ListenerFilter {
  min: number | null;
  max: number | null;
}

export interface PlaylistOptions {
  name: string;
  length: number;
  mode: MixMode;
  includeSeedArtists: boolean;
  /** Last.fm listeners per artist; null = no filter. */
  listeners: ListenerFilter | null;
  /** ISO 3166-1 alpha-2 codes (['PL', 'IE']); artists must come from one of them. [] = any country. */
  countries: string[];
}

export interface GenerateRequest extends PlaylistOptions {
  seeds: Seed[];
}

export interface PlaylistTrack {
  uri: string;
  title: string;
  artist: string;
  durationMs: number;
  imageUrl: string | null;
}

/** Seeds as remembered in the playlist's Spotify description. */
export interface PlaylistSeed {
  type: 'artist' | 'genre';
  name: string;
}

/** A playlist made by this app: just generated, or read back from your Spotify library. */
export interface GeneratedPlaylist {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  createdAt: string | null;
  mode: MixMode | null;
  seeds: PlaylistSeed[];
  durationMs: number;
  tracks: PlaylistTrack[];
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
