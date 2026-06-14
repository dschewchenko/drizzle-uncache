import type { Cache } from "drizzle-orm/cache/core";
import { integer, pgTable, text } from "drizzle-orm/pg-core";
import type { RemoteCallback } from "drizzle-orm/pg-proxy";
import { drizzle } from "drizzle-orm/pg-proxy";
import { createStorage } from "unstorage";
import { describe, expect, expectTypeOf, it } from "vitest";
import { unstorageCache } from "../src/unstorage-cache";

const users = pgTable("users", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

type QueryCall = {
  sql: string;
  params: unknown[];
  method: "all" | "execute";
};

function createRemoteDb(options: { global?: boolean } = {}) {
  const calls: QueryCall[] = [];
  let selectedId = 0;

  const callback: RemoteCallback = async (sql, params, method) => {
    calls.push({ sql, params, method });

    if (method === "all") {
      selectedId += 1;
      return { rows: [[selectedId, `User ${selectedId}`]] };
    }

    return { rows: [] };
  };

  const cache = unstorageCache({
    storage: createStorage(),
    config: { ex: 60 },
    ...(options.global !== undefined ? { global: options.global } : {}),
  });

  const db = drizzle(callback, { cache });

  return { calls, cache, db };
}

describe("drizzle orm integration", () => {
  it("matches Drizzle cache config types", () => {
    const { cache, db } = createRemoteDb();

    expectTypeOf(cache).toMatchTypeOf<Cache>();
    expectTypeOf(db.$cache.invalidate)
      .parameter(0)
      .toMatchTypeOf<Parameters<Cache["onMutate"]>[0]>();
  });

  it("caches explicit select queries through Drizzle and invalidates on mutations", async () => {
    const { calls, db } = createRemoteDb();

    const first = await db
      .select()
      .from(users)
      .$withCache({ config: { ex: 60 } });
    const second = await db
      .select()
      .from(users)
      .$withCache({ config: { ex: 60 } });

    expect(first).toEqual([{ id: 1, name: "User 1" }]);
    expect(second).toEqual(first);
    expect(calls.filter((call) => call.method === "all")).toHaveLength(1);

    await db.insert(users).values({ id: 2, name: "User 2" });
    const afterMutation = await db
      .select()
      .from(users)
      .$withCache({ config: { ex: 60 } });

    expect(afterMutation).toEqual([{ id: 2, name: "User 2" }]);
    expect(calls.map((call) => call.method)).toEqual(["all", "execute", "all"]);
  });

  it("uses Drizzle manual tag invalidation", async () => {
    const { calls, db } = createRemoteDb();

    const first = await db
      .select()
      .from(users)
      .$withCache({ tag: "users:list", config: { ex: 60 } });
    const second = await db
      .select()
      .from(users)
      .$withCache({ tag: "users:list", config: { ex: 60 } });

    expect(second).toEqual(first);
    expect(calls.filter((call) => call.method === "all")).toHaveLength(1);

    await db.$cache.invalidate({ tags: "users:list" });
    const afterTagInvalidation = await db
      .select()
      .from(users)
      .$withCache({ tag: "users:list", config: { ex: 60 } });

    expect(afterTagInvalidation).toEqual([{ id: 2, name: "User 2" }]);
    expect(calls.filter((call) => call.method === "all")).toHaveLength(2);
  });

  it("uses Drizzle manual table invalidation", async () => {
    const { calls, db } = createRemoteDb();

    const first = await db
      .select()
      .from(users)
      .$withCache({ config: { ex: 60 } });
    const second = await db
      .select()
      .from(users)
      .$withCache({ config: { ex: 60 } });

    expect(second).toEqual(first);
    expect(calls.filter((call) => call.method === "all")).toHaveLength(1);

    await db.$cache.invalidate({ tables: users });
    const afterTableInvalidation = await db
      .select()
      .from(users)
      .$withCache({ config: { ex: 60 } });

    expect(afterTableInvalidation).toEqual([{ id: 2, name: "User 2" }]);
    expect(calls.filter((call) => call.method === "all")).toHaveLength(2);
  });

  it("keeps autoInvalidate false queries until TTL or manual tag invalidation", async () => {
    const { calls, db } = createRemoteDb();

    const first = await db
      .select()
      .from(users)
      .$withCache({ autoInvalidate: false, config: { ex: 60 } });
    const second = await db
      .select()
      .from(users)
      .$withCache({ autoInvalidate: false, config: { ex: 60 } });

    expect(second).toEqual(first);
    expect(calls.filter((call) => call.method === "all")).toHaveLength(1);

    await db.insert(users).values({ id: 2, name: "User 2" });
    const afterMutation = await db
      .select()
      .from(users)
      .$withCache({ autoInvalidate: false, config: { ex: 60 } });

    expect(afterMutation).toEqual(first);
    expect(calls.map((call) => call.method)).toEqual(["all", "execute"]);
  });

  it("supports Drizzle global cache strategy and per-query opt out", async () => {
    const { calls, db } = createRemoteDb({ global: true });

    const first = await db.select().from(users);
    const second = await db.select().from(users);
    const uncached = await db.select().from(users).$withCache(false);

    expect(second).toEqual(first);
    expect(uncached).toEqual([{ id: 2, name: "User 2" }]);
    expect(calls.filter((call) => call.method === "all")).toHaveLength(2);
  });
});
