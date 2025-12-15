import { entityKind } from "drizzle-orm";
import type { MutationOption } from "drizzle-orm/cache/core";
import { Cache } from "drizzle-orm/cache/core";
import type { CacheConfig } from "drizzle-orm/cache/core/types";
import type { Storage, StorageValue } from "unstorage";
import { createStorage, prefixStorage } from "unstorage";
import type { CacheEntry, UnstorageCacheOptions } from "./types";
import {
  decodeTablesKey,
  encode,
  makeTablesKey,
  normalizeTables,
  normalizeTags,
  parseIndexKey,
  pickConfigWithTtl,
} from "./utils";

const DEFAULT_TTL_MS = 1000;
const DEFAULT_BASE = "drizzle:cache"; // prefix for all keys
const VALUE_AUTO_PREFIX = "__CT__"; // auto invalidation keys prefix
const VALUE_NON_AUTO_PREFIX = "__NAI__"; // without auto invalidation keys prefix
const INDEX_PREFIX = "__CTS__"; // tables/tags index keys prefix
const TAG_MAP_PREFIX = "__tagsMap__"; // tags keys prefix

export class UnstorageCache extends Cache {
  static override readonly [entityKind]: string = "UnstorageCache";

  private readonly storage: Storage;
  private readonly useGlobally: boolean;
  private readonly defaultConfig: CacheConfig | undefined;
  private readonly debug: boolean;

  constructor(storage: Storage, options: Omit<UnstorageCacheOptions, "storage" | "driver"> = {}) {
    super();
    const base = options.base ?? DEFAULT_BASE;
    this.storage = prefixStorage(storage, base);
    this.useGlobally = options.global ?? false;
    this.defaultConfig = options.config;
    this.debug = options.debug === true;
  }

  override strategy(): "explicit" | "all" {
    return this.useGlobally ? "all" : "explicit";
  }

  override async get(
    key: string,
    tables: string[],
    isTag: boolean,
    isAutoInvalidate?: boolean,
  ): Promise<unknown[] | undefined> {
    const keyEnc = encode(key);

    if (isTag) {
      const mapValue = await this.storage.getItem<string>(this.tagMapKey(keyEnc));
      if (!mapValue) {
        this.log(`MISS tag ${key}`);
        return undefined;
      }

      const autoInvalidate = mapValue !== "NAI";
      const tablesKey = autoInvalidate ? mapValue : undefined;
      const valueKey = this.valueKey(autoInvalidate, true, keyEnc, tablesKey);
      const entry = await this.storage.getItem<CacheEntry>(valueKey);

      if (!entry) {
        this.log(`MISS tag ${key}`);
        return undefined;
      }

      if (this.isExpired(entry)) {
        const fallbackTables = tablesKey ? decodeTablesKey(tablesKey) : [];
        await this.dropEntry({
          autoInvalidate,
          isTag,
          keyEnc,
          tablesKey: tablesKey ?? undefined,
          entry,
          fallbackTables,
          removeTagMap: true,
        });
        this.log(`EXPIRED tag ${key}`);
        return undefined;
      }

      this.log(`HIT tag ${key}`);
      return entry.value as unknown[] | undefined;
    }

    const autoInvalidate = isAutoInvalidate ?? tables.length > 0;
    const tablesKey = autoInvalidate ? makeTablesKey(tables) : undefined;
    const valueKey = this.valueKey(autoInvalidate, false, keyEnc, tablesKey);

    const entry = await this.storage.getItem<CacheEntry>(valueKey);
    if (!entry) {
      this.log(`MISS query ${key}`);
      return undefined;
    }

    if (this.isExpired(entry)) {
      await this.dropEntry({
        autoInvalidate,
        isTag: false,
        keyEnc,
        tablesKey: tablesKey ?? undefined,
        entry,
        fallbackTables: tables,
      });
      this.log(`EXPIRED query ${key}`);
      return undefined;
    }

    this.log(`HIT query ${key}`);
    return entry.value as unknown[] | undefined;
  }

