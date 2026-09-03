import type { AgentTool } from "@earendil-works/pi-agent-core";

import { searchMemoryTool } from "./search-memory.ts";
import { readMemoryTool } from "./read-memory.ts";
import { rememberMemoryTool } from "./remember-memory.ts";
import { resolveMemoryToolsOptions } from "./options.ts";
import type { CreateMemoryToolsOptions } from "./types.ts";

export { searchMemoryTool } from "./search-memory.ts";
export { readMemoryTool } from "./read-memory.ts";
export { rememberMemoryTool } from "./remember-memory.ts";
export { resolveMemoryToolsOptions, memoryToolsDefaults } from "./options.ts";
export type { ResolvedMemoryToolsOptions } from "./options.ts";
export type { CreateMemoryToolsOptions } from "./types.ts";

/**
 * 创建 Memory 相关 Agent Tools。
 *
 * 默认提供：
 *
 * - search_memory
 * - read_memory
 *
 * 设置 allowWrite 后额外提供：
 *
 * - remember_memory
 */
export function memoryTools(options: CreateMemoryToolsOptions): AgentTool[] {
  const { allowWrite } = resolveMemoryToolsOptions(options);

  const tools: AgentTool[] = [searchMemoryTool(options), readMemoryTool(options)];

  if (allowWrite) {
    tools.push(rememberMemoryTool(options));
  }

  return tools;
}
