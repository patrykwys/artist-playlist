import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/** Mirrors the session table. */
export type SessionRow = {
  id_hash: string;
  user_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  access_expires_at: string;
  created_at: string;
  last_seen_at: string;
};

@Injectable()
export class SessionRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(row: SessionRow): void {
    this.database.run(
      `INSERT INTO session (id_hash, user_id, access_token_enc, refresh_token_enc, access_expires_at, created_at, last_seen_at)
       VALUES (@id_hash, @user_id, @access_token_enc, @refresh_token_enc, @access_expires_at, @created_at, @last_seen_at)`,
      row,
    );
  }

  findByIdHash(idHash: string): SessionRow | undefined {
    return this.database.get<SessionRow>('SELECT * FROM session WHERE id_hash = ?', [idHash]);
  }

  updateTokens(idHash: string, accessTokenEnc: string, refreshTokenEnc: string, accessExpiresAt: string): void {
    this.database.run(
      'UPDATE session SET access_token_enc = ?, refresh_token_enc = ?, access_expires_at = ? WHERE id_hash = ?',
      [accessTokenEnc, refreshTokenEnc, accessExpiresAt, idHash],
    );
  }

  touch(idHash: string, lastSeenAt: string): void {
    this.database.run('UPDATE session SET last_seen_at = ? WHERE id_hash = ?', [lastSeenAt, idHash]);
  }

  delete(idHash: string): void {
    this.database.run('DELETE FROM session WHERE id_hash = ?', [idHash]);
  }

  /** Returns how many sessions were removed. */
  deleteIdleSince(cutoff: string): number {
    return this.database.run('DELETE FROM session WHERE last_seen_at < ?', [cutoff]);
  }
}
