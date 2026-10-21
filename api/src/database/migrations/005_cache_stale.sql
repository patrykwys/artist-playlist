-- 005: stale-while-revalidate for api_cache. Past expires_at an entry is stale: still served at once while it is
-- refreshed in the background, until stale_until, after which it counts as missing. So a run a few weeks after
-- the last one is no longer a full cold run (see ApiCacheService).

ALTER TABLE api_cache ADD COLUMN stale_until TEXT NOT NULL DEFAULT '';

-- Entries from before this: three more weeks, in the same ISO format as expires_at ('2026-10-27T10:00:00.000Z').
UPDATE api_cache SET stale_until = strftime('%Y-%m-%dT%H:%M:%fZ', expires_at, '+21 days');

DROP INDEX api_cache_expires_idx;
CREATE INDEX api_cache_stale_until_idx ON api_cache (stale_until);
