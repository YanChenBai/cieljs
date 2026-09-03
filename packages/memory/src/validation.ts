import { and, eq, or, sql } from "drizzle-orm";
import { memories } from "./schema.ts";
import type {
  EmbeddingProvider,
  MemoryAccess,
  MemoryFilter,
  MemoryKind,
  MemoryScope,
  MemorySource,
} from "./types.ts";

export function scopeColumns(scope: MemoryScope) {
  if (scope?.type === "global") return { scopeType: "global" as const, scopeId: "" };
  if (scope?.type !== "space" || !scope.spaceId?.trim()) {
    throw new TypeError("记忆范围必须为 global 或包含 spaceId 的 space");
  }
  return { scopeType: "space" as const, scopeId: scope.spaceId };
}

export function scopeCondition(scope: MemoryScope) {
  const { scopeType, scopeId } = scopeColumns(scope);
  return and(eq(memories.scopeType, scopeType), eq(memories.scopeId, scopeId))!;
}

export function accessCondition(options: MemoryAccess) {
  if (!Array.isArray(options.scopes)) throw new TypeError("必须明确指定 scopes");
  return and(
    options.scopes.length ? or(...options.scopes.map(scopeCondition)) : sql`false`,
    options.includeArchived ? undefined : eq(memories.status, "active"),
    options.includeExpired
      ? undefined
      : sql`(${memories.expiresAt} IS NULL OR ${memories.expiresAt} > now())`,
  )!;
}

export function filterCondition(options: MemoryFilter) {
  if (options.layer !== undefined && !["daily", "long_term"].includes(options.layer)) {
    throw new TypeError("无效的记忆层级");
  }
  if (options.kind !== undefined) assertKind(options.kind);
  if (options.dateFrom !== undefined) assertDate(options.dateFrom);
  if (options.dateTo !== undefined) assertDate(options.dateTo);
  if (options.dateFrom && options.dateTo && options.dateFrom > options.dateTo) {
    throw new TypeError("日期范围起点不能晚于终点");
  }
  return and(
    accessCondition(options),
    options.layer ? eq(memories.layer, options.layer) : undefined,
    options.kind ? eq(memories.kind, options.kind) : undefined,
    options.dateFrom ? sql`${memories.date} >= ${options.dateFrom}::date` : undefined,
    options.dateTo ? sql`${memories.date} <= ${options.dateTo}::date` : undefined,
  )!;
}

export function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("日期必须为 YYYY-MM-DD");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError("无效的日历日期");
  }
}

export function assertTimestamp(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("时间必须为有效的 Date");
  }
}

export function assertContent(value: string): void {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("记忆正文不能为空");
}

export function assertKind(value: MemoryKind): void {
  if (!["event", "fact", "preference", "summary"].includes(value))
    throw new TypeError("无效的记忆种类");
}

export function integerOption(value: number, name: string, min = 1, max = 1000): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} 必须为 ${min} 到 ${max} 的整数`);
  }
  return value;
}

export function assertSources(sources: MemorySource[]): void {
  for (const source of sources) {
    if (source.type === "session" && source.sessionId?.trim()) {
      if (source.messageId !== undefined && !source.messageId.trim())
        throw new TypeError("messageId 不能为空");
      if (source.fromSeq !== undefined)
        integerOption(source.fromSeq, "fromSeq", 1, Number.MAX_SAFE_INTEGER);
      if (source.toSeq !== undefined)
        integerOption(source.toSeq, "toSeq", 1, Number.MAX_SAFE_INTEGER);
      if (
        source.toSeq !== undefined &&
        (source.fromSeq === undefined || source.toSeq < source.fromSeq)
      ) {
        throw new TypeError("来源消息区间无效");
      }
      continue;
    }
    if (source.type === "event" && source.eventId?.trim()) continue;
    if (source.type === "memory" && source.memoryId?.trim()) continue;
    throw new TypeError("无效的记忆来源");
  }
}

export function assertProvider(provider: EmbeddingProvider): void {
  if (!provider.model.trim()) throw new TypeError("Embedding 模型标识不能为空");
  integerOption(provider.dimensions, "dimensions", 1, 16000);
  integerOption(provider.batchSize ?? 32, "batchSize");
}

export function assertVectors(vectors: number[][], count: number, dimensions: number): void {
  if (!Array.isArray(vectors) || vectors.length !== count)
    throw new TypeError("Embedding 返回数量与输入不一致");
  for (const vector of vectors) {
    if (
      !Array.isArray(vector) ||
      vector.length !== dimensions ||
      !vector.every(Number.isFinite) ||
      vector.every((value) => value === 0)
    ) {
      throw new TypeError("Embedding 必须是维数匹配的有限非零向量");
    }
  }
}
