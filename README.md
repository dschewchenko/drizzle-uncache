# drizzle-uncache

Cache adapter for Drizzle ORM v1 powered by `unstorage`.

Plug in any `unstorage` driver as the cache backend so you do not have to hunt for a specific Drizzle cache implementation.

The `un` prefix hints that the cache backend is not tied to a single driver.

Implements Drizzle's custom cache interface:
https://orm.drizzle.team/docs/cache#custom-cache

## Install

```sh
# bun
bun add drizzle-uncache unstorage drizzle-orm@rc

# pnpm
pnpm add drizzle-uncache unstorage drizzle-orm@rc

# npm
npm install drizzle-uncache unstorage drizzle-orm@rc

# yarn
yarn add drizzle-uncache unstorage drizzle-orm@rc
```

## Example usage

Postgres + redis

```ts
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { createStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";
import { unstorageCache } from "drizzle-uncache";

const storage = createStorage({ driver: redisDriver({ url: process.env.REDIS_URL }) });
const cache = unstorageCache({ storage, config: { ex: 60 } });

const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
});

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const db = drizzle(client, { schema: { users }, cache });

const all = await db
  .select()
  .from(users)
  .$withCache({ config: { ex: 60 } });

await db.$cache.invalidate({ tables: users });
await db.$cache.invalidate({ tags: "custom_key" });
```

## Options

- `storage`: pre-configured `unstorage` instance
- `driver`: `unstorage` driver (used only if `storage` is not provided)
- `base`: key prefix inside storage (default: `drizzle:cache`)
- `config`: default `CacheConfig` (per-query overrides it)
  - TTL fields (`ex`/`px`/`exat`/`pxat`) become an `expiresAt` stored with the payload, so entries expire even if a driver ignores TTL options
  - `keepTtl` reuses a still-valid `expiresAt` from the existing entry instead of recomputing TTL
  - `hexOptions` is accepted through Drizzle's `CacheConfig` type but is Redis-specific and is not used by this adapter
- `global`: cache all queries by default
- `debug`: enable debug logging (HIT/MISS + PUT/INVALIDATE)

## Drivers

This package does not ship any drivers. It uses `unstorage`, so any `unstorage` driver can be used.

- `drizzle-uncache` is lightweight and does not add driver-specific dependencies.
- Drivers list and docs: https://unstorage.unjs.io/drivers
- Driver options and required dependencies are documented per driver. Some drivers need extra packages (they are optional peer deps of `unstorage`).

## Supported Drizzle databases

`drizzle-uncache` is database-agnostic, but Drizzle has to wire its cache extension into the database driver. The list below is based on `drizzle-orm@1.0.0-rc.3` driver code and should be rechecked before each Drizzle v1 RC/final upgrade.

Currently cache-enabled Drizzle entrypoints that accept the normal `drizzle(..., { cache })` setup:

- PostgreSQL-compatible: `node-postgres`, `postgres-js`, `neon-http`, `neon-serverless`, `vercel-postgres`, `pglite`, `pg-proxy`, `bun-sql/postgres`, `netlify-db`, `xata-http`
- MySQL-compatible: `mysql2`, `planetscale-serverless`, `tidb-serverless`, `bun-sql/mysql`
- SQLite/Turso-compatible: `d1`, `libsql`, `tursodatabase`, `bun-sql/sqlite`, `op-sqlite`, `sqlite-cloud`, `sqlite-proxy`
- SingleStore: `singlestore`

The repository integration tests currently exercise the Drizzle cache contract through `drizzle-orm/pg-proxy`, which lets the suite verify select caching, mutation invalidation, manual tag invalidation, global caching, opt-out caching, and public cache typing without requiring a live database.

Not claimed as supported yet:

- `better-sqlite3`, Durable Objects SQLite, Expo SQLite, AWS Data API drivers, and views are still listed in the Drizzle cache docs as temporary limitations.
- Drivers where `drizzle-orm@1.0.0-rc.3` does not expose the cache through the normal driver path are not listed above, even if their config types are broad enough to accept a `cache` field.

## Drizzle cache limitations

Drizzle decides which queries can use the cache extension and which tables are attached to each cache entry. This adapter follows the metadata Drizzle passes to the custom cache interface.

Known Drizzle cache limitations currently include raw `db.execute(...)` queries, D1/libsql batch operations, transactions, relational queries, views, AWS Data API drivers, and selected SQLite drivers listed in the Drizzle cache docs.

## Recommendations

- Local dev: `fs-lite` for persistence, `lru-cache` for process-local TTL, `memory` for tests.
- Serverless: prefer a shared backend like `upstash`, `vercel-kv` or `cloudflare-kv`.
- Multiple instances: avoid process-local caches unless you accept per-instance results.

## Testing

`bun run test` runs Biome checks, TypeScript type checks for the library, tests, and playground, adapter unit tests, and Drizzle ORM integration tests through `drizzle-orm/pg-proxy`.

## Contribution

- Fork repository
- Install dependencies with `bun install`
- Use `bun run dev` to start Vitest watcher verifying changes
- Use `bun run test` before pushing to ensure all tests and lint checks passing

## Thanks

Thanks to the Drizzle ORM team and the creators and contributors of `unstorage`.

Made with love by dschewchenko (Dmytro Shevchenko 🇺🇦).

## License

[MIT](./LICENSE)
