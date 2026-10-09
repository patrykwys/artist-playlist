import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { AppConfig } from '../config.js';

/** Copied next to the compiled file by nest-cli.json "assets"; read from src/ when running tests. */
const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_FILE = /^(\d+)_[\w-]+\.sql$/;

/** Named parameters: `WHERE id = @id` with `{ id: 'x' }`. Or positional `?` with an array. */
export type SqlParams = Record<string, SQLInputValue> | SQLInputValue[];

interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * One SQLite connection for the whole API, using Node's built-in node:sqlite (nothing to install or compile).
 * Creates the file and applies pending migrations on startup.
 */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  readonly #db: DatabaseSync;
  /** Compiled once per SQL text: the repositories run the same few statements over and over. */
  readonly #statements = new Map<string, StatementSync>();

  constructor(@Inject(AppConfig) config: Pick<AppConfig, 'databasePath'>) {
    if (config.databasePath !== ':memory:') {
      mkdirSync(dirname(config.databasePath), { recursive: true });
    }
    this.#db = new DatabaseSync(config.databasePath);
    // NORMAL is SQLite's advice for WAL: no fsync per commit (a cache write costs ~0.1 ms instead of ~0.6), and
    // the file never corrupts; a power cut may lose the last commits, which a cache and a Spotify sync refill.
    this.#db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
    );
    this.#migrate();
    this.logger.log(`Database ready at ${config.databasePath}`);
  }

  onApplicationShutdown(): void {
    if (this.#db.isOpen) {
      this.#db.close();
    }
  }

  /** INSERT / UPDATE / DELETE. Returns how many rows changed. */
  run(sql: string, params: SqlParams = []): number {
    const statement = this.#prepare(sql);
    const result = Array.isArray(params) ? statement.run(...params) : statement.run(params);
    return Number(result.changes);
  }

  /** First row, or undefined. `T` must mirror the selected columns. */
  get<T>(sql: string, params: SqlParams = []): T | undefined {
    const statement = this.#prepare(sql);
    // node:sqlite returns untyped rows; the SQL is the contract, so the casts live here and nowhere else.
    return (Array.isArray(params) ? statement.get(...params) : statement.get(params)) as T | undefined;
  }

  all<T>(sql: string, params: SqlParams = []): T[] {
    const statement = this.#prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params)) as T[];
  }

  /** Runs `work` in a transaction; rolls back if it throws. */
  transaction(work: () => void): void {
    this.#db.exec('BEGIN');
    try {
      work();
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  #prepare(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  #migrate(): void {
    this.#db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`);
    const current = this.get<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_version')?.version ?? 0;

    for (const migration of readMigrations().filter((item) => item.version > current)) {
      this.transaction(() => {
        this.#db.exec(migration.sql);
        this.run('INSERT INTO schema_version (version, name, applied_at) VALUES (@version, @name, @appliedAt)', {
          version: migration.version,
          name: migration.name,
          appliedAt: new Date().toISOString(),
        });
      });
      this.logger.log(`Applied migration ${migration.name}`);
    }
  }
}

function readMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .flatMap((name) => {
      const match = MIGRATION_FILE.exec(name);
      return match ? [{ version: Number(match[1]), name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }] : [];
    })
    .sort((a, b) => a.version - b.version);
}
