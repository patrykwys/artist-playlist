import { formatCompact } from '../core/format';
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

/** Seed and bucket colours (OKLCH hues), far enough apart to tell up to ten seeds apart. */
const SEED_HUES = [275, 165, 35, 330, 215, 95, 5, 245, 135, 60];
/** Bridge mode's one bucket ranks against every seed at once. */
const BRIDGE_HUE = 275;

export const STAGE_TITLES: Record<TraceStage, string> = {
  seeds: 'Profiling the seeds',
  discover: 'Walking the similar-artist graph',
  filter: 'Checking each candidate at the gate',
  score: 'Scoring candidates against the seeds',
  tracks: 'Looking up tracks on Spotify',
  order: 'Putting the tracks in order',
  save: 'Saving to Spotify',
};

export function emptyScene(): Scene {
  return {
    step: 0,
    stage: null,
    ending: null,
    config: null,
    seeds: [],
    sources: [],
    links: 0,
    reached: null,
    gate: null,
    passed: [],
    rejected: [],
    pool: null,
    buckets: [],
    lineup: false,
    ranking: [],
    tracks: [],
    flow: { greedy: null, score: null, reversals: 0, flipped: null, isFinal: false },
    saved: null,
    playlist: null,
    error: null,
    log: [],
  };
}

/** The scene after one more event. */
export function applyEvent(scene: Scene, event: TraceEvent): Scene {
  const next = { ...change(scene, event), step: scene.step + 1 };
  const line = narrate(scene, event);
  return line ? { ...next, log: [...next.log, { id: scene.step, about: [], ...line }] } : next;
}

/** Replays events from the start: what seeking does. */
export function sceneAt(events: readonly TraceEvent[], step: number): Scene {
  return events.slice(0, step).reduce(applyEvent, emptyScene());
}

function change(scene: Scene, event: TraceEvent): Scene {
  switch (event.type) {
    case 'start':
      return {
        ...scene,
        config: {
          mode: event.mode,
          length: event.length,
          listeners: event.listeners,
          countries: event.countries,
          blockedArtists: event.blockedArtists,
          blockedGenres: event.blockedGenres,
          lambda: event.lambda,
          weights: event.weights,
        },
        seeds: event.seeds.map((seed, index) => ({
          label: seed.name,
          kind: seed.type,
          hue: SEED_HUES[index % SEED_HUES.length],
          tags: null,
          listeners: null,
          wikidata: [],
        })),
      };
    case 'stage':
      // The last artist in the gate leaves it when the filters are done.
      return { ...(event.stage === 'filter' ? scene : leaveGate(scene)), stage: event.stage };
    case 'seed':
      return updateSeed(scene, event.seed, { tags: event.tags, listeners: event.listeners });
    case 'wikidata':
      return updateSeed(scene, event.seed, { wikidata: event.genres });
    case 'source': {
      const source: SceneSource = {
        id: scene.sources.length,
        seed: event.seed,
        hue: hueOfSeed(scene, event.seed),
        via: event.via,
        through: event.through,
        total: event.total,
        sample: event.sample,
      };
      return { ...scene, sources: [...scene.sources, source], links: scene.links + event.total };
    }
    case 'reached':
      return { ...scene, reached: event.artists };
    case 'check': {
      const artist: SceneArtist = { ...event.artist };
      const { verdict } = event;
      const reason = verdict === 'pass' ? null : rejectionReason(scene.config, verdict, artist, event.detail);
      const gate: GateCheck = { artist, verdict, lights: lightsFor(scene.config, verdict), reason };
      return { ...leaveGate(scene), gate };
    }
    case 'pool':
      return { ...leaveGate(scene), pool: event.artists };
    case 'rank': {
      const shares = quotas(scene.config?.length ?? 0, event.buckets.length);
      const buckets = event.buckets.map(
        (bucket, index): SceneBucket => ({
          label: bucket.label,
          hue: scene.config?.mode === 'bridge' ? BRIDGE_HUE : hueOfSeed(scene, bucket.label),
          share: shares[index] ?? 0,
          artists: bucket.artists.map((score) => ({
            key: score.key,
            name: score.name,
            score,
            seed: false,
            status: 'waiting',
            note: null,
            shift: 0,
          })),
          cursor: -1,
          filled: 0,
        }),
      );
      return { ...scene, buckets, ranking: event.buckets };
    }
    case 'lineup': {
      const buckets = scene.buckets.map((bucket, index): SceneBucket => {
        // Shifts count among ranked artists only: seed artists going first is not variety at work.
        const order = event.buckets[index]?.artists ?? [];
        const rankedOrder = order.filter((artist) => !artist.seed);
        const artists = order.map((artist): BucketArtist => {
          const before = bucket.artists.findIndex((ranked) => ranked.key === artist.key);
          const ranked = bucket.artists[before];
          return ranked && !artist.seed
            ? { ...ranked, shift: before - rankedOrder.indexOf(artist) }
            : { ...artist, score: ranked?.score ?? null, status: 'waiting', note: null, shift: 0 };
        });
        return { ...bucket, artists };
      });
      return { ...scene, buckets, lineup: true };
    }
    case 'lookup':
      return lookUp(scene, event);
    case 'chain': {
      const byUri = new Map(scene.tracks.map((track) => [track.uri, track]));
      const ordered = event.order.flatMap((uri) => byUri.get(uri) ?? []);
      const rest = scene.tracks.filter((track) => !event.order.includes(track.uri));
      const flow: SceneFlow = { ...scene.flow, greedy: event.score, score: event.score };
      return { ...scene, tracks: [...ordered, ...rest], flow };
    }
    case 'reverse': {
      const { from, to } = event;
      const tracks = [
        ...scene.tracks.slice(0, from),
        ...scene.tracks.slice(from, to + 1).reverse(),
        ...scene.tracks.slice(to + 1),
      ];
      return { ...scene, tracks, flow: { ...scene.flow, reversals: scene.flow.reversals + 1, flipped: [from, to] } };
    }
    case 'ordered':
      return { ...scene, flow: { ...scene.flow, score: event.score, flipped: null, isFinal: true } };
    case 'saved':
      return { ...scene, saved: { name: event.name, url: event.url } };
    case 'unsaved':
      return { ...scene, saved: { name: event.name, url: null } };
    case 'done':
      return { ...scene, playlist: event.playlist, ending: 'done' };
    case 'error':
      return { ...leaveGate(scene), error: event.message, ending: 'error' };
  }
}

