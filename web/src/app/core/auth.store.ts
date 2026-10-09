import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tapResponse } from '@ngrx/operators';
import { patchState, signalStore, withHooks, withMethods, withProps, withState } from '@ngrx/signals';
import { rxMethod } from '@ngrx/signals/rxjs-interop';
import { exhaustMap, pipe, switchMap, tap } from 'rxjs';
import { ApiService } from './api.service';
import { SpotifyUser } from './models';

/** 'unavailable' = the API didn't answer (not running, restarting); you are not logged out. */
export type AuthStatus = 'checking' | 'signed-in' | 'signed-out' | 'unavailable';

interface AuthState {
  user: SpotifyUser | null;
  status: AuthStatus;
}

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>({ user: null, status: 'checking' }),
  withProps(() => ({ _api: inject(ApiService) })),
  withMethods((store) => ({
    loadUser: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { status: 'checking' })),
        switchMap(() =>
          store._api.me().pipe(
            tapResponse({
              next: (user) => patchState(store, { user, status: 'signed-in' }),
              error: (error) =>
                patchState(
                  store,
                  isUnauthorized(error) ? { user: null, status: 'signed-out' } : { status: 'unavailable' },
                ),
            }),
          ),
        ),
      ),
    ),
    logout: rxMethod<void>(
      pipe(
        exhaustMap(() =>
          store._api.logout().pipe(
            tapResponse({
              next: () => patchState(store, { user: null, status: 'signed-out' }),
              error: () => patchState(store, { user: null, status: 'signed-out' }),
            }),
          ),
        ),
      ),
    ),
    sessionExpired(): void {
      patchState(store, { user: null, status: 'signed-out' });
    },
  })),
  withHooks({
    onInit(store) {
      store.loadUser();
    },
  }),
);

function isUnauthorized(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 401;
}
