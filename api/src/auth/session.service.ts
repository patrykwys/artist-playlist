import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SpotifyUser } from '../models.js';
import { SessionRepository, SessionRow } from './session.repository.js';
import { TokenCipher } from './token-cipher.js';
import { UserRepository } from './user.repository.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** The logged-in user as the rest of the API sees it, tokens already decrypted. */
export interface Session {
  idHash: string;
  userId: string;
  displayName: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Sessions live in SQLite, so restarting the API keeps you logged in. */
@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);
  readonly #loginStates = new Map<string, number>();

  constructor(
    private readonly sessions: SessionRepository,
    private readonly users: UserRepository,
    private readonly cipher: TokenCipher,
  ) {}

  onModuleInit(): void {
    const removed = this.sessions.deleteIdleSince(new Date(Date.now() - SESSION_MAX_AGE_MS).toISOString());
    if (removed > 0) {
      this.logger.log(`Removed ${removed} sessions unused for 30 days`);
    }
  }

  /** Stores the session and returns the cookie value; the database only keeps its hash. */
  create(user: SpotifyUser, tokens: SpotifyTokens): string {
    const cookieValue = randomBytes(32).toString('hex');
    const now = new Date().toISOString();
    this.users.upsert(user.id, user.displayName);
    this.sessions.insert({
      id_hash: hashCookie(cookieValue),
      user_id: user.id,
      access_token_enc: this.cipher.encrypt(tokens.accessToken),
      refresh_token_enc: this.cipher.encrypt(tokens.refreshToken),
      access_expires_at: new Date(tokens.expiresAt).toISOString(),
      created_at: now,
      last_seen_at: now,
    });
    return cookieValue;
  }

  findByCookie(cookieValue: string | null): Session | null {
    if (!cookieValue) {
      return null;
    }
    const row = this.sessions.findByIdHash(hashCookie(cookieValue));
    const user = row ? this.users.findById(row.user_id) : undefined;
    if (!row || !user) {
      return null;
    }
    if (Date.now() - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
      this.sessions.touch(row.id_hash, new Date().toISOString());
    }
    return this.#decrypt(row, user.display_name);
  }

  /** Persists tokens after a refresh. */
  saveTokens(session: Session): void {
    this.sessions.updateTokens(
      session.idHash,
      this.cipher.encrypt(session.accessToken),
      this.cipher.encrypt(session.refreshToken),
      new Date(session.expiresAt).toISOString(),
    );
  }

  delete(cookieValue: string | null): void {
    if (cookieValue) {
      this.sessions.delete(hashCookie(cookieValue));
    }
  }

  deleteByIdHash(idHash: string): void {
    this.sessions.delete(idHash);
  }

  createLoginState(): string {
    const state = randomBytes(16).toString('hex');
    this.#loginStates.set(state, Date.now() + LOGIN_STATE_TTL_MS);
    return state;
  }

  consumeLoginState(state: string | undefined): boolean {
    if (!state) {
      return false;
    }
    const expiresAt = this.#loginStates.get(state);
    this.#loginStates.delete(state);
    return expiresAt !== undefined && expiresAt > Date.now();
  }

  /** A session encrypted with an older TOKEN_ENCRYPTION_KEY can't be read: drop it and treat it as logged out. */
  #decrypt(row: SessionRow, displayName: string): Session | null {
    try {
      return {
        idHash: row.id_hash,
        userId: row.user_id,
        displayName,
        accessToken: this.cipher.decrypt(row.access_token_enc),
        refreshToken: this.cipher.decrypt(row.refresh_token_enc),
        expiresAt: Date.parse(row.access_expires_at),
      };
    } catch {
      this.logger.warn('Dropped a session that the current TOKEN_ENCRYPTION_KEY cannot decrypt');
      this.sessions.delete(row.id_hash);
      return null;
    }
  }
}

function hashCookie(cookieValue: string): string {
  return createHash('sha256').update(cookieValue).digest('hex');
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}
