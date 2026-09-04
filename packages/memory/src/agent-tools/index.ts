import type { AgentTool } from "@earendil-works/pi-agent-core";

import { searchMemoryTool } from "./search-memory.ts";
import { readMemoryTool } from "./read-memory.ts";
import { forgetMemoryTool } from "./forget-memory.ts";
import { rememberMemoryTool } from "./remember-memory.ts";
import { updateMemoryTool } from "./update-memory.ts";
import { readAllMemoryTool } from "./read-all-memory.ts";
import { searchAllMemoryTool } from "./search-all-memory.ts";
import type { CreateAllMemoryToolsOptions, CreateMemoryToolsOptions } from "./types.ts";

export { searchMemoryTool } from "./search-memory.ts";
export { readMemoryTool } from "./read-memory.ts";
export { forgetMemoryTool } from "./forget-memory.ts";
export { rememberMemoryTool } from "./remember-memory.ts";
export { updateMemoryTool } from "./update-memory.ts";
export { readAllMemoryTool } from "./read-all-memory.ts";
export { searchAllMemoryTool } from "./search-all-memory.ts";
export type {
  CreateAllMemoryToolsOptions,
  CreateMemoryToolsOptions,
  MemoryToolLimits,
  MemorySourceProvider,
  MemorySourceProviderContext,
} from "./types.ts";

/**
 * 创建 Memory 相关 Agent Tools。
 *
 * 默认提供：
 *
 * - search_memory
 * - read_memory
 * - remember_memory
 * - update_memory
 * - forget_memory
 */
export function memoryTools(options: CreateMemoryToolsOptions): AgentTool[] {
  return [
    searchMemoryTool(options),
    readMemoryTool(options),
    rememberMemoryTool(options),
    updateMemoryTool(options),
    forgetMemoryTool(options),
  ];
}

/** 创建直接读取全库的 Agent Tools。 */
export function allMemoryTools(options: CreateAllMemoryToolsOptions): AgentTool[] {
  return [searchAllMemoryTool(options), readAllMemoryTool(options)];
}
