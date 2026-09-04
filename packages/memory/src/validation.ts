import { and, eq, or, sql } from "drizzle-orm";
import { memories } from "./schema.ts";
import type {
  MemoryAccess,
  MemoryFilter,
  MemoryKind,
  MemoryLayer,
  MemoryScope,
  MemoryScopeSelector,
  MemorySource,
} from "./types.ts";

export function scopeColumns(scope: MemoryScope) {
  if (scope?.type === "global") return { spaceId: null };

  if (scope?.type === "space") {
    if (!scope.spaceId?.trim()) {
      throw new TypeError("记忆范围必须为 global 或包含 spaceId 的 space");
    }

    return { spaceId: scope.spaceId };
  }

  throw new TypeError("记忆范围必须为 global 或包含 spaceId 的 space");
}

export function scopeCondition(scope: MemoryScope) {
  scopeColumns(scope);

  return scope.type === "global"
    ? eq(memories.layer, "global.long_term")
    : eq(memories.spaceId, scope.spaceId);
}

export function accessCondition(options: MemoryAccess & { scopes: MemoryScopeSelector }) {
  const scopes = options.scopes;
  let scopeAccessCondition;

  if (scopes !== "all") {
    if (!Array.isArray(scopes)) {
      throw new TypeError("无效的记忆读取范围");
    }

    scopeAccessCondition = scopes.length > 0 ? or(...scopes.map(scopeCondition))! : sql`false`;
  }

  let statusCondition;

  if (!options.includeArchived) statusCondition = eq(memories.status, "active");

  let expirationCondition;

  if (!options.includeExpired) {
    expirationCondition = sql`(${memories.expiresAt} IS NULL OR ${memories.expiresAt} > now())`;
  }

  return and(scopeAccessCondition, statusCondition, expirationCondition)!;
}

export function filterCondition(options: MemoryFilter & { scopes: MemoryScopeSelector }) {
  if (options.layer !== undefined && !isMemoryLayer(options.layer)) {
    throw new TypeError("无效的记忆层级");
  }

  if (options.kind !== undefined) {
    assertKind(options.kind);
  }

  if (options.dateFrom !== undefined) {
    assertDate(options.dateFrom);
  }

  if (options.dateTo !== undefined) {
    assertDate(options.dateTo);
  }

  const hasInvalidDateRange =
    options.dateFrom !== undefined &&
    options.dateTo !== undefined &&
    options.dateFrom > options.dateTo;

  if (hasInvalidDateRange) {
    throw new TypeError("日期范围起点不能晚于终点");
  }

  let layerCondition;

  if (options.layer) {
    layerCondition = eq(memories.layer, options.layer);
  }

  let kindCondition;

  if (options.kind) {
    kindCondition = eq(memories.kind, options.kind);
  }

  let dateFromCondition;

  if (options.dateFrom) {
    dateFromCondition = sql`${memories.date} >= ${options.dateFrom}::date`;
  }

  let dateToCondition;

  if (options.dateTo) {
    dateToCondition = sql`${memories.date} <= ${options.dateTo}::date`;
  }

  return and(
    accessCondition(options),
    layerCondition,
    kindCondition,
    dateFromCondition,
    dateToCondition,
  )!;
}

export function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError("日期必须为 YYYY-MM-DD");

  const parsed = new Date(`${value}T00:00:00Z`);
  const isValidDate = Number.isFinite(parsed.getTime());
  const matchesCalendarDate = isValidDate && parsed.toISOString().slice(0, 10) === value;

  if (!matchesCalendarDate) {
    throw new TypeError("无效的日历日期");
  }
}

export function assertTimestamp(value: Date): void {
  const isValidTimestamp = value instanceof Date && Number.isFinite(value.getTime());

  if (!isValidTimestamp) {
    throw new TypeError("时间必须为有效的 Date");
  }
}

export function assertContent(value: string): void {
  const hasContent = typeof value === "string" && Boolean(value.trim());

  if (!hasContent) {
    throw new TypeError("记忆正文不能为空");
  }
}

export function assertKind(value: MemoryKind): void {
  if (!["event", "fact", "preference", "summary"].includes(value)) {
    throw new TypeError("无效的记忆种类");
  }
}

export function integerOption(value: number, name: string, min = 1, max = 1000): number {
  const isIntegerInRange = Number.isSafeInteger(value) && value >= min && value <= max;

  if (!isIntegerInRange) {
    throw new TypeError(`${name} 必须为 ${min} 到 ${max} 的整数`);
  }

  return value;
}

export function assertSources(sources: MemorySource[]): void {
  for (const source of sources) {
    switch (source.type) {
      case "session":
        assertSessionSource(source);
        break;
      case "event":
        if (!source.eventId?.trim()) {
          throw new TypeError("无效的记忆来源");
        }
        break;
      case "memory":
        if (!source.memoryId?.trim()) {
          throw new TypeError("无效的记忆来源");
        }
        break;
      default: {
        throw new TypeError("无效的记忆来源");
      }
    }
  }
}

function assertSessionSource(source: Extract<MemorySource, { type: "session" }>): void {
  if (!source.sessionId?.trim()) {
    throw new TypeError("无效的记忆来源");
  }

  if (source.messageId !== undefined && !source.messageId.trim()) {
    throw new TypeError("messageId 不能为空");
  }

  if (source.fromSeq !== undefined) {
    integerOption(source.fromSeq, "fromSeq", 1, Number.MAX_SAFE_INTEGER);
  }

  if (source.toSeq !== undefined) {
    integerOption(source.toSeq, "toSeq", 1, Number.MAX_SAFE_INTEGER);
  }

  const hasIncompleteRange = source.toSeq !== undefined && source.fromSeq === undefined;
  const hasReversedRange =
    source.toSeq !== undefined && source.fromSeq !== undefined && source.toSeq < source.fromSeq;

  if (hasIncompleteRange || hasReversedRange) {
    throw new TypeError("来源消息区间无效");
  }
}

export function isMemoryLayer(value: unknown): value is MemoryLayer {
  return value === "global.long_term" || value === "space.long_term" || value === "space.daily";
}
