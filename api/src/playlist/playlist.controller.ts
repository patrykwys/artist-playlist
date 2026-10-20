import { Body, Controller, Get, HttpException, Logger, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentSession, SessionGuard } from '../auth/session.guard.js';
import type { Session } from '../auth/session.service.js';
import { UpstreamError } from '../common/http.js';
import { GeneratedPlaylist, TraceEvent } from '../models.js';
import { GeneratePlaylistDto } from './dto/generate-playlist.dto.js';
import { PlaylistLibraryService } from './playlist-library.service.js';
import { PlaylistService } from './playlist.service.js';

@Controller('playlists')
@UseGuards(SessionGuard)
export class PlaylistController {
  private readonly logger = new Logger(PlaylistController.name);

  constructor(
    private readonly playlistService: PlaylistService,
    private readonly library: PlaylistLibraryService,
  ) {}

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

  @Post()
  generate(@CurrentSession() session: Session, @Body() request: GeneratePlaylistDto): Promise<GeneratedPlaylist> {
    return this.playlistService.generate(session, request);
  }

  /**
   * Generates like POST /playlists, but streams what the engine does as it happens: one TraceEvent per line
   * (NDJSON), ending with `done` or `error`. Errors travel in the stream because the 200 has already gone out.
   * Validation and the session guard still answer with a plain status before anything is streamed.
   */
  @Post('trace')
  async generateTraced(
    @CurrentSession() session: Session,
    @Body() request: GeneratePlaylistDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).type('application/x-ndjson').setHeader('Cache-Control', 'no-cache');
    response.flushHeaders();
    const emit = (event: TraceEvent): void => {
      if (!response.writableEnded && !response.destroyed) {
        response.write(`${JSON.stringify(event)}\n`);
      }
    };
    try {
      const playlist = await this.playlistService.generate(session, request, { emit });
      emit({ type: 'done', playlist });
    } catch (error) {
      emit({ type: 'error', ...this.#describe(error) });
    } finally {
      response.end();
    }
  }

  /** What the exception filters would have answered, for the stream. */
  #describe(error: unknown): { message: string; status: number } {
    if (error instanceof HttpException) {
      return { message: error.message, status: error.getStatus() };
    }
    if (error instanceof UpstreamError) {
      this.logger.warn(error.message);
      return { message: error.message, status: error.status === 401 ? 401 : 502 };
    }
    this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return { message: 'Something went wrong while building the playlist', status: 500 };
  }
}
