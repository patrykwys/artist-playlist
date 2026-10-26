import {
  CheckVerdict,
  GeneratedPlaylist,
  ListenerFilter,
  MixMode,
  PlaylistSeed,
  TraceEvent,
  TraceRanked,
  TraceSourceKind,
  TraceStage,
} from '../core/models';

/**
 * What the Engine view shows after some of a run's events: built by applying them in order with `applyEvent`,
 * so seeking is replaying from the start. Pure; each step copies only what it changes.
 */
export interface Scene {
  /** Events applied so far. */
  step: number;
  stage: TraceStage | null;
  ending: 'done' | 'error' | null;
  config: SceneConfig | null;
  seeds: SceneSeed[];
  sources: SceneSource[];
  /** Related-artist links read so far (an artist found twice counts twice). */
  links: number;
  /** Unique artists the walks reached; known once every walk is done. */
  reached: number | null;
  /** The artist standing in the gate. */
  gate: GateCheck | null;
  passed: SceneArtist[];
  rejected: RejectedArtist[];
  pool: number | null;
  buckets: SceneBucket[];
  /** Whether the buckets are in picking order yet (variety, country turns and seed artists applied). */
  lineup: boolean;
  /** The buckets as scored, with what the mixing desk needs to re-rank them. */
  ranking: RankBucket[];
  tracks: SceneTrack[];
  flow: SceneFlow;
  /** `url` is null after a dry run, which stops before saving. */
  saved: { name: string; url: string | null } | null;
  playlist: GeneratedPlaylist | null;
  error: string | null;
  /** Every narration line so far, oldest first. */
  log: LogLine[];
}

export type RankBucket = Extract<TraceEvent, { type: 'rank' }>['buckets'][number];

export interface SceneConfig {
  mode: MixMode;
  length: number;
  listeners: ListenerFilter | null;
  countries: string[];
  blockedArtists: string[];
  blockedGenres: string[];
  lambda: number;
  weights: { walk: number; tags: number; popularity: number };
}

export interface SceneSeed {
  label: string;
  kind: PlaylistSeed['type'];
  hue: number;
  /** Null until profiled. */
  tags: { name: string; weight: number }[] | null;
  listeners: number | null;
  wikidata: string[];
}

export interface SceneSource {
  id: number;
  seed: string;
  hue: number;
  via: TraceSourceKind;
  through: string;
  total: number;
  sample: string[];
}

export interface SceneArtist {
  key: string;
  name: string;
  listeners: number | null;
  country: string | null;
}

export type GateId = Exclude<CheckVerdict, 'pass'>;
export type Light = 'off' | 'pass' | 'fail' | 'skip';

export const GATES: { id: GateId; label: string }[] = [
  { id: 'seed', label: 'Seed' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'listeners', label: 'Listeners' },
  { id: 'country', label: 'Country' },
  { id: 'genre', label: 'Genre' },
];

export interface GateCheck {
  artist: SceneArtist;
  verdict: CheckVerdict;
  lights: Record<GateId, Light>;
  /** Why it failed, in words; null when it passed. */
  reason: string | null;
}

export interface RejectedArtist extends SceneArtist {
  verdict: GateId;
  reason: string;
}

export interface SceneBucket {
  label: string;
  hue: number;
  /** Tracks this bucket should fill. */
  share: number;
  artists: BucketArtist[];
  /** Index of the artist looked up last; -1 before track picking. */
  cursor: number;
  filled: number;
}

export interface BucketArtist {
  key: string;
  name: string;
  /** Null for a seed artist. */
  score: TraceRanked | null;
  seed: boolean;
  status: 'waiting' | 'found' | 'missing';
  /** The track found, or why none was. */
  note: string | null;
  /** Places moved by the lineup: positive = up. */
  shift: number;
}

export interface SceneTrack {
  uri: string;
  title: string;
  artist: string;
  artistKey: string;
  bucket: number;
  hue: number;
  similarTo: string | null;
}

export interface SceneFlow {
  /** Sum of neighbour similarities of the greedy chain, then of the order so far. */
  greedy: number | null;
  score: number | null;
  reversals: number;
  /** The stretch the last 2-opt step reversed (inclusive), while it is the latest step. */
  flipped: [number, number] | null;
  isFinal: boolean;
}

export interface LogLine {
  /** The step that wrote it: seeking to `id + 1` shows the floor as it was then. */
  id: number;
  text: string;
  tone: 'info' | 'good' | 'bad' | 'stage';
  /** Keys of the artists it is about, for following one artist. */
  about: string[];
}

export const STAGE_TITLES: Record<TraceStage, string> = {
  seeds: 'Profiling the seeds',
  discover: 'Walking the similar-artist graph',
  filter: 'Checking each candidate at the gate',
  score: 'Scoring candidates against the seeds',
  tracks: 'Looking up tracks on Spotify',
  order: 'Putting the tracks in order',
  save: 'Saving to Spotify',
};
