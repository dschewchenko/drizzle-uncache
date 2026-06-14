import { is, Table } from "drizzle-orm";
import type { MutationOption } from "drizzle-orm/cache/core";
import type { CacheConfig } from "drizzle-orm/cache/core/types";

const ORIGINAL_NAME = Symbol.for("drizzle:OriginalName");

export function pickConfigWithTtl(config?: CacheConfig): CacheConfig | undefined {
  if (!config) return undefined;
  if (
    config.ex !== undefined ||
    config.px !== undefined ||
    config.exat !== undefined ||
    config.pxat !== undefined
  ) {
    return config;
  }
  return undefined;
}

export function normalizeTables(tables: MutationOption["tables"]): string[] {
  if (!tables) return [];
  const list = Array.isArray(tables) ? tables : [tables];
  return list.map((table) =>
    is(table, Table) ? String(Reflect.get(table, ORIGINAL_NAME)) : String(table),
  );
}

export function normalizeTags(tags: MutationOption["tags"]): string[] {
  if (!tags) return [];
  const list = Array.isArray(tags) ? tags : [tags];
  return list.map((tag) => `${tag}`);
}

export function encode(value: string): string {
  return encodeURIComponent(value);
}

export function makeTablesKey(tables: string[]): string {
  if (!tables.length) return "";
  return tables
    .map((table) => encode(table))
    .sort()
    .join(",");
}

export function decodeTablesKey(tablesKey: string | undefined): string[] {
  if (!tablesKey) return [];
  return tablesKey.split(",").filter(Boolean).map(decodeURIComponent);
}

export function parseIndexKey(key: string):
  | {
      tableEnc: string;
      tablesKey: string;
      isTag: boolean;
      keyEnc: string;
    }
  | undefined {
  const parts = key.split(":");
  if (parts.length !== 5) return undefined;
  if (parts[0] !== "__CTS__") return undefined;
  const [tableEnc, tablesKey, kind, keyEnc] = parts.slice(1);
  if (!tableEnc || !tablesKey || !keyEnc) return undefined;
  if (kind !== "q" && kind !== "t") return undefined;
  return { tableEnc, tablesKey, isTag: kind === "t", keyEnc };
}
