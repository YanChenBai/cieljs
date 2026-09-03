import { getMemoryScopes } from "../context.ts";
import type { MemoryStore } from "../store.ts";
import type { MemoryScope, MemorySource } from "../types.ts";
import { integerOption } from "../validation.ts";
import type { CreateMemoryToolsOptions } from "./types.ts";

export const memoryToolsDefaults = {
  searchLimit: 8,
  maxReadChars: 12000,
} as const;

export interface ResolvedMemoryToolsOptions {
  store: MemoryStore;
  scope: MemoryScope;
  includeGlobal: boolean;
  allowWrite: boolean;
  searchLimit: number;
  maxReadChars: number;
  sources: MemorySource[];
  scopes: MemoryScope[];
}

/**
 * 归一化 Memory Tools 配置，为所有工具提供一致的默认值与范围快照。
 */
export function resolveMemoryToolsOptions(
  options: CreateMemoryToolsOptions,
): ResolvedMemoryToolsOptions {
  const scope = { ...options.scope };
  const includeGlobal = options.includeGlobal ?? true;

  return {
    store: options.store,
    scope,
    includeGlobal,
    allowWrite: options.allowWrite ?? false,
    searchLimit: integerOption(
      options.searchLimit ?? memoryToolsDefaults.searchLimit,
      "searchLimit",
      1,
      20,
    ),
    maxReadChars: integerOption(
      options.maxReadChars ?? memoryToolsDefaults.maxReadChars,
      "maxReadChars",
      1,
      100000,
    ),
    sources: structuredClone(options.sources ?? []),
    scopes: getMemoryScopes(scope, includeGlobal),
  };
}
