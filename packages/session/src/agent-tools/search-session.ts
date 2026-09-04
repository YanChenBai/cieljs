import { resolveSessionToolsOptions } from "./options.ts";
import { createSearchTool } from "./search-tool.ts";
import type { CreateSessionToolsOptions } from "./types.ts";

export function searchSessionTool(options: CreateSessionToolsOptions) {
  const { searchLimit } = resolveSessionToolsOptions(options);

  return createSearchTool({
    name: "search_session",
    label: "搜索当前会话",
    scope: "当前会话",
    readTool: "read_session",
    includeSessionId: false,
    searchLimit,
    search: options.session.search.bind(options.session),
  });
}
