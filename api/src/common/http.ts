export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;
const RETRY_STATUSES = new Set([429, 503]);
/** Covers connecting, the response and its body; without it a stalled connection hangs a request forever. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * `fetch` with a timeout. A GET that fails without an answer (timeout, DNS, connection reset) is retried with
 * backoff; other methods are not, since repeating a POST could create a playlist twice.
 * Throws UpstreamError (504) when the service never answered.
 */
export async function request(service: string, url: string, init: RequestInit = {}, attempt = 0): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const isGet = (init.method ?? 'GET').toUpperCase() === 'GET';
    if (isGet && attempt < MAX_RETRIES) {
      await sleep(1000 * 2 ** attempt);
      return request(service, url, init, attempt + 1);
    }
    const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : '';
    throw new UpstreamError(service, 504, `${service} did not answer${reason ? ` (${reason})` : ''}`);
  }
}

/**
 * GET/POST JSON through `queue` (when given), retrying on 429 and 503 (honours Retry-After; MusicBrainz answers
 * 503 when busy). The limit is the whole app's, not one request's, so the wait holds the queue back for everyone
 * and the retry queues again. Throws UpstreamError on any other non-2xx, or when the service never answered.
 */
export async function fetchJson<T>(
  service: string,
  url: string,
  init: RequestInit = {},
  queue?: RequestQueue,
  attempt = 0,
): Promise<T> {
  const response = await (queue ? queue.run(() => request(service, url, init)) : request(service, url, init));

  if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
    const retryAfterSeconds = Number(response.headers.get('retry-after') ?? '1');
    const waitMs = Math.min(Math.max(retryAfterSeconds, 1), 30) * 1000;
    if (queue) {
      queue.pauseFor(waitMs);
    } else {
      await sleep(waitMs);
    }
    return fetchJson<T>(service, url, init, queue, attempt + 1);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new UpstreamError(service, response.status, `${service} ${response.status}: ${body.slice(0, 300)}`);
  }

  const data: T = await response.json();
  return data;
}

/**
 * Spaces request start times by a minimum interval, so bursts stay under an API's rate limit. Each API client
 * holds one, and Nest makes the clients singletons, so every caller and every concurrent request shares it.
 */
export class RequestQueue {
  readonly #waiting: (() => void)[] = [];
  #nextStart = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly minIntervalMs: number) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const turn = new Promise<void>((start) => this.#waiting.push(start));
    this.#pump();
    return turn.then(task);
  }

  /** Starts nothing new for `ms`: for a Retry-After, which tells the whole app to slow down. */
  pauseFor(ms: number): void {
    this.#nextStart = Math.max(this.#nextStart, Date.now() + ms);
  }

  /** Waiting requests: for logs and tests. */
  get size(): number {
    return this.#waiting.length;
  }

  #pump(): void {
    if (this.#timer !== null || this.size === 0) {
      return;
    }
    const wait = this.#nextStart - Date.now();
    if (wait > 0) {
      // A pause that comes in meanwhile is seen when this fires.
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#pump();
      }, wait);
      return;
    }
    const start = this.#waiting.shift();
    this.#nextStart = Date.now() + this.minIntervalMs;
    start?.();
    this.#pump();
  }
}

export function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export const DAY_MS = 24 * 60 * 60 * 1000;
