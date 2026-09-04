import { resolveSessionToolsOptions } from "./options.ts";
import { createSearchTool } from "./search-tool.ts";
import type { CreateCrossSessionToolsOptions } from "./types.ts";

export function searchCrossSessionsTool(options: CreateCrossSessionToolsOptions) {
  const { searchLimit } = resolveSessionToolsOptions(options);

  return createSearchTool({
    name: "search_cross_sessions",
    label: "跨会话搜索",
    scope: "可访问的全部会话",
    readTool: "read_cross_sessions",
    includeSessionId: true,
    searchLimit,
    search: options.manager.search.bind(options.manager),
  });
}
