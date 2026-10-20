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
  /** 0 = the closest artists only, 1 = as varied as possible. */
  variety: number;
  /** 0 = mostly each artist's hits, 1 = anything from their top 50 tracks. */
  deepCuts: number;
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

/** Why a track is in a playlist, saved when the app generated it. */
export interface TrackReason {
  /** The seed whose share it fills ("a + b" in Bridge mode); null for a seed artist's own track. */
  seed: string | null;
  /** The ranking's parts for the artist; null for a seed artist. */
  score: { relevance: number; walk: number; tags: number; popularityGap: number } | null;
  /** Tags the artist shares with the seed, most telling first. */
  sharedTags: string[];
  /** "Artist – Title" of a seed song whose listeners also play this one. */
  similarTo: string | null;
}

/** `why` is null for tracks added in Spotify, or made before reasons were kept. */
export interface GeneratedTrack extends PlaylistTrack {
  why: TrackReason | null;
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
  tracks: GeneratedTrack[];
}

export interface SpotifyUser {
  id: string;
  displayName: string;
}

/** The knobs of the API's ranking formula (see algorithm.md). */
export interface ScoringParams {
  walk: number;
  tags: number;
  popularity: number;
  lambda: number;
  hops: 1 | 2;
  tfidf: boolean;
}

export type EvaluationStatus = 'running' | 'done' | 'failed';

/** A mean with a 95% range. */
export interface Interval {
  mean: number;
  low: number;
  high: number;
}

/** better / worse: the 95% range of the hit-rate difference is wholly above / below zero; unclear otherwise. */
export type Verdict = 'better' | 'worse' | 'unclear';

export interface EvaluationScore {
  label: string;
  params: ScoringParams;
  /** Mean share of a playlist's other artists found in the top 50 (hit rate). */
  recall: number;
  /** Like recall, but hits near the top count more. */
  ndcg: number;
  /** Playlists where this beat / fell below the original formula. */
  wins: number;
  losses: number;
  /** Hit rate minus the original formula's, per playlist, with a 95% range; null for the original itself. */
  vsBaseline: Interval | null;
  verdict: Verdict | null;
  /** Powers of ten the top 50 sit above (+) or below (−) the seeds in listeners. */
  drift: number | null;
  /** Mean tag similarity between the top 20 artists; lower is more varied. */
  sameness: number;
}

export interface TuningResults {
  /** Each playlist scored with weights tuned on the other playlists: what tuning really gains. */
  crossValidated: EvaluationScore;
  /** The weights chosen most often across those rounds. */
  recommended: EvaluationScore;
  chosenIn: { rounds: number; total: number };
  /** Best weights scored on the playlists they were picked on: optimistic. */
  best: EvaluationScore[];
}

export interface EvaluatedPlaylist {
  id: string;
  name: string;
  artists: number;
  /** Share of the playlist's other artists that were candidates at all; null when skipped. */
  poolRecall: number | null;
  skipped: string | null;
}

export interface EvaluationResults {
  playlists: EvaluatedPlaylist[];
  /** The original formula, then the current one. */
  presets: EvaluationScore[];
  tuning: TuningResults | null;
}

export interface EvaluationRun {
  id: string;
  status: EvaluationStatus;
  startedAt: string;
  finishedAt: string | null;
  progress: { done: number; total: number };
  results: EvaluationResults | null;
  error: string | null;
}

export interface EvaluationPlaylist {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface StartEvaluation {
  playlistIds: string[];
  folds: number;
  tune: boolean;
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
