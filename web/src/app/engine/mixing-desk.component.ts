import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { FormField, form, max, min } from '@angular/forms/signals';
import { LucideArrowDown, LucideArrowUp, LucideMinus, LucideX } from '@lucide/angular';
import { Scene, SceneConfig } from './scene.model';
import { DeskWeights, RemixedArtist, overlap, remix, varietyForLambda } from './remix';

/** Rows shown per bucket, at least; more when a bucket's share of the playlist is bigger. */
const ROWS = 10;
const MAX_ROWS = 20;

const FADERS: { key: keyof DeskWeights; label: string; hint: string; ceiling: number }[] = [
  { key: 'walk', label: 'Similar-artist links', hint: 'Last.fm’s similar artists, two hops out', ceiling: 1 },
  { key: 'tags', label: 'Tag match', hint: 'Shared tags, rare ones counting more', ceiling: 1 },
  { key: 'popularity', label: 'Size penalty', hint: 'Per power of ten bigger or smaller than the seed', ceiling: 0.5 },
  { key: 'variety', label: 'Variety', hint: 'Pushes near-duplicates down (MMR)', ceiling: 1 },
];

/**
 * Faders for the ranking formula's weights that re-rank the run's buckets in the browser (remix.ts), next to the
 * order the run actually used: what a weight change would do, before measuring it in the Algorithm lab.
 */
@Component({
  selector: 'app-mixing-desk',
  imports: [FormField, LucideArrowDown, LucideArrowUp, LucideMinus, LucideX],
  templateUrl: './mixing-desk.component.html',
  styleUrl: './mixing-desk.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MixingDeskComponent {
  readonly scene = input.required<Scene>();
  readonly close = output<void>();

  protected readonly faders = FADERS;
  /** The config object only changes when a new run starts, so stepping through a run keeps the faders. */
  readonly #config = computed(() => this.scene().config);
  protected readonly weights = linkedSignal<SceneConfig | null, DeskWeights>({
    source: this.#config,
    computation: (config) => runWeights(config),
  });
  protected readonly desk = form(this.weights, (path) => {
    for (const { key, ceiling } of FADERS) {
      min(path[key], 0);
      max(path[key], ceiling);
    }
  });
  protected readonly isAsRun = computed(() => {
    const run = runWeights(this.#config());
    return FADERS.every(({ key }) => Math.abs(this.weights()[key] - run[key]) < 1e-9);
  });

  protected readonly buckets = computed(() => {
    const { ranking, buckets } = this.scene();
    const weights = this.weights();
    return ranking.map((bucket, index) => {
      const run = buckets[index];
      const runOrder = (run?.artists ?? []).filter((artist) => !artist.seed).map((artist) => artist.key);
      const remixed = remix(bucket, weights, runOrder);
      const share = Math.min(run?.share ?? ROWS, remixed.length);
      return {
        label: bucket.label,
        hue: run?.hue ?? 275,
        share,
        same: overlap(remixed, runOrder, share),
        rows: remixed.slice(0, Math.min(Math.max(ROWS, share), MAX_ROWS)),
      };
    });
  });

  protected reset(): void {
    this.weights.set(runWeights(this.#config()));
  }

  /** Places moved against the run's order: up, down, new to the top, or unchanged. */
  protected move(artist: RemixedArtist, place: number): { kind: 'up' | 'down' | 'new' | 'same'; places: number } {
    if (artist.runPlace === null) {
      return { kind: 'new', places: 0 };
    }
    const places = artist.runPlace - place;
    if (places === 0) {
      return { kind: 'same', places: 0 };
    }
    return places > 0 ? { kind: 'up', places } : { kind: 'down', places: -places };
  }
}

function runWeights(config: SceneConfig | null): DeskWeights {
  const weights = config?.weights ?? { walk: 0.5, tags: 0.4, popularity: 0.2 };
  return { ...weights, variety: varietyForLambda(config?.lambda ?? 1) };
}
