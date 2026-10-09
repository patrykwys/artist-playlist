import { HttpErrorResponse } from '@angular/common/http';
import { computed } from '@angular/core';
import { patchState, signalStoreFeature, withComputed, withMethods, withState } from '@ngrx/signals';
import { MonoTypeOperatorFunction, tap } from 'rxjs';
import { ApiError } from './models';

export function withLoading() {
  return signalStoreFeature(
    withState({ isLoading: false }),
    withMethods((store) => ({
      _startLoadingTap<T>(): MonoTypeOperatorFunction<T> {
        return tap<T>(() => patchState(store, { isLoading: true }));
      },
      _stopLoading(): void {
        patchState(store, { isLoading: false });
      },
    })),
  );
}

export function withErrors() {
  return signalStoreFeature(
    withState<{ error: string | null }>({ error: null }),
    withComputed(({ error }) => ({
      hasError: computed(() => error() !== null),
    })),
    withMethods((store) => ({
      _setError(error: unknown): void {
        patchState(store, { error: errorMessage(error) });
      },
      clearError(): void {
        patchState(store, { error: null });
      },
    })),
  );
}

/** The API sends `{ message }` bodies; fall back to the HTTP message. */
function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    // `error.error` is the parsed JSON body (still a string for text requests), or a ProgressEvent when the
    // request never got an answer.
    const body: Partial<ApiError> | null = typeof error.error === 'string' ? parseBody(error.error) : error.error;
    if (body?.message) {
      return Array.isArray(body.message) ? body.message.join('. ') : body.message;
    }
    return error.status === 0 ? 'The API is not reachable. Is it running on port 3000?' : error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}

function parseBody(text: string): Partial<ApiError> | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