  override async put(
    key: string,
    response: unknown,
    tables: string[],
    isTag: boolean,
    config?: CacheConfig,
  ): Promise<void> {
    const autoInvalidate = tables.length > 0;
    const keyEnc = encode(key);
    const tablesKey = autoInvalidate ? makeTablesKey(tables) : undefined;
    const valueKey = this.valueKey(autoInvalidate, isTag, keyEnc, tablesKey);

    const now = Date.now();
    const keepTtl = config?.keepTtl === true;
    const existing = keepTtl ? await this.storage.getItem<CacheEntry>(valueKey) : undefined;
    const expiresAt = this.toExpiresAt(now, config, existing?.expiresAt);

    if (expiresAt !== undefined && expiresAt <= now) {
      await this.dropEntry({
        autoInvalidate,
        isTag,
        keyEnc,
        tablesKey: tablesKey ?? undefined,
        fallbackTables: tables,
      });
      return;
    }

    const ttlSeconds =
      expiresAt !== undefined ? Math.max(1, Math.ceil((expiresAt - now) / 1000)) : undefined;

    const entry: CacheEntry = {
      value: response,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(autoInvalidate ? { tables } : {}),
    };

    const writes: { key: string; value: StorageValue }[] = [{ key: valueKey, value: entry }];

    if (autoInvalidate && tablesKey) {
      const indexKeys = tables.map((table) => this.indexKey(table, tablesKey, isTag, keyEnc));
      for (const indexKey of indexKeys) {
        writes.push({ key: indexKey, value: expiresAt ?? 1 });
      }
      if (isTag) {
        writes.push({ key: this.tagMapKey(keyEnc), value: tablesKey });
      }
    } else if (isTag) {
      writes.push({ key: this.tagMapKey(keyEnc), value: "NAI" });
    }

    await this.setMany(writes, ttlSeconds);
    this.log(`PUT ${isTag ? "tag" : "query"} ${key} ttlSeconds=${ttlSeconds ?? "none"}`);
  }

  override async onMutate(params: MutationOption): Promise<void> {
    const tags = normalizeTags(params.tags);
    const tables = Array.from(new Set(normalizeTables(params.tables)));

    await Promise.all([this.invalidateTags(tags), this.invalidateTables(tables)]);
  }

  private async invalidateTag(tag: string): Promise<void> {
    const keyEnc = encode(tag);
    const mapValue = await this.storage.getItem<string>(this.tagMapKey(keyEnc));

    if (!mapValue || mapValue === "NAI") {
      await Promise.all([
        this.storage.removeItem(this.valueKey(false, true, keyEnc)),
        this.storage.removeItem(this.tagMapKey(keyEnc)),
      ]);
      this.log(`INVALIDATE TAG ${tag} removedIndex=0`);
      return;
    }

    const tablesKey = mapValue;
    const tables = decodeTablesKey(tablesKey);
    const valueKey = this.valueKey(true, true, keyEnc, tablesKey);

    await this.storage.removeItem(valueKey);
    await Promise.all(
      tables.map((table) => this.storage.removeItem(this.indexKey(table, tablesKey, true, keyEnc))),
    );
    await this.storage.removeItem(this.tagMapKey(keyEnc));

    this.log(`INVALIDATE TAG ${tag} removedIndex=${tables.length}`);
  }

  private async invalidateTags(tags: string[]): Promise<void> {
    if (!tags.length) return;
    await Promise.all(tags.map((tag) => this.invalidateTag(tag)));
  }

  private async invalidateTables(tables: string[]): Promise<void> {
    if (!tables.length) return;

    const indexKeys = new Set<string>();
    for (const table of tables) {
      const tableEnc = encode(table);
      const prefix = `${INDEX_PREFIX}:${tableEnc}:`;
      const keys = await this.storage.getKeys(prefix);
      keys.forEach((k) => {
        indexKeys.add(k);
      });
    }

    if (!indexKeys.size) {
      this.log(`INVALIDATE TABLES ${tables.join(",")} removed=0`);
      return;
    }

    const valueKeys = new Set<string>();
    for (const indexKey of indexKeys) {
      const parsed = parseIndexKey(indexKey);
      if (!parsed) continue;
      valueKeys.add(this.valueKey(true, parsed.isTag, parsed.keyEnc, parsed.tablesKey));
    }

    await Promise.all([
      ...Array.from(indexKeys).map((k) => this.storage.removeItem(k)),
      ...Array.from(valueKeys).map((k) => this.storage.removeItem(k)),
    ]);

    this.log(`INVALIDATE TABLES ${tables.join(",")} removed=${valueKeys.size}`);
  }

