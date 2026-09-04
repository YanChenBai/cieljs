import type { Session } from "../session.ts";
import type { SessionManager } from "../session-manager.ts";

export interface SessionToolLimits {
  /**
   * 搜索工具默认返回数量。
   *
   * @default 8
   */
  searchLimit?: number;

  /**
   * 读取工具单侧最多允许读取多少条消息。
   *
   * @default 10
   */
  maxReadMessages?: number;
}

export interface CreateSessionToolsOptions extends SessionToolLimits {
  /** 当前 Agent 所绑定的 Session。 */
  session: Session;
}

export interface CreateCrossSessionToolsOptions extends SessionToolLimits {
  /** 跨 Session 查询所使用的 Manager。 */
  manager: SessionManager;
}
