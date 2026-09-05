import { MemoryValidationError } from "./errors.ts";
import { normalizeSearchText } from "./search.ts";
import type { JsonObject, MemoryKind, MemoryLayer, MemorySource } from "./types.ts";

export const MAX_MEMORY_SOURCES = 32;
export const MAX_MEMORY_SOURCE_LENGTH = 512;
export const MAX_MEMORY_SOURCES_BYTES = 32 * 1024;

export function assertContent(value: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new MemoryValidationError("记忆正文不能为空");
  }
}

export function assertDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new MemoryValidationError("日期必须为 YYYY-MM-DD");
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new MemoryValidationError("无效的日历日期");
  }
}

export function assertTimestamp(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MemoryValidationError("时间必须为有效的 Date");
  }
}

export function assertKind(value: MemoryKind): void {
  if (!["event", "fact", "preference", "summary"].includes(value)) {
    throw new MemoryValidationError("无效的记忆种类");
  }
}

export function assertLayers(layers: MemoryLayer[]): void {
  if (!layers.every(isMemoryLayer)) {
    throw new MemoryValidationError("无效的记忆层级");
  }
}

export function assertJsonObject(value: JsonObject): void {
  if (!isPlainObject(value)) {
    throw new MemoryValidationError("metadata 必须是可序列化的 JSON 对象");
  }

  assertJsonValue(value, new WeakSet());
}

export function normalizeSources(sources: MemorySource[]): MemorySource[] {
  if (!Array.isArray(sources)) {
    throw new MemoryValidationError("sources 必须是字符串数组");
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (typeof source !== "string") {
      throw new MemoryValidationError("source 必须是字符串");
    }

    const value = source.normalize("NFKC").trim();

    if (!value) {
      continue;
    }

    if (Array.from(value).length > MAX_MEMORY_SOURCE_LENGTH) {
      throw new MemoryValidationError(`单个 source 不能超过 ${MAX_MEMORY_SOURCE_LENGTH} 个字符`);
    }

    const key = normalizeSearchText(value);

    if (!seen.has(key)) {
      seen.add(key);
      normalized.push(value);
    }
  }

  if (normalized.length > MAX_MEMORY_SOURCES) {
    throw new MemoryValidationError(`sources 不能超过 ${MAX_MEMORY_SOURCES} 项`);
  }

  if (new TextEncoder().encode(normalized.join("\n")).length > MAX_MEMORY_SOURCES_BYTES) {
    throw new MemoryValidationError(`sources 总大小不能超过 ${MAX_MEMORY_SOURCES_BYTES} 字节`);
  }

  return normalized;
}

export function integerOption(value: number, name: string, min = 1, max = 1000): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new MemoryValidationError(`${name} 必须为 ${min} 到 ${max} 的整数`);
  }

  return value;
}

export function isMemoryLayer(value: unknown): value is MemoryLayer {
  return value === "global.long_term" || value === "space.long_term" || value === "space.daily";
}

function assertJsonValue(value: unknown, visited: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }

  if (typeof value !== "object") {
    throw new MemoryValidationError("metadata 包含不可序列化的值");
  }

  if (visited.has(value)) {
    throw new MemoryValidationError("metadata 不能包含循环引用");
  }

  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonValue(item, visited);
    }
  } else if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      assertJsonValue(item, visited);
    }
  } else {
    throw new MemoryValidationError("metadata 只能包含普通 JSON 对象和数组");
  }

  visited.delete(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}