/** The artist in the gate goes on to the shortlist or the rejected pile. */
function leaveGate(scene: Scene): Scene {
  const { gate } = scene;
  if (!gate) {
    return scene;
  }
  if (gate.verdict === 'pass') {
    return { ...scene, gate: null, passed: [...scene.passed, gate.artist] };
  }
  const rejected: RejectedArtist = { ...gate.artist, verdict: gate.verdict, reason: gate.reason ?? '' };
  return { ...scene, gate: null, rejected: [...scene.rejected, rejected] };
}

function lookUp(scene: Scene, event: Extract<TraceEvent, { type: 'lookup' }>): Scene {
  const bucket = scene.buckets[event.bucket];
  if (!bucket) {
    return scene;
  }
  let index = bucket.artists.findIndex((artist) => artist.key === event.artist.key);
  const artists = [...bucket.artists];
  if (index < 0) {
    // Deeper than the trace's top 40: show it at the end.
    index = artists.length;
    artists.push({ ...event.artist, score: null, seed: false, status: 'waiting', note: null, shift: 0 });
  }
  const artist = artists[index];
  const { track } = event;
  // A second track (pass 3) adds to the first; a miss then doesn't undo the hit.
  artists[index] = track
    ? {
        ...artist,
        status: 'found',
        note: artist.status === 'found' && artist.note ? `${artist.note} + ${track.title}` : track.title,
      }
    : artist.status === 'found'
      ? artist
      : { ...artist, status: 'missing', note: event.detail };
  const filled = bucket.filled + (track ? 1 : 0);
  const buckets = scene.buckets.map((current, position) =>
    position === event.bucket ? { ...bucket, artists, cursor: index, filled } : current,
  );
  if (!track) {
    return { ...scene, buckets };
  }
  const added: SceneTrack = {
    uri: track.uri,
    title: track.title,
    artist: track.artist,
    artistKey: event.artist.key,
    bucket: event.bucket,
    hue: bucket.hue,
    similarTo: track.similarTo,
  };
  return { ...scene, buckets, tracks: [...scene.tracks, added] };
}

function updateSeed(scene: Scene, label: string, update: Partial<SceneSeed>): Scene {
  return { ...scene, seeds: scene.seeds.map((seed) => (seed.label === label ? { ...seed, ...update } : seed)) };
}

function hueOfSeed(scene: Scene, label: string): number {
  return scene.seeds.find((seed) => seed.label === label)?.hue ?? BRIDGE_HUE;
}

/** Filters left unset are off; the ones before the failing one passed, the ones after it were never reached. */
export function lightsFor(config: SceneConfig | null, verdict: CheckVerdict): Record<GateId, Light> {
  const isOn: Record<GateId, boolean> = {
    seed: true,
    blocked: (config?.blockedArtists.length ?? 0) > 0,
    listeners: config?.listeners !== null && config?.listeners !== undefined,
    country: (config?.countries.length ?? 0) > 0,
    genre: (config?.blockedGenres.length ?? 0) > 0,
  };
  let failed = false;
  const lights = {} as Record<GateId, Light>;
  for (const { id } of GATES) {
    if (id === verdict) {
      lights[id] = 'fail';
      failed = true;
    } else {
      lights[id] = !isOn[id] ? 'off' : failed ? 'skip' : 'pass';
    }
  }
  return lights;
}

