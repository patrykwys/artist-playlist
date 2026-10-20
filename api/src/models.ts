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

/** Release years, both ends included. null on a side = no limit there. */
export interface YearRange {
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
  /** Years the track's release (its album on Spotify) came out in; null = any year. */
  releaseYears: YearRange | null;
  /** Artists never picked, and whose tracks (features included) are never used. */
  blockedArtists: string[];
  /** Last.fm tags; artists for whom one of them is a big part of their profile are left out. */
  blockedGenres: string[];
  /** 0 = the closest artists only, 1 = as varied as possible (MMR). */
  variety: number;
  /** 0 = mostly each artist's hits, 1 = anything from their top 50 tracks. */
  deepCuts: number;
  /** Do everything but save: no Spotify playlist, nothing stored. For watching the engine work. */
  dryRun: boolean;
}

/**
 * The knobs of the ranking formula:
 * relevance = walk · walkScore + tags · tagCosine − popularity · popularityGap, then MMR with `lambda`.
 */
export interface ScoringParams {
  walk: number;
  tags: number;
  popularity: number;
  /** 1 = rank by relevance alone; lower values trade relevance for variety. */
  lambda: number;
  /** 1 = Last.fm's similar artists only; 2 = also their similar artists. */
  hops: 1 | 2;
  /** Weigh tags by rarity (TF-IDF) instead of counting every tag the same. */
  tfidf: boolean;
}

export type EvaluationStatus = 'running' | 'done' | 'failed';

/** A mean with a 95% range. */
export interface Interval {
  mean: number;
  low: number;
  high: number;
}

/**
 * better / worse: the 95% range of the per-playlist difference in hit rate lies wholly above / below zero.
 * unclear: it straddles zero, so the measured playlists can't tell the two apart.
 */
export type Verdict = 'better' | 'worse' | 'unclear';

/** How well one set of ScoringParams predicts the rest of your playlists from three of their artists. */
export interface EvaluationScore {
  label: string;
  params: ScoringParams;
  /** Mean share of held-out artists in the top 50 (the hit rate). */
  recall: number;
  /** Like recall, but hits near the top count more. */
  ndcg: number;
  /** Playlists where this beat / fell below the baseline's recall. */
  wins: number;
  losses: number;
  /** Hit rate minus the baseline's, per playlist, with a bootstrap 95% range. Null for the baseline itself. */
  vsBaseline: Interval | null;
  verdict: Verdict | null;
  /** Guardrail: powers of ten the top 50 sit above (+) or below (−) the seeds in Last.fm listeners. */
  drift: number | null;
  /** Guardrail: mean tag cosine between the top 20 artists; lower is more varied. */
  sameness: number;
}

export interface TuningResults {
  /**
   * Each playlist scored with the weights tuned on the other playlists (leave-one-playlist-out): what tuning
   * really gains on a playlist it has not seen. Compare this, not `best`, with the current formula.
   */
  crossValidated: EvaluationScore;
  /** The weights those rounds chose most often, scored on every playlist. */
  recommended: EvaluationScore;
  /** In how many of the rounds the recommended weights won: low agreement means the choice is noise. */
  chosenIn: { rounds: number; total: number };
  /** The best grid points scored on the same playlists they were picked on: optimistic by construction. */
  best: EvaluationScore[];
}

export interface EvaluatedPlaylist {
  id: string;
  name: string;
  artists: number;
  /** Mean share of held-out artists that were candidates at all: the most any ranking could reach. */
  poolRecall: number | null;
  /** Why the playlist was left out, when it was. */
  skipped: string | null;
}

export interface EvaluationResults {
  playlists: EvaluatedPlaylist[];
  /** The original formula first, then the current one. */
  presets: EvaluationScore[];
  /** Null when not asked for, or with fewer playlists than cross-validation needs. */
  tuning: TuningResults | null;
}

export interface EvaluationRun {
  id: string;
  status: EvaluationStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Folds (seed draws) done so far, of `total`. */
  progress: { done: number; total: number };
  results: EvaluationResults | null;
  error: string | null;
}

/** One of your own playlists the evaluation can learn from. */
export interface EvaluationPlaylist {
  id: string;
  name: string;
  imageUrl: string | null;
}

export interface PlaylistTrack {
  uri: string;
  title: string;
  artist: string;
  durationMs: number;
  imageUrl: string | null;
}

/** Why a track is in a playlist: saved when the app generated it, so it can be explained later. */
export interface TrackReason {
  /** The seed whose share it fills ("a + b" in Bridge mode); null for a seed artist's own track. */
  seed: string | null;
  /** The ranking's parts for the artist (engine/ranking.ts); null for a seed artist. */
  score: { relevance: number; walk: number; tags: number; popularityGap: number } | null;
  /** Tags the artist shares with the seed, the most telling (rarest, heaviest) first. */
  sharedTags: string[];
  /** "Artist – Title" of a seed song whose listeners also play this one; null when it is a top track. */
  similarTo: string | null;
}

/** A track of a playlist this app made; `why` is null for tracks added in Spotify or made before reasons were kept. */
export interface GeneratedTrack extends PlaylistTrack {
  why: TrackReason | null;
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
  tracks: GeneratedTrack[];
  /** Whether the run that made it was recorded, so the Engine view can replay it. */
  hasTrace: boolean;
}

export interface SpotifyUser {
  id: string;
  displayName: string;
}

/** The steps of one generation, in order: what the Engine view's stations show. */
export type TraceStage = 'seeds' | 'discover' | 'filter' | 'score' | 'tracks' | 'order' | 'save';

/** Where a batch of related artists came from: Last.fm similar artists, a top tag, a genre seed, a second hop. */
export type TraceSourceKind = 'similar' | 'tag' | 'genre' | 'hop';

/** Why an artist did (pass) or didn't make the shortlist: the first filter it failed. */
export type CheckVerdict = 'pass' | 'seed' | 'blocked' | 'listeners' | 'country' | 'genre';

export interface TraceArtist {
  key: string;
  name: string;
  listeners: number | null;
  /** ISO 3166-1 alpha-2, when a country filter asked for it. */
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
  /** A seed artist put first (includeSeedArtists). */
  seed: boolean;
}

export interface TraceTrack {
  uri: string;
  title: string;
  artist: string;
  /** The seed song this one fits, "Artist – Title"; null for one of the artist's top tracks. */
  similarTo: string | null;
}

/**
 * What one generation did, step by step, as it happens: streamed by POST /api/playlists/trace and played back
 * by the web app's Engine view (Visualization.md). Lists are cut short (samples, top 40) to keep a run small.
 */
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
      /** Why no track, when there is none. */
      detail: string | null;
      /** 1: the bucket's share, 2: covering a shortfall, 3: a second track from an artist already picked. */
      pass: 1 | 2 | 3;
    }
  | { type: 'chain'; order: string[]; score: number }
  | { type: 'reverse'; from: number; to: number }
  | { type: 'ordered'; score: number }
  | { type: 'saved'; name: string; url: string }
  /** A dry run stopped here instead of saving. */
  | { type: 'unsaved'; name: string }
  | { type: 'done'; playlist: GeneratedPlaylist }
  /** `status` 401: the Spotify session is gone, log in again. */
  | { type: 'error'; message: string; status: number };
