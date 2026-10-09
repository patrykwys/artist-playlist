import { Injectable } from '@nestjs/common';
import { resolve } from 'node:path';

const KEY_HELP =
  'Generate one with: node -p "require(\'node:crypto\').randomBytes(32).toString(\'base64\')" and put it in .env';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

function encryptionKey(): Buffer {
  const value = process.env['TOKEN_ENCRYPTION_KEY'];
  if (!value) {
    throw new Error(`Missing TOKEN_ENCRYPTION_KEY. ${KEY_HELP}`);
  }
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must be 32 bytes in base64. ${KEY_HELP}`);
  }
  return key;
}

function databasePath(): string {
  const path = process.env['DATABASE_PATH'] ?? 'data/artist-mix.db';
  return path === ':memory:' ? path : resolve(path);
}

@Injectable()
export class AppConfig {
  readonly port = Number(process.env.PORT ?? 3000);
  readonly appUrl = process.env.APP_URL ?? 'http://127.0.0.1:4200';
  readonly spotifyClientId = required('SPOTIFY_CLIENT_ID');
  readonly spotifyClientSecret = required('SPOTIFY_CLIENT_SECRET');
  readonly spotifyRedirectUri = process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:4200/api/auth/callback';
  readonly lastfmApiKey = required('LASTFM_API_KEY');
  /** Sent to Wikidata and MusicBrainz, which both ask clients to identify themselves. */
  readonly userAgent = process.env.USER_AGENT ?? 'artist-playlist/0.1 (personal project)';
  /** Relative paths resolve from the folder you start the API in (api/). */
  readonly databasePath = databasePath();
  /** Encrypts Spotify tokens at rest. Changing it logs everyone out. */
  readonly tokenEncryptionKey = encryptionKey();
}
