import { DestroyRef, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { TraceEvent, TraceStage } from '../core/models';
import { Scene, applyEvent, emptyScene, sceneAt } from './engine-scene';

/** How long each kind of event stays on screen at 1×, before the next one, in ms. */
const SHOW_MS: Record<TraceEvent['type'], number> = {
  start: 700,
  stage: 1000,
  seed: 1100,
  wikidata: 900,
  source: 520,
  reached: 900,
  check: 950,
  pool: 1000,
  rank: 1800,
  lineup: 1700,
  lookup: 700,
  chain: 1500,
  reverse: 420,
  ordered: 1100,
  saved: 1400,
  unsaved: 1400,
  done: 0,
  error: 0,
};
/** A run of the same kind speeds up to this: the first checks are slow enough to read, the 200th is quick. */
const FLOOR_MS: Partial<Record<TraceEvent['type'], number>> = { source: 130, check: 120, lookup: 160, reverse: 110 };
const RUN_SPEED_UP = 0.86;
/** A live run more than this many events ahead of the player is caught up with at a faster pace. */
const CATCH_UP_LAG = 40;
const CATCH_UP_PACE = 0.4;

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** How long event `index` stays on screen at 1×. */
export function showTime(events: readonly TraceEvent[], index: number): number {
  const { type } = events[index];
  let run = 0;
  while (index - run - 1 >= 0 && events[index - run - 1].type === type) {
    run++;
  }
  const floor = FLOOR_MS[type] ?? SHOW_MS[type];
  return Math.max(Math.min(floor, SHOW_MS[type]), SHOW_MS[type] * RUN_SPEED_UP ** run);
}

/**
 * Plays a run's events into a Scene at a readable pace, also while they are still streaming in. Create it in an
 * injection context. `beforeStep` runs just before each animated step changes the scene (the view measures its
 * cards there, to fly them after the render); seeking skips it, so jumps don't animate.
 */
export class TracePlayer {
  readonly scene = signal<Scene>(emptyScene());
  readonly isPlaying = signal(true);
  readonly speed = signal<Speed>(1);
  /** Caught up with a run that is still going: the engine is waiting on Last.fm or Spotify. */
  readonly isWaiting = computed(
    () => this.isPlaying() && this.isLive() && this.scene().step >= this.events().length,
  );
  readonly isAtEnd = computed(() => !this.isLive() && this.scene().step >= this.events().length);
  /** The first step of each stage that has arrived, to jump to. */
  readonly stageSteps = computed(() => {
    const steps = new Map<TraceStage, number>();
    this.events().forEach((event, index) => {
      if (event.type === 'stage' && !steps.has(event.stage)) {
        steps.set(event.stage, index);
      }
    });
    return steps;
  });

  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly events: Signal<readonly TraceEvent[]>,
    private readonly isLive: Signal<boolean>,
    private readonly beforeStep: () => void,
  ) {
    // Starts the clock whenever there is something to play: new events, play pressed, a seek.
    effect(() => {
      const count = this.events().length;
      const isPlaying = this.isPlaying();
      const step = this.scene().step;
      untracked(() => {
        if (count < step) {
          // A new run replaced the events.
          this.seek(0);
        } else if (isPlaying && this.#timer === null && step < count) {
          this.#schedule(0);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => this.#stop());
  }

  toggle(): void {
    if (this.isAtEnd()) {
      this.replay();
      return;
    }
    this.isPlaying.update((isPlaying) => !isPlaying);
    if (!this.isPlaying()) {
      this.#stop();
    }
  }

  replay(): void {
    this.seek(0);
    this.isPlaying.set(true);
  }

  /** Straight to the end of what has arrived; a live run goes on playing from there. */
  skipToEnd(): void {
    this.seek(this.events().length);
  }

  jumpTo(stage: TraceStage): void {
    const step = this.stageSteps().get(stage);
    if (step !== undefined) {
      this.seek(step + 1);
    }
  }

  seek(step: number): void {
    this.#stop();
    this.scene.set(sceneAt(this.events(), Math.min(step, this.events().length)));
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => this.#tick(), delay);
  }

  #tick(): void {
    this.#timer = null;
    const events = this.events();
    const step = this.scene().step;
    if (!this.isPlaying() || step >= events.length) {
      return;
    }
    this.beforeStep();
    this.scene.update((scene) => applyEvent(scene, events[step]));
    const lag = events.length - step - 1;
    const pace = this.isLive() && lag > CATCH_UP_LAG ? CATCH_UP_PACE : 1;
    // While a live run streams, the last event also gets its time on screen before the next one shows.
    if (step + 1 < events.length || this.isLive()) {
      this.#schedule((showTime(events, step) * pace) / this.speed());
    }
  }

  #stop(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }
}
