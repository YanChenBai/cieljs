import type { MemoryManager } from "../memory-manager.ts";
import type { SpaceMemory } from "../memory-space.ts";
import type { MemorySource } from "../types.ts";

export interface MemorySourceProviderContext {
  toolCallId: string;
  signal?: AbortSignal;
}

export type MemorySourceProvider = (
  context: MemorySourceProviderContext,
) => MemorySource[] | Promise<MemorySource[]>;

export interface MemoryToolLimits {
  searchLimit?: number;
  maxReadChars?: number;
}

export interface CreateMemoryToolsOptions extends MemoryToolLimits {
  /** 当前空间；工具可以读取两层记忆，写入仍由 layer 明确选择。 */
  space: SpaceMemory;
  /** 为工具产生的记忆附加来源；函数会在每次写入时重新调用。 */
  sources?: MemorySource[] | MemorySourceProvider;
}

export interface CreateAllMemoryToolsOptions extends MemoryToolLimits {
  manager: MemoryManager;
}
