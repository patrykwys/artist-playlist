import { formatCompact } from '../core/format';
import { ListenerFilter, TraceEvent, TraceSourceKind } from '../core/models';
import { artistKey } from './artists';
import { GateId, LogLine, STAGE_TITLES, Scene, SceneArtist, SceneConfig } from './scene.model';

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
export function narrate(scene: Scene, event: TraceEvent): (Pick<LogLine, 'text' | 'tone'> & { about?: string[] }) | null {
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
