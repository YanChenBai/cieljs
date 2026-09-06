import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { serialize, deserialize } from "node:v8";

/** 二进制快照保留图片、循环对象和原始类型，不执行 getter。 */
export class TraceStore {
  private readonly db: DatabaseSync;

  constructor(directory?: string) {
    if (directory) mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(directory ? join(directory, "trace.sqlite") : ":memory:");
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, category TEXT NOT NULL, sequence INTEGER NOT NULL, run_id TEXT, value BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS records_order ON records(category, sequence);
      CREATE INDEX IF NOT EXISTS records_run ON records(run_id, category, sequence);
    `);
  }

  get sequence() {
    return Number(this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS n FROM records").get()!.n);
  }

  put(id: string, category: string, sequence: number, value: unknown, runId?: string) {
    this.db
      .prepare("INSERT OR REPLACE INTO records VALUES (?, ?, ?, ?, ?)")
      .run(id, category, sequence, runId ?? null, serialize(snapshot(value)));
  }

  get<T>(id: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM records WHERE id = ?").get(id);
    return row ? (deserialize(row.value as Uint8Array) as T) : undefined;
  }

  list<T>(
    category: string,
    options: {
      after?: number;
      before?: number;
      limit?: number;
      runId?: string;
      ascending?: boolean;
    } = {},
  ): T[] {
    const rows = this.db
      .prepare(
        `SELECT value FROM records WHERE category = ? AND sequence > ? AND sequence < ? AND (? IS NULL OR run_id = ?) ORDER BY sequence ${options.ascending ? "ASC" : "DESC"} LIMIT ?`,
      )
      .all(
        category,
        options.after ?? 0,
        options.before ?? Number.MAX_SAFE_INTEGER,
        options.runId ?? null,
        options.runId ?? null,
        options.limit ?? 100,
      );
    return (options.ascending ? rows : rows.reverse()).map(
      (row) => deserialize(row.value as Uint8Array) as T,
    );
  }

  close() {
    this.db.close();
  }
}

function snapshot(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (!value || typeof value !== "object")
    return typeof value === "function" ? "[Function]" : value;
  if (seen.has(value)) return seen.get(value);
  if (
    value instanceof Date ||
    value instanceof Error ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  )
    return value;
  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    for (const [key, item] of value) result.set(snapshot(key, seen), snapshot(item, seen));
    return result;
  }
  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);
    for (const item of value) result.add(snapshot(item, seen));
    return result;
  }
  const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (key === "length" && Array.isArray(result)) continue;
    Object.defineProperty(result, key, {
      value: "value" in descriptor ? snapshot(descriptor.value, seen) : "[Getter / Setter]",
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