export function rejectionReason(
  config: SceneConfig | null,
  verdict: GateId,
  artist: SceneArtist,
  detail: string | null,
): string {
  switch (verdict) {
    case 'seed':
      return 'already a seed';
    case 'blocked':
      return 'you left them out';
    case 'listeners':
      return `${formatCompact(artist.listeners ?? 0)} listeners, outside ${describeRange(config?.listeners ?? null)}`;
    case 'country':
      return artist.country
        ? `from ${artist.country}, not ${config?.countries.join(', ')}`
        : 'country unknown to MusicBrainz';
    case 'genre':
      return `tagged ${detail ?? 'a blocked genre'}`;
  }
}

function describeRange(range: ListenerFilter | null): string {
  if (!range) {
    return 'the range';
  }
  if (range.min === null) {
    return `under ${formatCompact(range.max ?? 0)}`;
  }
  return range.max === null
    ? `over ${formatCompact(range.min)}`
    : `${formatCompact(range.min)}–${formatCompact(range.max)}`;
}

/** One line of commentary per event worth reading; null for the ones that only move things. */
function narrate(scene: Scene, event: TraceEvent): (Pick<LogLine, 'text' | 'tone'> & { about?: string[] }) | null {
  switch (event.type) {
    case 'start': {
      const seeds = event.seeds.map((seed) => seed.name).join(' + ');
      return { text: `Mixing ${seeds}: ${event.mode}, ${event.length} tracks`, tone: 'stage' };
    }
    case 'stage':
      return { text: STAGE_TITLES[event.stage], tone: 'stage' };
    case 'seed': {
      const tags = event.tags.slice(0, 3).map((tag) => tag.name).join(', ');
      const listeners = event.listeners === null ? '' : ` · ${formatCompact(event.listeners)} listeners`;
      return { text: `${event.seed}: ${tags || 'no tags'}${listeners}`, tone: 'info', about: [artistKey(event.seed)] };
    }
    case 'wikidata':
      const genres = event.genres.join(', ') || 'nothing';
      return { text: `${event.seed} had few tags, Wikidata added ${genres}`, tone: 'info' };
    case 'source':
      return {
        text: describeSource(event.via, event.through, event.total),
        tone: 'info',
        about: [artistKey(event.through), ...event.sample.map(artistKey)],
      };
    case 'reached':
      return { text: `${event.artists} different artists reached`, tone: 'info' };
    case 'check': {
      const { artist } = event;
      if (event.verdict === 'pass') {
        const listeners = artist.listeners === null ? '' : `, ${formatCompact(artist.listeners)} listeners`;
        return { text: `${artist.name} passes${listeners}`, tone: 'good', about: [artist.key] };
      }
      const reason = rejectionReason(scene.config, event.verdict, artist, event.detail);
      return { text: `${artist.name}: ${reason}`, tone: 'bad', about: [artist.key] };
    }
    case 'pool':
      return { text: `${event.artists} candidates on the shortlist`, tone: 'info' };
    case 'rank':
      return {
        text: `Ranked by similar-artist links, shared tags and size: ${event.buckets.map((b) => b.label).join(', ')}`,
        tone: 'info',
      };
    case 'lineup':
      return {
        text: `Variety (λ ${scene.config?.lambda.toFixed(2) ?? '?'}) moved near-duplicates down`,
        tone: 'info',
      };
    case 'lookup': {
      const { track } = event;
      const about = [event.artist.key];
      if (!track) {
        return { text: `${event.artist.name}: ${event.detail ?? 'no track'}`, tone: 'bad', about };
      }
      const fits = track.similarTo ? `, fits ${track.similarTo}` : '';
      return { text: `${track.artist} – ${track.title}${fits}`, tone: 'good', about };
    }
    case 'chain':
      return {
        text: `Greedy chain: each next track the closest to the last (flow ${event.score.toFixed(2)})`,
        tone: 'info',
      };
    case 'reverse':
      return { text: `2-opt: tracks ${event.from + 1}–${event.to + 1} reversed for smoother joins`, tone: 'info' };
    case 'ordered':
      return {
        text: `Order settled: flow ${scene.flow.greedy?.toFixed(2) ?? '?'} → ${event.score.toFixed(2)}`,
        tone: 'good',
      };
    case 'saved':
      return { text: `Saved “${event.name}” to Spotify`, tone: 'good' };
    case 'unsaved':
      return { text: `Dry run: “${event.name}” was not saved to Spotify`, tone: 'stage' };
    case 'done':
      return null;
    case 'error':
      return { text: event.message, tone: 'bad' };
  }
}

