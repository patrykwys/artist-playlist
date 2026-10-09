import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './app-config.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UpstreamErrorFilter } from './common/upstream-error.filter.js';

@Module({
  imports: [AppConfigModule, AuthModule],
  providers: [
    // Registered here rather than in main.ts so they also apply in tests that build the app module.
    {
      provide: APP_PIPE,
      // whitelist strips fields a DTO doesn't declare (the web app also sends `country`, which the API ignores).
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
    { provide: APP_FILTER, useClass: UpstreamErrorFilter },
  ],
})
export class AppModule {}
