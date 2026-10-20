import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { EvaluationStatus } from '../models.js';

/** Mirrors the evaluation_run table. */
export type EvaluationRunRow = {
  id: string;
  user_id: string;
  status: EvaluationStatus;
  settings: string;
  progress_done: number;
  progress_total: number;
  results: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

@Injectable()
export class EvaluationRepository {
  constructor(private readonly database: DatabaseService) {}

  insert(row: Pick<EvaluationRunRow, 'id' | 'user_id' | 'settings' | 'started_at'>): void {
    this.database.run(
      `INSERT INTO evaluation_run (id, user_id, status, settings, started_at)
       VALUES (@id, @user_id, 'running', @settings, @started_at)`,
      row,
    );
  }

  findByUser(userId: string): EvaluationRunRow[] {
    return this.database.all<EvaluationRunRow>(
      'SELECT * FROM evaluation_run WHERE user_id = ? ORDER BY started_at DESC',
      [userId],
    );
  }

  findById(userId: string, id: string): EvaluationRunRow | undefined {
    return this.database.get<EvaluationRunRow>('SELECT * FROM evaluation_run WHERE user_id = ? AND id = ?', [
      userId,
      id,
    ]);
  }

  hasRunning(userId: string): boolean {
    return (
      this.database.get<{ id: string }>("SELECT id FROM evaluation_run WHERE user_id = ? AND status = 'running'", [
        userId,
      ]) !== undefined
    );
  }

  updateProgress(id: string, done: number, total: number): void {
    this.database.run('UPDATE evaluation_run SET progress_done = ?, progress_total = ? WHERE id = ?', [done, total, id]);
  }

  finish(id: string, results: string, finishedAt: string): void {
    this.database.run("UPDATE evaluation_run SET status = 'done', results = ?, finished_at = ? WHERE id = ?", [
      results,
      finishedAt,
      id,
    ]);
  }

  fail(id: string, error: string, finishedAt: string): void {
    this.database.run("UPDATE evaluation_run SET status = 'failed', error = ?, finished_at = ? WHERE id = ?", [
      error,
      finishedAt,
      id,
    ]);
  }

  /** Runs still marked running when the API starts were cut off by a restart. Returns how many. */
  failAllRunning(error: string, finishedAt: string): number {
    return this.database.run(
      "UPDATE evaluation_run SET status = 'failed', error = ?, finished_at = ? WHERE status = 'running'",
      [error, finishedAt],
    );
  }
}
