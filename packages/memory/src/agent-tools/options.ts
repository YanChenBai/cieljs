import type { Memory } from "../memory.ts";
import type { MemoryManager } from "../memory-manager.ts";
import { getSpaceGlobalMemory, getSpaceMemoryBackend } from "../memory-space.ts";
import type { MemoryLayer, MemorySource } from "../types.ts";
import { integerOption } from "../validation.ts";
import type {
  CreateAllMemoryToolsOptions,
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
  space: CreateMemoryToolsOptions["space"];
  searchLimit: number;
  maxReadChars: number;
  resolveSources: (context: MemorySourceProviderContext) => Promise<MemorySource[]>;
}

export interface ResolvedAllMemoryToolsOptions {
  manager: MemoryManager;
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
    memory: getSpaceMemoryBackend(options.space),
    space: options.space,
    ...limits,
    resolveSources: async (context) => {
      context.signal?.throwIfAborted();
      const sources = sourceProvider ? await sourceProvider(context) : staticSources!;
      context.signal?.throwIfAborted();

      return structuredClone(sources);
    },
  };
}

export function resolveAllMemoryToolsOptions(
  options: CreateAllMemoryToolsOptions,
): ResolvedAllMemoryToolsOptions {
  return {
    manager: options.manager,
    ...resolveMemoryToolLimits(options),
  };
}

export function resolveWritableMemory(options: ResolvedMemoryToolsOptions, layer: MemoryLayer) {
  if (layer === "global.long_term") {
    return getSpaceGlobalMemory(options.space).longTerm;
  }

  return layer === "space.daily" ? options.space.daily : options.space.longTerm;
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
