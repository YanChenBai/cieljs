import type { Memory } from "../memory.ts";
import type { MemoryManager } from "../memory-manager.ts";
import type { MemoryScope } from "../types.ts";
import type { MemorySource } from "../types.ts";
import { integerOption, scopeColumns } from "../validation.ts";
import type {
  CreateCrossScopeMemoryToolsOptions,
  CreateMemoryToolsOptions,
  MemorySourceProviderContext,
  MemoryToolLimits,
} from "./types.ts";

export const memoryToolsDefaults = {
  searchLimit: 8,
  maxReadChars: 12000,
} as const;

export interface ResolvedMemoryToolsOptions {
  memory: Memory;
  allowWrite: boolean;
  searchLimit: number;
  maxReadChars: number;
  resolveSources: (context: MemorySourceProviderContext) => Promise<MemorySource[]>;
}

export interface ResolvedCrossScopeMemoryToolsOptions {
  manager: MemoryManager;
  scopes: MemoryScope[];
  searchLimit: number;
  maxReadChars: number;
}

/**
 * 归一化 Memory Tools 配置，为所有工具提供一致的默认值与范围快照。
 */
export function resolveMemoryToolsOptions(
  options: CreateMemoryToolsOptions,
): ResolvedMemoryToolsOptions {
  const limits = resolveMemoryToolLimits(options);
  const configuredSources = options.sources;
  const sourceProvider = typeof configuredSources === "function" ? configuredSources : undefined;
  const staticSources =
    typeof configuredSources === "function" ? undefined : structuredClone(configuredSources ?? []);

  return {
    memory: options.memory,
    allowWrite: options.allowWrite ?? false,
    ...limits,
    resolveSources: async (context) => {
      context.signal?.throwIfAborted();
      const sources = sourceProvider ? await sourceProvider(context) : staticSources!;
      context.signal?.throwIfAborted();

      return structuredClone(sources);
    },
  };
}

export function resolveCrossScopeMemoryToolsOptions(
  options: CreateCrossScopeMemoryToolsOptions,
): ResolvedCrossScopeMemoryToolsOptions {
  if (!Array.isArray(options.scopes)) {
    throw new TypeError("必须明确指定 scopes");
  }

  const scopes = structuredClone(options.scopes);

  for (const scope of scopes) {
    scopeColumns(scope);
    Object.freeze(scope);
  }

  Object.freeze(scopes);

  return {
    manager: options.manager,
    scopes,
    ...resolveMemoryToolLimits(options),
  };
}

function resolveMemoryToolLimits(options: MemoryToolLimits) {
  return {
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
  };
}
