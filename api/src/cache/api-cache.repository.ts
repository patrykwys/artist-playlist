import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/** Mirrors the api_cache table. */
export type ApiCacheRow = {
  key: string;
  value: string;
  /** Fresh until then (ISO); stale after, still served while it is refreshed. */
  expires_at: string;
  /** Past this (ISO) it is too old even to serve stale. */
  stale_until: string;
};

@Injectable()
export class ApiCacheRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Fresh or stale; null once even stale is over. */
  findUsable(key: string, now: string): ApiCacheRow | undefined {
    return this.database.get<ApiCacheRow>('SELECT * FROM api_cache WHERE key = ? AND stale_until > ?', [key, now]);
  }

  save(row: ApiCacheRow): void {
    this.database.run(
      `INSERT INTO api_cache (key, value, expires_at, stale_until) VALUES (@key, @value, @expires_at, @stale_until)
       ON CONFLICT (key) DO UPDATE SET
         value = excluded.value, expires_at = excluded.expires_at, stale_until = excluded.stale_until`,
      row,
    );
  }

  /** Removes entries too old even to serve stale. Returns how many rows were removed. */
  deleteUnusable(now: string): number {
    return this.database.run('DELETE FROM api_cache WHERE stale_until <= ?', [now]);
  }
}
