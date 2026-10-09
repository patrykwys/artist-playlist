import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApiCacheRepository } from './api-cache.repository.js';

/** Caches one kind of API response (say, Last.fm artist tags) in the api_cache table until it expires. */
export class CachedLoader<T> {
  /** Concurrent callers for the same key share one request. */
  readonly #inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly repository: ApiCacheRepository,
    private readonly namespace: string,
    private readonly ttlMs: number,
  ) {}

  /** The stored value while it is fresh; otherwise runs `load`, stores the result (null included) and returns it. */
  get(key: string, load: () => Promise<T>): Promise<T> {
    const fullKey = this.#fullKey(key);
    const hit = this.#find(fullKey);
    if (hit) {
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
   * and returns a value for each of them (null included, so misses are cached too).
   */
  async getMany(keys: string[], load: (missing: string[]) => Promise<Map<string, T>>): Promise<Map<string, T>> {
    const values = new Map<string, T>();
    const missing: string[] = [];
    for (const key of new Set(keys)) {
      const hit = this.#find(this.#fullKey(key));
      if (hit) {
        values.set(key, hit.value);
      } else {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      for (const [key, value] of await load(missing)) {
        this.#save(this.#fullKey(key), value);
        values.set(key, value);
      }
    }
    return values;
  }

  #fullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  /** Wrapped so a cached null is told apart from a miss. */
  #find(fullKey: string): { value: T } | null {
    const row = this.repository.findFresh(fullKey, new Date().toISOString());
    return row ? { value: JSON.parse(row.value) } : null;
  }

  #save(fullKey: string, value: T): void {
    this.repository.save({
      key: fullKey,
      value: JSON.stringify(value),
      expires_at: new Date(Date.now() + this.ttlMs).toISOString(),
    });
  }
}

/** Hands out cached loaders; failed loads are never stored, so errors are retried next time. */
@Injectable()
export class ApiCacheService implements OnModuleInit {
  private readonly logger = new Logger(ApiCacheService.name);

  constructor(private readonly repository: ApiCacheRepository) {}

  onModuleInit(): void {
    const removed = this.repository.deleteExpired(new Date().toISOString());
    if (removed > 0) {
      this.logger.log(`Removed ${removed} expired cache entries`);
    }
  }

  /** Fresh for `ttlMs`, then loaded again on the next request. */
  loader<T>(namespace: string, ttlMs: number): CachedLoader<T> {
    return new CachedLoader<T>(this.repository, namespace, ttlMs);
  }
}
