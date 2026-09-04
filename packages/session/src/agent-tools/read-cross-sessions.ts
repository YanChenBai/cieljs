import { resolveSessionToolsOptions } from "./options.ts";
import { createReadTool } from "./read-tool.ts";
import type { CreateCrossSessionToolsOptions } from "./types.ts";

export function readCrossSessionsTool(options: CreateCrossSessionToolsOptions) {
  const { maxReadMessages } = resolveSessionToolsOptions(options);

  return createReadTool({
    name: "read_cross_sessions",
    label: "跨会话读取",
    scope: "可访问的全部会话",
    searchTool: "search_cross_sessions",
    maxReadMessages,
    getMessage: options.manager.getMessage.bind(options.manager),
    getSession: (message) => options.manager.session(message.sessionId),
  });
}
