import { formatCompact } from '../core/format';
import { artistKey } from './artists';
import { describeSource } from './narration';
import { LogLine, Scene } from './scene.model';

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
