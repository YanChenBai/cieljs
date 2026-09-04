import { resolveSessionToolsOptions } from "./options.ts";
import { createReadTool } from "./read-tool.ts";
import type { CreateSessionToolsOptions } from "./types.ts";

export function readSessionTool(options: CreateSessionToolsOptions) {
  const { maxReadMessages } = resolveSessionToolsOptions(options);

  return createReadTool({
    name: "read_session",
    label: "读取当前会话",
    scope: "当前会话",
    searchTool: "search_session",
    maxReadMessages,
    getMessage: options.session.getMessage.bind(options.session),
    getSession: async () => options.session,
  });
}
