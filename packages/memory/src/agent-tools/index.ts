import type { AgentTool } from "@earendil-works/pi-agent-core";

import { searchMemoryTool } from "./search-memory.ts";
import { readMemoryTool } from "./read-memory.ts";
import { rememberMemoryTool } from "./remember-memory.ts";
import { searchCrossScopesTool } from "./search-cross-scopes.ts";
import { readCrossScopesTool } from "./read-cross-scopes.ts";
import { resolveMemoryToolsOptions } from "./options.ts";
import type { CreateCrossScopeMemoryToolsOptions, CreateMemoryToolsOptions } from "./types.ts";

export { searchMemoryTool } from "./search-memory.ts";
export { readMemoryTool } from "./read-memory.ts";
export { rememberMemoryTool } from "./remember-memory.ts";
export { searchCrossScopesTool } from "./search-cross-scopes.ts";
export { readCrossScopesTool } from "./read-cross-scopes.ts";
export {
  resolveMemoryToolsOptions,
  resolveCrossScopeMemoryToolsOptions,
  memoryToolsDefaults,
} from "./options.ts";
export type {
  ResolvedMemoryToolsOptions,
  ResolvedCrossScopeMemoryToolsOptions,
} from "./options.ts";
export type {
  CreateCrossScopeMemoryToolsOptions,
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

/** 创建显式跨 Scope 的只读 Agent Tools。 */
export function crossScopeMemoryTools(options: CreateCrossScopeMemoryToolsOptions): AgentTool[] {
  return [searchCrossScopesTool(options), readCrossScopesTool(options)];
}
