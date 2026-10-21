import { AsyncLocalStorage } from 'node:async_hooks';

const background = new AsyncLocalStorage<true>();

/**
 * Runs `work` as background work: the API requests it makes, however deep, wait in each RequestQueue until
 * no foreground request is waiting. For refreshing stale cache entries without slowing down a generation.
 */
export function inBackground<T>(work: () => Promise<T>): Promise<T> {
  return background.run(true, work);
}

export function isInBackground(): boolean {
  return background.getStore() === true;
}
