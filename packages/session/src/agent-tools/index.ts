import type { AgentTool } from "@earendil-works/pi-agent-core";

import { searchSessionTool } from "./search-session.ts";
import { readSessionTool } from "./read-session.ts";
import { getSessionContextTool } from "./get-session-context.ts";
import { resolveSessionToolsOptions } from "./options.ts";
import type { CreateSessionToolsOptions } from "./types.ts";

export { searchSessionTool } from "./search-session.ts";
export { readSessionTool } from "./read-session.ts";
export { getSessionContextTool } from "./get-session-context.ts";
export { resolveSessionToolsOptions, sessionToolsDefaults } from "./options.ts";
export type { ResolvedSessionToolsOptions } from "./options.ts";
export type { CreateSessionToolsOptions } from "./types.ts";

/**
 * 创建 Session 相关 Agent Tools。
 *
 * 默认提供：
 *
 * - search_session
 * - read_session
 *
 * 设置 includeContextTool 后额外提供：
 *
 * - get_session_context
 */
export function sessionTools(options: CreateSessionToolsOptions): AgentTool[] {
  const { includeContextTool } = resolveSessionToolsOptions(options);

  const tools: AgentTool[] = [searchSessionTool(options), readSessionTool(options)];

  if (includeContextTool) {
    tools.push(getSessionContextTool(options));
  }

  return tools;
}
