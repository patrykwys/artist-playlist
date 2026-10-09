import { Module } from '@nestjs/common';
import { ApiCacheModule } from '../cache/api-cache.module.js';
import { WikidataApiService } from './wikidata-api.service.js';

@Module({
  imports: [ApiCacheModule],
  providers: [WikidataApiService],
  exports: [WikidataApiService],
})
export class WikidataModule {}
