import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

/** Mirrors the app_user table. */
export type AppUserRow = {
  id: string;
  display_name: string;
  playlists_synced_at: string | null;
  created_at: string;
};

@Injectable()
export class UserRepository {
  constructor(private readonly database: DatabaseService) {}

  upsert(id: string, displayName: string): void {
    this.database.run(
      `INSERT INTO app_user (id, display_name, created_at)
       VALUES (@id, @displayName, @now)
       ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name`,
      { id, displayName, now: new Date().toISOString() },
    );
  }

  findById(id: string): AppUserRow | undefined {
    return this.database.get<AppUserRow>('SELECT * FROM app_user WHERE id = ?', [id]);
  }

  markPlaylistsSynced(id: string, syncedAt: string): void {
    this.database.run('UPDATE app_user SET playlists_synced_at = ? WHERE id = ?', [syncedAt, id]);
  }
}
