import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './app-config.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UpstreamErrorFilter } from './common/upstream-error.filter.js';
import { EvaluationModule } from './evaluation/evaluation.module.js';
import { PlaylistModule } from './playlist/playlist.module.js';
import { SearchModule } from './search/search.module.js';

@Module({
  imports: [AppConfigModule, AuthModule, SearchModule, PlaylistModule, EvaluationModule],
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
