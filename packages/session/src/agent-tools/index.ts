import type { AgentTool } from "@earendil-works/pi-agent-core";

import { searchSessionTool } from "./search-session.ts";
import { readSessionTool } from "./read-session.ts";
import { searchCrossSessionsTool } from "./search-cross-sessions.ts";
import { readCrossSessionsTool } from "./read-cross-sessions.ts";
import type { CreateCrossSessionToolsOptions, CreateSessionToolsOptions } from "./types.ts";

export { searchSessionTool } from "./search-session.ts";
export { readSessionTool } from "./read-session.ts";
export { searchCrossSessionsTool } from "./search-cross-sessions.ts";
export { readCrossSessionsTool } from "./read-cross-sessions.ts";
export { resolveSessionToolsOptions, sessionToolsDefaults } from "./options.ts";
export type { ResolvedSessionToolsOptions } from "./options.ts";
export type {
  CreateCrossSessionToolsOptions,
  CreateSessionToolsOptions,
  SessionToolLimits,
} from "./types.ts";

/**
 * 创建 Session 相关 Agent Tools。
 *
 * 默认提供：
 *
 * - search_session
 * - read_session
 *
 */
export function sessionTools(options: CreateSessionToolsOptions): AgentTool[] {
  return [searchSessionTool(options), readSessionTool(options)];
}

/** 创建显式跨 Session 的 Agent Tools。 */
export function crossSessionTools(options: CreateCrossSessionToolsOptions): AgentTool[] {
  return [searchCrossSessionsTool(options), readCrossSessionsTool(options)];
}