  private async dropEntry(params: {
    autoInvalidate: boolean;
    isTag: boolean;
    keyEnc: string;
    tablesKey?: string | undefined;
    entry?: CacheEntry | null | undefined;
    fallbackTables?: string[];
    removeTagMap?: boolean;
  }): Promise<void> {
    const { autoInvalidate, isTag, keyEnc, tablesKey, entry, fallbackTables, removeTagMap } =
      params;
    const tables = entry?.tables ?? fallbackTables ?? (tablesKey ? decodeTablesKey(tablesKey) : []);
    const resolvedTablesKey = autoInvalidate ? (tablesKey ?? makeTablesKey(tables)) : undefined;

    await this.storage.removeItem(this.valueKey(autoInvalidate, isTag, keyEnc, resolvedTablesKey));
    if (isTag && removeTagMap) {
      await this.storage.removeItem(this.tagMapKey(keyEnc));
    }
    if (!autoInvalidate || !tables.length || !resolvedTablesKey) return;

    await Promise.all(
      tables.map((table) =>
        this.storage.removeItem(this.indexKey(table, resolvedTablesKey, isTag, keyEnc)),
      ),
    );
  }

  private valueKey(
    autoInvalidate: boolean,
    isTag: boolean,
    keyEnc: string,
    tablesKey?: string,
  ): string {
    const kind = isTag ? "t" : "q";
    if (!autoInvalidate) {
      return `${VALUE_NON_AUTO_PREFIX}:${kind}:${keyEnc}`;
    }
    return `${VALUE_AUTO_PREFIX}:${tablesKey ?? ""}:${kind}:${keyEnc}`;
  }

  private indexKey(table: string, tablesKey: string, isTag: boolean, keyEnc: string): string {
    return `${INDEX_PREFIX}:${encode(table)}:${tablesKey}:${isTag ? "t" : "q"}:${keyEnc}`;
  }

  private isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }

  private ttlOptions(ttlSeconds: number | undefined): Record<string, number> | undefined {
    if (!ttlSeconds) {
      return undefined;
    }
    return { ttl: ttlSeconds };
  }

  private toExpiresAt(
    now: number,
    config?: CacheConfig,
    existingExpiresAt?: number,
  ): number | undefined {
    if (config?.keepTtl && existingExpiresAt && existingExpiresAt > now) {
      return existingExpiresAt;
    }

    const source = pickConfigWithTtl(config) ?? pickConfigWithTtl(this.defaultConfig);
    if (!source) {
      return now + DEFAULT_TTL_MS;
    }

    if (source.px !== undefined) return now + source.px;
    if (source.ex !== undefined) return now + source.ex * 1000;
    if (source.pxat !== undefined) return source.pxat;
    if (source.exat !== undefined) return source.exat * 1000;

    return now + DEFAULT_TTL_MS;
  }

  private log(message: string): void {
    if (!this.debug) return;
    console.log(`[uncache] ${message}`);
  }

  private tagMapKey(tagEnc: string): string {
    return `${TAG_MAP_PREFIX}:${tagEnc}`;
  }

  private async setMany(
    items: { key: string; value: StorageValue }[],
    ttlSeconds?: number,
  ): Promise<void> {
    const ttlOptions = this.ttlOptions(ttlSeconds);

    // if driver supports batch method, use it
    if (this.storage.setItems) {
      await this.storage.setItems(
        items.map((item) => ({ key: item.key, value: item.value })),
        ttlOptions ?? {},
      );
      return;
    }

    await Promise.all(items.map((item) => this.storage.setItem(item.key, item.value, ttlOptions)));
  }
}

export function unstorageCache(options: UnstorageCacheOptions = {}): UnstorageCache {
  const storage =
    options.storage ??
    (options.driver ? createStorage({ driver: options.driver }) : createStorage());
  return new UnstorageCache(storage, options);
}
