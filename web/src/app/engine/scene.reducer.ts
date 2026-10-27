import { CheckVerdict, TraceEvent } from '../core/models';
import { narrate, rejectionReason } from './narration';
import {
  BucketArtist,
  GATES,
  GateCheck,
  GateId,
  Light,
  RejectedArtist,
  Scene,
  SceneArtist,
  SceneBucket,
  SceneConfig,
  SceneFlow,
  SceneSeed,
  SceneSource,
  SceneTrack,
} from './scene.model';

/** Seed and bucket colours (OKLCH hues), far enough apart to tell up to ten seeds apart. */
const SEED_HUES = [275, 165, 35, 330, 215, 95, 5, 245, 135, 60];
/** Bridge mode's one bucket ranks against every seed at once. */
const BRIDGE_HUE = 275;

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


/** Splits a total as evenly as possible, like the API's track shares: quotas(10, 3) → [4, 3, 3]. */
function quotas(total: number, parts: number): number[] {
  return Array.from({ length: parts }, (_, index) => Math.floor(total / parts) + (index < total % parts ? 1 : 0));
}

