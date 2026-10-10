import { Module } from '@nestjs/common';
import { LastfmModule } from '../lastfm/lastfm.module.js';
import { MusicBrainzModule } from '../musicbrainz/musicbrainz.module.js';
import { WikidataModule } from '../wikidata/wikidata.module.js';
import { ArtistCountryService } from './artist-country.service.js';
import { CandidatePoolService } from './candidate-pool.service.js';

/** Finds and describes candidate artists for a set of seeds; ranking them is the pure engine/ranking.ts. */
@Module({
  imports: [LastfmModule, WikidataModule, MusicBrainzModule],
  providers: [ArtistCountryService, CandidatePoolService],
  exports: [CandidatePoolService],
})
export class RecommenderModule {}
