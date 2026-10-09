import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { tap } from 'rxjs';
import { AuthStore } from './auth.store';

/**
 * A 401 from any call after login (API restarted, session gone) sends the user back to the login button.
 * AuthStore is resolved only on a 401: injecting it up front would be circular, because the store
 * calls /api/auth/me while it is still being created.
 */
export const sessionExpiredInterceptor: HttpInterceptorFn = (request, next) => {
  const injector = inject(Injector);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.endsWith('/auth/me')) {
          injector.get(AuthStore).sessionExpired();
        }
      },
    }),
  );
};
