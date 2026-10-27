import { computed, effect, untracked } from '@angular/core';
import { patchState, signalMethod, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { TraceEvent, TraceStage } from '../core/models';
import { Scene } from './scene.model';
import { applyEvent, emptyScene, sceneAt } from './scene.reducer';

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

/** A run's events, and whether more are still streaming in. */
export interface TraceRun {
  events: readonly TraceEvent[];
  isLive: boolean;
}

interface TracePlayerState extends TraceRun {
  scene: Scene;
  isPlaying: boolean;
  speed: Speed;
}

/**
 * Plays a run's events into a Scene at a readable pace, also while they are still streaming in. Provided per
 * Engine view, which feeds it with `play`. The `onStep` hook runs just before each animated step changes the
 * scene (the view measures its cards there, to fly them after the render); seeking skips it, so jumps don't
 * animate.
 */
export const TracePlayerStore = signalStore(
  withState<TracePlayerState>({ events: [], isLive: false, scene: emptyScene(), isPlaying: true, speed: 1 }),
  withComputed(({ events, isLive, isPlaying, scene }) => ({
    /** Caught up with a run that is still going: the engine is waiting on Last.fm or Spotify. */
    isWaiting: computed(() => isPlaying() && isLive() && scene().step >= events().length),
    isAtEnd: computed(() => !isLive() && scene().step >= events().length),
    /** The first step of each stage that has arrived, to jump to. */
    stageSteps: computed(() => {
      const steps = new Map<TraceStage, number>();
      events().forEach((event, index) => {
        if (event.type === 'stage' && !steps.has(event.stage)) {
          steps.set(event.stage, index);
        }
      });
      return steps;
    }),
  })),
  withMethods((store) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let beforeStep = (): void => {};

    const stop = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const seek = (step: number): void => {
      stop();
      patchState(store, { scene: sceneAt(store.events(), Math.min(step, store.events().length)) });
    };
    const tick = (): void => {
      timer = null;
      const events = store.events();
      const step = store.scene().step;
      if (!store.isPlaying() || step >= events.length) {
        return;
      }
      beforeStep();
      patchState(store, ({ scene }) => ({ scene: applyEvent(scene, events[step]) }));
      const lag = events.length - step - 1;
      const pace = store.isLive() && lag > CATCH_UP_LAG ? CATCH_UP_PACE : 1;
      // While a live run streams, the last event also gets its time on screen before the next one shows.
      if (step + 1 < events.length || store.isLive()) {
        timer = setTimeout(tick, (showTime(events, step) * pace) / store.speed());
      }
    };
    const pause = (): void => {
      patchState(store, { isPlaying: false });
      stop();
    };
    const replay = (): void => {
      seek(0);
      patchState(store, { isPlaying: true });
    };

    return {
      /** Plays this run; given a signal, it follows the run as more events stream in. */
      play: signalMethod<TraceRun>((run) => patchState(store, run)),
      onStep(run: () => void): void {
        beforeStep = run;
      },
      setSpeed(speed: Speed): void {
        patchState(store, { speed });
      },
      pause,
      replay,
      toggle(): void {
        if (store.isAtEnd()) {
          replay();
        } else if (store.isPlaying()) {
          pause();
        } else {
          patchState(store, { isPlaying: true });
        }
      },
      /** Straight to the end of what has arrived; a live run goes on playing from there. */
      skipToEnd(): void {
        seek(store.events().length);
      },
      jumpTo(stage: TraceStage): void {
        const step = store.stageSteps().get(stage);
        if (step !== undefined) {
          seek(step + 1);
        }
      },
      seek,
      /** Starts the clock when there is something to play and it isn't running yet. */
      _wake(): void {
        if (store.isPlaying() && timer === null && store.scene().step < store.events().length) {
          timer = setTimeout(tick, 0);
        }
      },
      _stop: stop,
    };
  }),
  withHooks({
    onInit(store) {
      // Starts the clock whenever there is something to play: new events, play pressed, a seek.
      effect(() => {
        const count = store.events().length;
        const step = store.scene().step;
        store.isPlaying();
        untracked(() => {
          if (count < step) {
            // A new run replaced the events.
            store.seek(0);
          } else {
            store._wake();
          }
        });
      });
    },
    onDestroy(store) {
      store._stop();
    },
  }),
);
