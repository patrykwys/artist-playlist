import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { SessionGuard } from './session.guard.js';
import { SessionRepository } from './session.repository.js';
import { SessionService } from './session.service.js';
import { SpotifyAuthService } from './spotify-auth.service.js';
import { TokenCipher } from './token-cipher.js';
import { UserRepository } from './user.repository.js';

/** Spotify login and sessions. Import it to put SessionGuard on a controller. */
@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [SessionRepository, UserRepository, TokenCipher, SessionService, SessionGuard, SpotifyAuthService],
  exports: [SessionService, SessionGuard, SpotifyAuthService, UserRepository],
})
export class AuthModule {}
