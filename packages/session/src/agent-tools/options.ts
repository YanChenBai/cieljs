import type { CreateSessionToolsOptions } from "./types.ts";

export const sessionToolsDefaults = {
  searchLimit: 8,
  maxReadMessages: 10,
} as const;

export interface ResolvedSessionToolsOptions {
  store: CreateSessionToolsOptions["store"];
  sessionId: string;
  includeContextTool: boolean;
  searchLimit: number;
  maxReadMessages: number;
}

/**
 * 归一化 Session Tools 配置，为所有工具提供一致的默认值。
 */
export function resolveSessionToolsOptions(
  options: CreateSessionToolsOptions,
): ResolvedSessionToolsOptions {
  return {
    store: options.store,
    sessionId: options.sessionId,
    includeContextTool: options.includeContextTool ?? false,
    searchLimit: options.searchLimit ?? sessionToolsDefaults.searchLimit,
    maxReadMessages: options.maxReadMessages ?? sessionToolsDefaults.maxReadMessages,
  };
}
