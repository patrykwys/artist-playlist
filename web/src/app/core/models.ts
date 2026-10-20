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

/** Release years, both ends included. null on a side = no limit there. */
export interface YearRange {
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
  /** Years the track's album came out in; null = any year. */
  releaseYears: YearRange | null;
  /** Artists never picked, and whose tracks (features included) are never used. */
  blockedArtists: string[];
  /** Last.fm tags; artists for whom one is a big part of their profile are left out. */
  blockedGenres: string[];
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
  /** The run that made it was recorded: the Engine view can replay it. */
  hasTrace: boolean;
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

/** The steps of one generation, in order (see Visualization.md). */
export type TraceStage = 'seeds' | 'discover' | 'filter' | 'score' | 'tracks' | 'order' | 'save';

/** Where a batch of related artists came from: similar artists, a top tag, a genre seed, a second hop. */
export type TraceSourceKind = 'similar' | 'tag' | 'genre' | 'hop';

/** Why an artist did (pass) or didn't make the shortlist: the first filter it failed. */
export type CheckVerdict = 'pass' | 'seed' | 'blocked' | 'listeners' | 'country' | 'genre';

export interface TraceArtist {
  key: string;
  name: string;
  listeners: number | null;
  country: string | null;
}

export interface TraceRanked {
  key: string;
  name: string;
  relevance: number;
  walk: number;
  tags: number;
  popularityGap: number;
  /** Bridge only: the parts against each seed, whose weakest is the score. */
  perSeed?: TraceScoreParts[];
}

export interface TraceScoreParts {
  walk: number;
  tags: number;
  popularityGap: number;
}

export interface TraceLineupArtist {
  key: string;
  name: string;
  /** A seed artist put first. */
  seed: boolean;
}

export interface TraceTrack {
  uri: string;
  title: string;
  artist: string;
  /** The seed song this one fits, "Artist – Title". */
  similarTo: string | null;
}

/** What one generation did, step by step, as streamed by POST /api/playlists/trace. Mirrors api/src/models.ts. */
export type TraceEvent =
  | {
      type: 'start';
      seeds: PlaylistSeed[];
      mode: MixMode;
      length: number;
      listeners: ListenerFilter | null;
      countries: string[];
      releaseYears: YearRange | null;
      blockedArtists: string[];
      blockedGenres: string[];
      lambda: number;
      deepCuts: number;
      /** The formula's weights for this run (relevance = walk · links + tags · tag match − popularity · gap). */
      weights: { walk: number; tags: number; popularity: number };
    }
  | { type: 'stage'; stage: TraceStage }
  | {
      type: 'seed';
      seed: string;
      kind: PlaylistSeed['type'];
      tags: { name: string; weight: number }[];
      listeners: number | null;
    }
  | { type: 'wikidata'; seed: string; genres: string[] }
  | { type: 'source'; seed: string; via: TraceSourceKind; through: string; total: number; sample: string[] }
  | { type: 'reached'; artists: number }
  | { type: 'check'; artist: TraceArtist; verdict: CheckVerdict; detail: string | null }
  | { type: 'pool'; artists: number }
  | {
      type: 'rank';
      /** `similarity[i][j]`: tag similarity of artists i and j, what variety (MMR) pushes apart; 2 decimals. */
      buckets: { label: string; artists: TraceRanked[]; similarity: number[][] }[];
    }
  | { type: 'lineup'; buckets: { label: string; artists: TraceLineupArtist[] }[] }
  | {
      type: 'lookup';
      bucket: number;
      artist: { key: string; name: string };
      track: TraceTrack | null;
      detail: string | null;
      pass: 1 | 2 | 3;
    }
  | { type: 'chain'; order: string[]; score: number }
  | { type: 'reverse'; from: number; to: number }
  | { type: 'ordered'; score: number }
  | { type: 'saved'; name: string; url: string }
  /** A dry run stopped here instead of saving. */
  | { type: 'unsaved'; name: string }
  | { type: 'done'; playlist: GeneratedPlaylist }
  /** `status` 401: the Spotify session is gone. */
  | { type: 'error'; message: string; status: number };
