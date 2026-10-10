import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentSession, SessionGuard } from '../auth/session.guard.js';
import type { Session } from '../auth/session.service.js';
import { GeneratedPlaylist } from '../models.js';
import { PlaylistLibraryService } from './playlist-library.service.js';

@Controller('playlists')
@UseGuards(SessionGuard)
export class PlaylistController {
  constructor(private readonly library: PlaylistLibraryService) {}

  /** Playlists this app has made, newest first, from the database. */
  @Get()
  list(@CurrentSession() session: Session): Promise<GeneratedPlaylist[]> {
    return this.library.list(session);
  }

  /** Re-reads your playlists from Spotify (renames, deletions, edits), then returns the list. */
  @Post('sync')
  async sync(@CurrentSession() session: Session): Promise<GeneratedPlaylist[]> {
    await this.library.sync(session);
    return this.library.list(session);
  }
}
