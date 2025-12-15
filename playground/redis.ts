import { Database } from "bun:sqlite";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { Elysia } from "elysia";
import Redis from "ioredis";
import { createStorage, prefixStorage } from "unstorage";
import redisDriver from "unstorage/drivers/redis";

import { unstorageCache } from "../src/index";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const cacheBase = "playground:cache";
const CACHE_TTL_SECONDS = 30;
const sqlitePath = process.env.SQLITE_PATH ?? ":memory:";
const port = Number(process.env.PORT ?? "3000");
const cacheDebug = true;
const dbDebug = true;

const redis = new Redis(redisUrl);
const storage = createStorage({ driver: redisDriver({ url: redisUrl }) });
const cacheStorage = prefixStorage(storage, cacheBase);

const cache = unstorageCache({
  storage,
  base: cacheBase,
  config: { ex: CACHE_TTL_SECONDS },
  debug: cacheDebug,
});

const sqlite = new Database(sqlitePath, { create: true });
sqlite.run(`
  create table if not exists users (
    id integer primary key autoincrement,
    name text not null
  )
`);

const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

// bun-sqlite driver doesn't support cache mechanism, so make own wrapper
const db = drizzle(
  async (sql, params, method) => {
    if (dbDebug) {
      console.log("[db]", { method, sql, params });
    }

    const stmt = sqlite.query(sql);

    if (method === "run") {
      stmt.run(...params);
      return { rows: [] };
    }

    if (method === "get") {
      const row = stmt.values(...params)[0] ?? null;
      return { rows: row as unknown as unknown[] };
    }

    return { rows: stmt.values(...params) };
  },
  {
    schema: { users },
    cache,
  },
);

function randomUserName(): string {
  return `u_${crypto.randomUUID().slice(0, 8)}`;
}

async function clearCache(): Promise<number> {
  const keys = await cacheStorage.getKeys();
  await Promise.all(keys.map((key) => cacheStorage.removeItem(key)));
  return keys.length;
}

const app = new Elysia()
  .get("/health", async ({ set }) => {
    try {
      return {
        ok: true,
        redis: await redis.ping(),
        sqlitePath,
        cacheBase,
        ttlSeconds: CACHE_TTL_SECONDS,
      };
    } catch (error) {
      set.status = 500;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })
  .get("/keys", async ({ set }) => {
    try {
      const storageKeys = await cacheStorage.getKeys();
      return {
        ok: true,
        storageKeys,
      };
    } catch (error) {
      set.status = 500;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })
  .get("/users/create", async ({ set }) => {
    try {
      const name = randomUserName();
      await db.insert(users).values({ name }).run();
      return { ok: true, inserted: { name } };
    } catch (error) {
      set.status = 500;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })
  .get("/users", async ({ set }) => {
    try {
      const rows = await db
        .select()
        .from(users)
        .$withCache({ config: { ex: CACHE_TTL_SECONDS } })
        .all();
      return { ok: true, users: rows };
    } catch (error) {
      set.status = 500;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })
  .get("/clear", async ({ set }) => {
    try {
      await db.delete(users).run();
      const deleted = await clearCache();
      return { ok: true, cacheKeysDeleted: deleted };
    } catch (error) {
      set.status = 500;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })
  .onStop(async () => {
    await redis.quit();
    sqlite.close();
  })
  .listen(port);

console.log(`Playground listening on http://localhost:${app.server?.port}`);
