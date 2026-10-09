import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SpotifyApiService } from './spotify-api.service.js';

@Module({
  imports: [AuthModule],
  providers: [SpotifyApiService],
  exports: [SpotifyApiService],
})
export class SpotifyModule {}
