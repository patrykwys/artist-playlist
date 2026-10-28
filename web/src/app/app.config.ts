import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideLucideConfig } from '@lucide/angular';
import { routes } from './app.routes';
import { sessionExpiredInterceptor } from './core/session-expired.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([sessionExpiredInterceptor])),
    // Icons take the size of the text they sit in, like the glyphs they replaced.
    provideLucideConfig({ size: '1em' }),
  ],
};