export function describeSource(via: TraceSourceKind, through: string, total: number): string {
  switch (via) {
    case 'similar':
      return `${total} artists similar to ${through}`;
    case 'tag':
      return `${total} top artists tagged ${through}`;
    case 'genre':
      return `${total} top artists of ${through}`;
    case 'hop':
      return `${total} more through ${through} (second hop)`;
  }
}

/** Splits a total as evenly as possible, like the API's track shares: quotas(10, 3) → [4, 3, 3]. */
function quotas(total: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, index) => Math.floor(total / parts) + (index < total % parts ? 1 : 0));
}

/** A stable hue per artist name, for the initials disc. */
export function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** "Snow Strippers" → "SS", "Grimes" → "GR". */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Same as the API's artistKey (engine/scoring.ts): how one artist is recognised across sources. */
export function artistKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9$]+/g, ' ')
    .trim();
}

/** 'yes' for the followed artist's cards, 'no' for every other card while one is followed. */
export function pinState(pinned: string | null, ...keys: string[]): 'yes' | 'no' | null {
  return pinned === null ? null : keys.includes(pinned) ? 'yes' : 'no';
}

export interface Story {
  name: string;
  steps: { text: string; tone: LogLine['tone'] }[];
}

/** One artist's way through the floor so far, from what the scene knows: for following an artist. */
export function storyOf(scene: Scene, key: string): Story | null {
  const steps: Story['steps'] = [];
  const seed = scene.seeds.find((candidate) => candidate.kind === 'artist' && artistKey(candidate.label) === key);
  const name =
    seed?.label ??
    [scene.gate?.artist, ...scene.passed, ...scene.rejected].find((artist) => artist?.key === key)?.name ??
    scene.buckets.flatMap((bucket) => bucket.artists).find((artist) => artist.key === key)?.name ??
    scene.tracks.find((track) => track.artistKey === key)?.artist;
  if (!name) {
    return null;
  }

  if (seed) {
    steps.push({ text: 'A seed: everything else is measured against it', tone: 'stage' });
  }
  const sources = scene.sources.filter(
    (source) => artistKey(source.through) !== key && source.sample.some((sample) => artistKey(sample) === key),
  );
  if (sources.length > 0) {
    const through = sources.slice(0, 3).map((source) => describeSource(source.via, source.through, source.total));
    steps.push({ text: `Found among ${through.join('; ')}${sources.length > 3 ? '; …' : ''}`, tone: 'info' });
  }

  const passed = scene.passed.find((artist) => artist.key === key);
  const rejected = scene.rejected.find((artist) => artist.key === key);
  if (scene.gate?.artist.key === key) {
    const { reason } = scene.gate;
    steps.push({ text: `In the gate: ${reason ?? 'passes every filter'}`, tone: reason ? 'bad' : 'good' });
  } else if (passed) {
    const listeners = passed.listeners === null ? '' : ` (${formatCompact(passed.listeners)} listeners)`;
    steps.push({ text: `Passed every filter${listeners}`, tone: 'good' });
  } else if (rejected) {
    steps.push({ text: `Stopped at the gate: ${rejected.reason}`, tone: 'bad' });
  }

  scene.buckets.forEach((bucket) => {
    const index = bucket.artists.findIndex((artist) => artist.key === key);
    const artist = bucket.artists[index];
    if (!artist) {
      return;
    }
    const score = artist.score
      ? ` · relevance ${artist.score.relevance.toFixed(2)} (links ${artist.score.walk.toFixed(2)}, ` +
        `tags ${artist.score.tags.toFixed(2)}, size gap ${artist.score.popularityGap.toFixed(2)})`
      : '';
    steps.push({ text: `#${index + 1} in the ${bucket.label} bucket${score}`, tone: 'info' });
    if (scene.lineup && artist.shift !== 0) {
      const places = Math.abs(artist.shift);
      const direction = artist.shift > 0 ? 'up' : 'down';
      const unit = places === 1 ? 'place' : 'places';
      steps.push({ text: `Variety moved it ${direction} ${places} ${unit}`, tone: 'info' });
    }
    if (artist.status === 'found') {
      steps.push({ text: `On Spotify: ${artist.note}`, tone: 'good' });
    } else if (artist.status === 'missing') {
      steps.push({ text: `No track: ${artist.note}`, tone: 'bad' });
    }
  });

  const positions = scene.tracks.flatMap((track, index) => (track.artistKey === key ? [index + 1] : []));
  if (positions.length > 0 && scene.flow.greedy !== null) {
    const text = `Track ${positions.join(' and ')} of ${scene.tracks.length} in the running order`;
    steps.push({ text, tone: 'good' });
  }
  return { name, steps };
}
