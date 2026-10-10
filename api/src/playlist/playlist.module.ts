import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { SpotifyModule } from '../spotify/spotify.module.js';
import { PlaylistLibraryService } from './playlist-library.service.js';
import { PlaylistController } from './playlist.controller.js';
import { PlaylistRepository } from './playlist.repository.js';

@Module({
  imports: [DatabaseModule, AuthModule, SpotifyModule],
  controllers: [PlaylistController],
  providers: [PlaylistRepository, PlaylistLibraryService],
})
export class PlaylistModule {}
