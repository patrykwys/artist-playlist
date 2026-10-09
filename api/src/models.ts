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

export interface PlaylistTrack {
  uri: string;
  title: string;
  artist: string;
  durationMs: number;
  imageUrl: string | null;
}

export interface SpotifyUser {
  id: string;
  displayName: string;
}
