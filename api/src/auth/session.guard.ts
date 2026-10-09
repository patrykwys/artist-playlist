import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_COOKIE, Session, SessionService, readCookie } from './session.service.js';

interface SessionRequest extends Request {
  spotifySession?: Session;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    const session = this.sessions.findByCookie(readCookie(request.headers.cookie, SESSION_COOKIE));
    if (!session) {
      throw new UnauthorizedException('Log in with Spotify first');
    }
    request.spotifySession = session;
    return true;
  }
}

/** The logged-in user's session, like @AuthenticationPrincipal in Spring. Use behind SessionGuard. */
export const CurrentSession = createParamDecorator((_: unknown, context: ExecutionContext): Session => {
  const session = context.switchToHttp().getRequest<SessionRequest>().spotifySession;
  if (!session) {
    throw new UnauthorizedException('Log in with Spotify first');
  }
  return session;
});
