import type { CacheConfig } from "drizzle-orm/cache/core/types";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { describe, expect, it, vi } from "vitest";
import { UnstorageCache, unstorageCache } from "../src/unstorage-cache";

describe("unstorage cache adapter", () => {
  it("selects strategy based on global option", () => {
    const storage = createStorage();
    expect(unstorageCache({ storage }).strategy()).toBe("explicit");
    expect(unstorageCache({ storage, global: true }).strategy()).toBe("all");
  });

  it("stores and reads query values", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    await cache.put("hash", [{ ok: 1 }], ["users"], false, { ex: 60 });
    await expect(cache.get("hash", ["users"], false, true)).resolves.toEqual([{ ok: 1 }]);
  });

  it("stores and reads tag values", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    await cache.put("custom_key", [{ ok: 1 }], ["users"], true, { ex: 60 });
    await expect(cache.get("custom_key", ["users"], true, true)).resolves.toEqual([{ ok: 1 }]);
  });

  it("invalidates by table name", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    await cache.put("k1", [{ n: 1 }], ["users"], false, { ex: 60 });
    await cache.put("k2", [{ n: 2 }], ["posts"], false, { ex: 60 });

    await cache.onMutate({ tables: "users" });
    await expect(cache.get("k1", ["users"], false, true)).resolves.toBeUndefined();
    await expect(cache.get("k2", ["posts"], false, true)).resolves.toEqual([{ n: 2 }]);
  });

  it("invalidates by Table object", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    const users = pgTable("users", {
      id: serial("id").primaryKey(),
      name: text("name"),
    });

    await cache.put("k1", [{ n: 1 }], ["users"], false, { ex: 60 });
    await cache.onMutate({ tables: users });
    await expect(cache.get("k1", ["users"], false, true)).resolves.toBeUndefined();
  });

  it("invalidates multi-table queries when any related table mutates", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    await cache.put("k1", [{ n: 1 }], ["users", "posts"], false, { ex: 60 });
    await cache.put("k2", [{ n: 2 }], ["posts"], false, { ex: 60 });

    await cache.onMutate({ tables: ["users"] });

    await expect(cache.get("k1", ["users", "posts"], false, true)).resolves.toBeUndefined();
    await expect(cache.get("k2", ["posts"], false, true)).resolves.toEqual([{ n: 2 }]);
  });

  it("invalidates tags and cleans related index entries", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    await cache.put("tagged", [{ ok: 1 }], ["users"], true, { ex: 60 });
    await cache.onMutate({ tags: "tagged" });

    await expect(cache.get("tagged", ["users"], true, true)).resolves.toBeUndefined();
    const keys = await storage.getKeys();
    expect(keys.some((key) => key.includes("tagged"))).toBe(false);
  });

  it("invalidates non-auto tags", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    await cache.put("tagged", [{ ok: 1 }], [], true, { ex: 60 });
    await cache.onMutate({ tags: "tagged" });

    await expect(cache.get("tagged", [], true, false)).resolves.toBeUndefined();
    const keys = await storage.getKeys();
    expect(keys.some((key) => key.includes("tagged"))).toBe(false);
  });

  it("uses sorted tablesKey so table order does not matter", async () => {
    const storage = createStorage();
    const cache = unstorageCache({ storage, config: { ex: 60 } });

    await cache.put("k1", [{ n: 1 }], ["posts", "users"], false, { ex: 60 });
    await expect(cache.get("k1", ["users", "posts"], false, true)).resolves.toEqual([{ n: 1 }]);
  });

  it("reuses existing TTL when keepTtl is true", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

      const storage = createStorage();
      const cache = new UnstorageCache(storage, { config: { px: 50 } });

      await cache.put("k1", [{ v: 1 }], ["users"], false, { px: 50 });
      await cache.put("k1", [{ v: 2 }], ["users"], false, { px: 10, keepTtl: true });

      vi.advanceTimersByTime(20);
      await expect(cache.get("k1", ["users"], false, true)).resolves.toEqual([{ v: 2 }]);

      vi.advanceTimersByTime(80);
      await expect(cache.get("k1", ["users"], false, true)).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses default config when a call omits TTL fields", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

      const storage = createStorage();
      const cache = unstorageCache({ storage, config: { ex: 60 } });

      await cache.put("k1", [{ v: 1 }], ["users"], false, {});

      vi.advanceTimersByTime(1500);
      await expect(cache.get("k1", ["users"], false, true)).resolves.toEqual([{ v: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires entries even when the driver lacks TTL support", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));

      const storage = createStorage({ driver: memoryDriver() });
      const cache = unstorageCache({ storage, config: { ex: 1 } });

      await cache.put("k1", [{ v: 1 }], ["users"], false, { ex: 1 });
      await expect(cache.get("k1", ["users"], false, true)).resolves.toEqual([{ v: 1 }]);

      vi.advanceTimersByTime(1500);
      await expect(cache.get("k1", ["users"], false, true)).resolves.toBeUndefined();
      await expect(storage.getKeys()).resolves.toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      name: "ex",
      makeConfig: (): CacheConfig => ({ ex: 1 }),
      advanceMs: 1001,
    },
    {
      name: "px",
      makeConfig: (): CacheConfig => ({ px: 10 }),
      advanceMs: 11,
    },
    {
      name: "exat",
      makeConfig: (nowMs: number): CacheConfig => ({ exat: Math.floor(nowMs / 1000) + 1 }),
      advanceMs: 1001,
    },
    {
      name: "pxat",
      makeConfig: (nowMs: number): CacheConfig => ({ pxat: nowMs + 10 }),
      advanceMs: 11,
    },
  ])("supports TTL config shape: $name", async ({ makeConfig, advanceMs }) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
      const nowMs = Date.now();

      const storage = createStorage();
      const cache = unstorageCache({ storage });

      await cache.put("k1", [{ v: 1 }], ["users"], false, makeConfig(nowMs));
      await expect(cache.get("k1", ["users"], false, true)).resolves.toEqual([{ v: 1 }]);

      vi.advanceTimersByTime(advanceMs);
      await expect(cache.get("k1", ["users"], false, true)).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs concise hit/miss output when debug is true", async () => {
    const storage = createStorage();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cache = unstorageCache({ storage, debug: true, config: { ex: 60 } });

    await cache.get("k1", ["users"], false, true);
    await cache.put("k1", [{ v: 1 }], ["users"], false, { ex: 60 });
    await cache.get("k1", ["users"], false, true);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[uncache\] MISS/));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[uncache\] PUT/));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/\[uncache\] HIT/));
    consoleSpy.mockRestore();
  });
});
