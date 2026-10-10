/** Shapes shared with the Angular app (web/src/app/core/models.ts mirrors these). */

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

/** Last.fm listeners per artist. null on a side = no limit there. */
export interface ListenerFilter {
  min: number | null;
  max: number | null;
}

/** The web app sends full Seeds; generating a playlist only needs each seed's type and name. */
export interface GenerateRequest {
  seeds: PlaylistSeed[];
  length: number;
  mode: MixMode;
  includeSeedArtists: boolean;
  name: string;
  listeners: ListenerFilter | null;
  /** ISO 3166-1 alpha-2 codes ('PL'); artists must come from one of them. Empty = any country. */
  countries: string[];
}

export interface PlaylistTrack {
  uri: string;
  title: string;
  artist: string;
  durationMs: number;
  imageUrl: string | null;
}

/** A seed by name only: what the generator uses and what the playlist description remembers (no Spotify ids). */
export interface PlaylistSeed {
  type: 'artist' | 'genre';
  name: string;
}

/** A playlist made by this app, either just generated or read back from the user's Spotify library. */
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
