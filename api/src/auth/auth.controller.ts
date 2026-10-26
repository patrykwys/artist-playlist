import { Controller, Get, HttpCode, Logger, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfig } from '../config.js';
import type { SpotifyUser } from '../models.js';
import { CurrentSession, SessionGuard } from './session.guard.js';
import { SESSION_COOKIE, SESSION_MAX_AGE_MS, SessionService, readCookie } from './session.service.js';
import type { Session } from './session.service.js';
import { SpotifyAuthService } from './spotify-auth.service.js';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly spotifyAuth: SpotifyAuthService,
  ) {}

  @Get('login')
  login(@Res() response: Response): void {
    response.redirect(this.spotifyAuth.authorizeUrl(this.sessions.createLoginState()));
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (error || !code || !this.sessions.consumeLoginState(state)) {
      this.logger.warn(`Spotify login failed: ${error ?? 'missing code or bad state'}`);
      response.redirect(`${this.config.appUrl}/?login=failed`);
      return;
    }

    // The browser is on this page, not the app: a failure here goes back to the app's message, not a JSON error.
    let cookieValue: string;
    try {
      const tokens = await this.spotifyAuth.exchangeCode(code);
      const user = await this.spotifyAuth.profile(tokens.accessToken);
      cookieValue = this.sessions.create(user, tokens);
    } catch (failure) {
      this.logger.warn(`Spotify login failed: ${failure instanceof Error ? failure.message : String(failure)}`);
      response.redirect(`${this.config.appUrl}/?login=failed`);
      return;
    }
    response.cookie(SESSION_COOKIE, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_MS,
    });
    response.redirect(this.config.appUrl);
  }

  /** Served from the database: a page refresh no longer calls Spotify. */
  @Get('me')
  @UseGuards(SessionGuard)
  me(@CurrentSession() session: Session): SpotifyUser {
    return { id: session.userId, displayName: session.displayName };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    this.sessions.delete(readCookie(request.headers.cookie, SESSION_COOKIE));
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
