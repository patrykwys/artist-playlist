import { Module } from '@nestjs/common';
import { ApiCacheModule } from '../cache/api-cache.module.js';
import { LastfmApiService } from './lastfm-api.service.js';

@Module({
  imports: [ApiCacheModule],
  providers: [LastfmApiService],
  exports: [LastfmApiService],
})
export class LastfmModule {}
