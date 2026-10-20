import { computed, inject } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withComputed, withMethods, withProps, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { exhaustMap, pipe, switchMap, takeWhile, timer } from 'rxjs';
import { ApiService } from '../core/api.service';
import { EvaluationPlaylist, EvaluationRun, StartEvaluation } from '../core/models';
import { withErrors, withLoading } from '../core/store-features';

const POLL_MS = 3000;

interface EvaluationState {
  playlists: EvaluationPlaylist[];
  /** Newest first. */
  runs: EvaluationRun[];
}

/** Runs of the API's evaluation harness: scores the ranking formula on your own playlists. */
export const EvaluationStore = signalStore(
  { providedIn: 'root' },
  withState<EvaluationState>({ playlists: [], runs: [] }),
  withLoading(),
  withErrors(),
  withProps(() => ({ _api: inject(ApiService) })),
  withComputed(({ runs }) => ({
    isRunning: computed(() => runs().some((run) => run.status === 'running')),
  })),
  withMethods((store) => {
    const replaceRun = (run: EvaluationRun): void =>
      patchState(store, { runs: store.runs().map((existing) => (existing.id === run.id ? run : existing)) });

    /** Re-reads a running evaluation every few seconds until it finishes. */
    const watch = rxMethod<string>(
      switchMap((id) =>
        timer(POLL_MS, POLL_MS).pipe(
          switchMap(() => store._api.evaluation(id)),
          takeWhile((run) => run.status === 'running', true),
          tapResponse({ next: replaceRun, error: (error) => store._setError(error) }),
        ),
      ),
    );

    return {
      load: rxMethod<void>(
        pipe(
          store._startLoadingTap(),
          switchMap(() =>
            store._api.evaluationPlaylists().pipe(
              switchMap((playlists) => {
                patchState(store, { playlists });
                return store._api.evaluations();
              }),
              tapResponse({
                next: (runs) => {
                  store.clearError();
                  patchState(store, { runs });
                  runs.filter((run) => run.status === 'running').forEach((run) => watch(run.id));
                },
                error: (error) => store._setError(error),
                finalize: () => store._stopLoading(),
              }),
            ),
          ),
        ),
      ),

      start: rxMethod<StartEvaluation>(
        exhaustMap((settings) =>
          store._api.startEvaluation(settings).pipe(
            tapResponse({
              next: (run) => {
                store.clearError();
                patchState(store, { runs: [run, ...store.runs()] });
                watch(run.id);
              },
              error: (error) => store._setError(error),
            }),
          ),
        ),
      ),
    };
  }),
);
