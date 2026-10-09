import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/** Mirrors the api_cache table. */
export type ApiCacheRow = {
  key: string;
  value: string;
  expires_at: string;
};

@Injectable()
export class ApiCacheRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Undefined once the entry has expired. */
  findFresh(key: string, now: string): ApiCacheRow | undefined {
    return this.database.get<ApiCacheRow>('SELECT * FROM api_cache WHERE key = ? AND expires_at > ?', [key, now]);
  }

  save(row: ApiCacheRow): void {
    this.database.run(
      `INSERT INTO api_cache (key, value, expires_at) VALUES (@key, @value, @expires_at)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      row,
    );
  }

  /** Returns how many rows were removed. */
  deleteExpired(now: string): number {
    return this.database.run('DELETE FROM api_cache WHERE expires_at <= ?', [now]);
  }
}
