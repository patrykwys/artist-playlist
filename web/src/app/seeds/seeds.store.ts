import { computed, inject } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withComputed, withMethods, withProps, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { EMPTY, debounceTime, map, pipe, switchMap, tap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { EMPTY_RESULTS, SearchResults, Seed, seedKey } from '../core/models';
import { withErrors, withLoading } from '../core/store-features';

const MIN_QUERY_LENGTH = 2;

interface SeedsState {
  query: string;
  results: SearchResults;
  seeds: Seed[];
}

export const SeedsStore = signalStore(
  { providedIn: 'root' },
  withState<SeedsState>({ query: '', results: EMPTY_RESULTS, seeds: [] }),
  withLoading(),
  withErrors(),
  withProps(() => ({ _api: inject(ApiService) })),
  withComputed(({ seeds }) => ({
    seedKeys: computed(() => new Set(seeds().map(seedKey))),
    hasSeeds: computed(() => seeds().length > 0),
  })),
  withMethods((store) => ({
    search: rxMethod<string>(
      pipe(
        tap((query) => patchState(store, { query })),
        map((query) => query.trim()),
        tap((query) => {
          if (query.length < MIN_QUERY_LENGTH) {
            patchState(store, { results: EMPTY_RESULTS });
          }
        }),
        debounceTime(300),
        tap((query) => patchState(store, { isLoading: query.length >= MIN_QUERY_LENGTH })),
        // A short query still goes through switchMap so it cancels any search in flight.
        switchMap((query) =>
          query.length < MIN_QUERY_LENGTH
            ? EMPTY
            : store._api.search(query).pipe(
                tapResponse({
                  next: (results) => {
                    store.clearError();
                    patchState(store, { results });
                    store._stopLoading();
                  },
                  error: (error) => {
                    store._setError(error);
                    store._stopLoading();
                  },
                }),
              ),
        ),
      ),
    ),
    add(seed: Seed): void {
      if (store.seedKeys().has(seedKey(seed))) {
        return;
      }
      patchState(store, { seeds: [...store.seeds(), seed], query: '', results: EMPTY_RESULTS });
    },
    remove(seed: Seed): void {
      const key = seedKey(seed);
      patchState(store, { seeds: store.seeds().filter((item) => seedKey(item) !== key) });
    },
    /** Called once a playlist is generated, so the next one starts from scratch. */
    clear(): void {
      patchState(store, { seeds: [] });
    },
  })),
);
