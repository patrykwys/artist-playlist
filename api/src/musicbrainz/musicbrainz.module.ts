import { Module } from '@nestjs/common';
import { ApiCacheModule } from '../cache/api-cache.module.js';
import { MusicBrainzApiService } from './musicbrainz-api.service.js';

@Module({
  imports: [ApiCacheModule],
  providers: [MusicBrainzApiService],
  exports: [MusicBrainzApiService],
})
export class MusicBrainzModule {}
