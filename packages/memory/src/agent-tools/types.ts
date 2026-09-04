import type { Memory } from "../memory.ts";
import type { MemoryManager } from "../memory-manager.ts";
import type { MemoryScope, MemorySource } from "../types.ts";

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
  /** 已由 MemoryManager.memory() 固定读写范围的记忆入口。 */
  memory: Memory;
  allowWrite?: boolean;
  /** 为工具产生的记忆附加来源；函数会在每次写入时重新调用。 */
  sources?: MemorySource[] | MemorySourceProvider;
}

export interface CreateCrossScopeMemoryToolsOptions extends MemoryToolLimits {
  manager: MemoryManager;
  /** Agent 允许跨范围读取的 scope；创建工具时生成快照。 */
  scopes: MemoryScope[];
}
