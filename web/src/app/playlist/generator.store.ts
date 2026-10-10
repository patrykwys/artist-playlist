import { inject } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withMethods, withProps, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { exhaustMap, pipe, tap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { GenerateRequest, GeneratedPlaylist } from '../core/models';
import { withErrors, withLoading } from '../core/store-features';
import { SeedsStore } from '../seeds/seeds.store';

interface GeneratorState {
  /** The playlist generated in this visit; the full list lives on /playlists. */
  latest: GeneratedPlaylist | null;
}

export const GeneratorStore = signalStore(
  { providedIn: 'root' },
  withState<GeneratorState>({ latest: null }),
  withLoading(),
  withErrors(),
  withProps(() => ({ _api: inject(ApiService), _seeds: inject(SeedsStore) })),
  withMethods((store) => ({
    /** Clears the seeds once the playlist is saved; after a failure they stay, to try again. */
    generate: rxMethod<GenerateRequest>(
      pipe(
        tap(() => {
          store.clearError();
          patchState(store, { latest: null });
        }),
        store._startLoadingTap(),
        exhaustMap((request) =>
          store._api.generate(request).pipe(
            tapResponse({
              next: (latest) => {
                patchState(store, { latest });
                store._seeds.clear();
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
