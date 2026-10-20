import { inject } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withMethods, withProps, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { exhaustMap, pipe, tap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthStore } from '../core/auth.store';
import { GenerateRequest, GeneratedPlaylist, TraceEvent } from '../core/models';
import { withErrors, withLoading } from '../core/store-features';
import { SeedsStore } from '../seeds/seeds.store';

interface GeneratorState {
  /** The playlist generated in this visit; the full list lives on /playlists. */
  latest: GeneratedPlaylist | null;
  /** What the engine did for the latest playlist, as it streamed in: what the Engine view plays. */
  trace: TraceEvent[];
  /** The latest run was a dry run: watched, not saved. */
  isDryRun: boolean;
}

export const GeneratorStore = signalStore(
  { providedIn: 'root' },
  withState<GeneratorState>({ latest: null, trace: [], isDryRun: false }),
  withLoading(),
  withErrors(),
  withProps(() => ({ _api: inject(ApiService), _seeds: inject(SeedsStore), _auth: inject(AuthStore) })),
  withMethods((store) => ({
    /** Clears the seeds when a playlist is saved; after a dry run or a failure they stay, to try again. */
    generate: rxMethod<GenerateRequest>(
      pipe(
        tap((request) => {
          store.clearError();
          patchState(store, { latest: null, trace: [], isDryRun: request.dryRun });
        }),
        store._startLoadingTap(),
        exhaustMap((request) =>
          store._api.generateTraced(request).pipe(
            tapResponse({
              next: (events) => {
                patchState(store, ({ trace }) => ({ trace: [...trace, ...events] }));
                for (const event of events) {
                  if (event.type === 'done' && !store.isDryRun()) {
                    patchState(store, { latest: event.playlist });
                    store._seeds.clear();
                  } else if (event.type === 'error') {
                    store._setError(new Error(event.message));
                    if (event.status === 401) {
                      store._auth.sessionExpired();
                    }
                  }
                }
              },
              error: (error) => store._setError(error),
              finalize: () => store._stopLoading(),
            }),
          ),
        ),
      ),
    ),
  })),
);
