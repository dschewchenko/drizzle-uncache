import type { CacheConfig } from "drizzle-orm/cache/core/types";
import type { Driver, Storage } from "unstorage";

export type CacheEntry = {
  value: unknown;
  expiresAt?: number;
  tables?: string[];
};

export type UnstorageCacheOptions = {
  /**
   * Optional pre-configured storage instance.
   *
   * @defaults [memory driver](https://unstorage.unjs.io/drivers/memory)
   */
  storage?: Storage;
  /**
   * Driver to create a storage instance with.
   *
   * @defaults [memory driver](https://unstorage.unjs.io/drivers/memory)
   */
  driver?: Driver;
  /**
   * Prefix for cache keys inside storage.
   * Defaults to `dc`.
   */
  base?: string;
  /**
   * Default TTL config applied when a query does not provide one.
   *
   * Notes on TTL and `keepTtl`:
   * - `ex`/`px`/`exat`/`pxat` map to an absolute expiration timestamp (`expiresAt`).
   * - We always store `expiresAt` in the payload to enforce expiry even if the driver ignores TTL
   * - When `keepTtl` is true and a previous entry exists with a future `expiresAt`,
   *   the new value reuses that `expiresAt` instead of recalculating, mirroring Redis KEEP TTL
   * - TTL options are still passed to the driver when possible, and `expiresAt` still controls cache validity on read
   */
  config?: CacheConfig;
  /**
   * Cache every query by default.
   */
  global?: boolean;
  /**
   * When `true`, logs HIT/MISS/PUT/INVALIDATE to console.
   */
  debug?: boolean;
};
