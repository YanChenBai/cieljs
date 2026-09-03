import type { SessionStore } from "../store.ts";

export interface CreateSessionToolsOptions {
  store: SessionStore;

  /**
   * 默认不重复暴露当前上下文；调试或特殊工作流可显式启用。
   */
  includeContextTool?: boolean;

  /**
   * 当前 Agent 所绑定的 Session。
   */
  sessionId: string;

  /**
   * search_session 默认返回数量。
   *
   * @default 8
   */
  searchLimit?: number;

  /**
   * read_session 单侧最多允许读取多少条消息。
   *
   * @default 10
   */
  maxReadMessages?: number;
}
