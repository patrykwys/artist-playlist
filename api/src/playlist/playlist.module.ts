import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { LastfmModule } from '../lastfm/lastfm.module.js';
import { RecommenderModule } from '../recommender/recommender.module.js';
import { SpotifyModule } from '../spotify/spotify.module.js';
import { PlaylistLibraryService } from './playlist-library.service.js';
import { PlaylistController } from './playlist.controller.js';
import { PlaylistRepository } from './playlist.repository.js';
import { PlaylistService } from './playlist.service.js';
import { TrackFitService } from './track-fit.service.js';
import { TrackPickerService } from './track-picker.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, SpotifyModule, LastfmModule, RecommenderModule],
  controllers: [PlaylistController],
  providers: [PlaylistRepository, PlaylistLibraryService, TrackFitService, TrackPickerService, PlaylistService],
})
export class PlaylistModule {}
