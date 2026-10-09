import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LastfmModule } from '../lastfm/lastfm.module.js';
import { SpotifyModule } from '../spotify/spotify.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [AuthModule, SpotifyModule, LastfmModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
