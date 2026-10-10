import { computed, inject } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withComputed, withMethods, withProps, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { Observable, pipe, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { GeneratedPlaylist } from '../core/models';
import { withErrors, withLoading } from '../core/store-features';

interface PlaylistsState {
  /** Newest first, as the API returns them. */
  playlists: GeneratedPlaylist[];
  loaded: boolean;
}

type Source = 'database' | 'spotify';

/** Your playlists made by this app: served from the API's database, re-read from Spotify on Refresh. */
export const PlaylistsStore = signalStore(
  { providedIn: 'root' },
  withState<PlaylistsState>({ playlists: [], loaded: false }),
  withLoading(),
  withErrors(),
  withProps(() => ({ _api: inject(ApiService) })),
  withComputed(({ playlists }) => ({
    totalSongs: computed(() => playlists().reduce((total, playlist) => total + playlist.tracks.length, 0)),
    totalDurationMs: computed(() => playlists().reduce((total, playlist) => total + playlist.durationMs, 0)),
  })),
  withMethods((store) => {
    const request = (source: Source): Observable<GeneratedPlaylist[]> =>
      source === 'spotify' ? store._api.syncPlaylists() : store._api.myPlaylists();

    return {
      /** 'database' is instant; 'spotify' also picks up renames, deletions and edits made in Spotify. */
      load: rxMethod<Source>(
        pipe(
          store._startLoadingTap(),
          switchMap((source) =>
            request(source).pipe(
              tapResponse({
                next: (playlists) => {
                  store.clearError();
                  patchState(store, { playlists, loaded: true });
                },
                error: (error) => store._setError(error),
                finalize: () => store._stopLoading(),
              }),
            ),
          ),
        ),
      ),
    };
  }),
);
