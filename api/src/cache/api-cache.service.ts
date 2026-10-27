import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { inBackground } from '../common/background.js';
import { ApiCacheRepository } from './api-cache.repository.js';

/**
 * Fresh lifetimes vary by up to this much either way, so the hundreds of entries one cold run writes don't all go
 * stale on the same day.
 */
const TTL_JITTER = 0.2;
/** How long past its fresh lifetime an entry is still served while being refreshed: this many lifetimes. */
const STALE_FACTOR = 3;

interface Hit<T> {
  value: T;
  isStale: boolean;
}

/**
 * Caches one kind of API response (say, Last.fm artist tags) in the api_cache table, stale-while-revalidate:
 * a fresh entry is served as is; a stale one is served at once and refreshed in the background (its requests wait
 * behind foreground ones, see RequestQueue); one too old even for that, or none, is loaded while you wait.
 */
export class CachedLoader<T> {
  /** Concurrent callers for the same key share one request. */
  readonly #inFlight = new Map<string, Promise<T>>();
  /** Background refreshes under way, by full key, so a stale entry is refreshed once however often it is read. */
  readonly #refreshing = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: ApiCacheRepository,
    private readonly namespace: string,
    private readonly ttlMs: number,
    private readonly staleMs: number,
    private readonly logger: Logger,
    private readonly random: () => number = Math.random,
  ) {}

  /** The stored value, fresh or stale; otherwise runs `load`, stores the result (null included) and returns it. */
  get(key: string, load: () => Promise<T>): Promise<T> {
    const fullKey = this.#fullKey(key);
    const hit = this.#find(fullKey);
    if (hit) {
      if (hit.isStale) {
        this.#refresh([fullKey], async () => new Map([[fullKey, await load()]]));
      }
      return Promise.resolve(hit.value);
    }

    const pending = this.#inFlight.get(fullKey);
    if (pending) {
      return pending;
    }
    const loading = load()
      .then((value) => {
        this.#save(fullKey, value);
        return value;
      })
      .finally(() => this.#inFlight.delete(fullKey));
    this.#inFlight.set(fullKey, loading);
    return loading;
  }

  /**
   * `get` for many keys with one batched request: `load` receives only the keys missing from the cache
   * and returns a value for each of them (null included, so misses are cached too). Stale keys are served and
   * refreshed with one more batched request in the background.
   */
  async getMany(keys: string[], load: (missing: string[]) => Promise<Map<string, T>>): Promise<Map<string, T>> {
    const values = new Map<string, T>();
    const missing: string[] = [];
    const stale: string[] = [];
    for (const key of new Set(keys)) {
      const hit = this.#find(this.#fullKey(key));
      if (hit) {
        values.set(key, hit.value);
        if (hit.isStale) {
          stale.push(key);
        }
      } else {
        missing.push(key);
      }
    }

    if (stale.length > 0) {
      this.#refresh(
        stale.map((key) => this.#fullKey(key)),
        async () => {
          const loaded = await load(stale);
          return new Map([...loaded].map(([key, value]) => [this.#fullKey(key), value]));
        },
      );
    }
    if (missing.length > 0) {
      for (const [key, value] of await load(missing)) {
        this.#save(this.#fullKey(key), value);
        values.set(key, value);
      }
    }
    return values;
  }

  /** Settles once every background refresh started so far has: for tests. */
  async idle(): Promise<void> {
    await Promise.all(this.#refreshing.values());
  }

  /** Reloads stale entries in the background. A failure only costs the refresh: the stale value stays. */
  #refresh(fullKeys: string[], load: () => Promise<Map<string, T>>): void {
    if (fullKeys.some((fullKey) => this.#refreshing.has(fullKey))) {
      return;
    }
    const refreshing = inBackground(load)
      .then((loaded) => loaded.forEach((value, fullKey) => this.#save(fullKey, value)))
      .catch((error: unknown) =>
        this.logger.warn(`Refreshing ${fullKeys.length} stale ${this.namespace} entries failed: ${String(error)}`),
      )
      .finally(() => fullKeys.forEach((fullKey) => this.#refreshing.delete(fullKey)));
    fullKeys.forEach((fullKey) => this.#refreshing.set(fullKey, refreshing));
  }

  #fullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /** Wrapped so a cached null is told apart from a miss. */
  #find(fullKey: string): Hit<T> | null {
    const now = new Date().toISOString();
    const row = this.repository.findUsable(fullKey, now);
    return row ? { value: JSON.parse(row.value), isStale: row.expires_at <= now } : null;
  }

  #save(fullKey: string, value: T): void {
    const expiresAt = Date.now() + this.ttlMs * (1 + TTL_JITTER * (2 * this.random() - 1));
    this.repository.save({
      key: fullKey,
      value: JSON.stringify(value),
      expires_at: new Date(expiresAt).toISOString(),
      stale_until: new Date(expiresAt + this.staleMs).toISOString(),
    });
  }
}

/** Hands out cached loaders; failed loads are never stored, so errors are retried next time. */
@Injectable()
export class ApiCacheService implements OnModuleInit {
  private readonly logger = new Logger(ApiCacheService.name);

  constructor(private readonly repository: ApiCacheRepository) {}

  onModuleInit(): void {
    const removed = this.repository.deleteUnusable(new Date().toISOString());
    if (removed > 0) {
      this.logger.log(`Removed ${removed} cache entries too old even to serve stale`);
    }
  }

  /** Fresh for about `ttlMs` (±20%), then served stale while refreshed for `staleMs` more (3 × `ttlMs`). */
  loader<T>(namespace: string, ttlMs: number, staleMs = ttlMs * STALE_FACTOR): CachedLoader<T> {
    return new CachedLoader<T>(this.repository, namespace, ttlMs, staleMs, this.logger);
  }
}
