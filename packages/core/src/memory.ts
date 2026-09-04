import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { memoryTools } from "@cieljs/memory";
import type { Memory } from "@cieljs/memory";

export interface MemoryAgentOptions {
  memory: Memory;
  allowWrite?: boolean;
  maxTokens?: number;
  recentDays?: number;
  countTokens?: (text: string) => number;
}

export function createMemoryIntegration(options: MemoryAgentOptions, sessionId: string) {
  const { memory, maxTokens, recentDays, countTokens } = options;
  const tools = memoryTools({
    memory,
    allowWrite: options.allowWrite,
    sources: [{ type: "session", sessionId }],
  });

  return {
    tools,
    // transformContext 的返回值只用于模型调用，不写回 Agent 状态或 session 原始记录。
    transformContext: async (
      messages: AgentMessage[],
      signal?: AbortSignal,
    ): Promise<AgentMessage[]> => {
      const lastUser = messages.findLast((message) => message.role === "user");
      const content = lastUser?.role === "user" ? lastUser.content : undefined;
      const query =
        typeof content === "string"
          ? content
          : content?.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
      const context = await memory.context({
        query,
        maxTokens,
        recentDays,
        countTokens,
        signal,
      });
      if (!context.text) return messages;

      return [{ role: "user", content: context.text, timestamp: Date.now() }, ...messages];
    },
  };
}
