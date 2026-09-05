import type { SessionManager, SessionSource, SessionSpace } from "@cieljs/session";
import { sessionTools, type SessionToolLimits } from "@cieljs/session/agent";

export interface SessionAgentOptions extends SessionToolLimits {
  manager: SessionManager;
  space: SessionSpace;

  /**
   * 不提供则新建一个 Session。
   */
  sessionId?: string;

  /** 记录业务来源，供宿主与跨 Session Agent 定位相关会话。 */
  sources?: () => SessionSource[];

  /**
   * 是否额外启用跨空间 Session 检索；默认不开放。
   *
   * @default false
   */
  crossSpace?: boolean;
}

/**
 * 打开（或创建）一个 Session，并准备好 Agent 所需的上下文与工具。
 *
 * 与 {@link createMemory} 对称：这里只负责 Session 本身的集成，返回
 * `context`（已恢复的历史消息）与 `tools`，由调用方组装进 Agent。
 */
export async function createSession(options: SessionAgentOptions) {
  const {
    manager,
    space,
    sessionId = crypto.randomUUID(),
    sources = () => [],
    crossSpace = false,
    searchLimit,
    maxReadMessages,
  } = options;

  const session = await space.session({
    id: sessionId,
    sources: [...sources()],
  });

  const context = await session.context();

  const tools = sessionTools({
    session,
    space,
    searchLimit,
    maxReadMessages,
    crossSpace: crossSpace ? { manager, access: "all" } : undefined,
  });

  return {
    session,
    /**
     * 已恢复的历史消息（含压缩摘要），应作为 Agent 的初始消息。
     */
    context,
    tools,
  };
}
