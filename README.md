# drizzle-uncache

Cache adapter for Drizzle ORM powered by `unstorage`.

Plug in any `unstorage` driver as the cache backend so you do not have to hunt for a specific Drizzle cache implementation.

The `un` prefix hints that the cache backend is not tied to a single driver.

Implements Drizzle's custom cache interface:
https://orm.drizzle.team/docs/cache#custom-cache

## Install

```sh
# bun
bun add drizzle-uncache unstorage drizzle-orm

# pnpm
pnpm add drizzle-uncache unstorage drizzle-orm

# npm
npm install drizzle-uncache unstorage drizzle-orm

# yarn
yarn add drizzle-uncache unstorage drizzle-orm
```

## Example usage

Postgres + redis

```ts
import { Client } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { integer, pgTable, text } from "drizzle-orm/pg-core"
import { createStorage } from "unstorage"
import redisDriver from "unstorage/drivers/redis"
import { unstorageCache } from "drizzle-uncache"

const storage = createStorage({ driver: redisDriver({ url: process.env.REDIS_URL }) })
const cache = unstorageCache({ storage, config: { ex: 60 } })

const users = pgTable("users", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
})

const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const db = drizzle(client, { schema: { users }, cache })

const all = await db
  .select()
  .from(users)
  .$withCache({ config: { ex: 60 } })
  .all()
```

## Options

- `storage`: pre-configured `unstorage` instance
- `driver`: `unstorage` driver (used only if `storage` is not provided)
- `base`: key prefix inside storage (default: `drizzle:cache`)
- `config`: default `CacheConfig` (per-query overrides it)
  - TTL fields (`ex`/`px`/`exat`/`pxat`) become an `expiresAt` stored with the payload, so entries expire even if a driver ignores TTL options
  - `keepTtl` reuses a still-valid `expiresAt` from the existing entry instead of recomputing TTL
- `global`: cache all queries by default
- `debug`: enable debug logging (HIT/MISS + PUT/INVALIDATE)

## Drivers

This package does not ship any drivers. It uses `unstorage`, so any `unstorage` driver can be used.

- `drizzle-uncache` is lightweight and does not add driver-specific dependencies.
- Drivers list and docs: https://unstorage.unjs.io/drivers
- Driver options and required dependencies are documented per driver. Some drivers need extra packages (they are optional peer deps of `unstorage`).
- Known to **not support** (drizzle-orm v0.45): `better-sqlite3`, `bun-sqlite`, `durable-sqlite`, `expo-sqlite`, `libsql`, `mysql-proxy`, `singlestore-proxy`, `sql-js`

## Recommendations

- Local dev: `fs-lite` for persistence, `lru-cache` for process-local TTL, `memory` for tests.
- Serverless: prefer a shared backend like `upstash`, `vercel-kv` or `cloudflare-kv`.
- Multiple instances: avoid process-local caches unless you accept per-instance results.

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
