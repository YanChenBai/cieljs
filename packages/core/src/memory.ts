import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { allMemoryTools, memoryTools } from "@cieljs/memory";
import type { MemoryContext, SpaceMemory } from "@cieljs/memory";

export interface MemoryAgentOptions {
  space: SpaceMemory;
  crossSpaceSearch?: boolean;
  maxTokens?: number;
  recentDays?: number;
  countTokens?: (text: string) => number;
}

function renderMemorySection(title: string, context: MemoryContext): string | undefined {
  if (!context.text) {
    return undefined;
  }

  return [`# ${title}`, context.text].join("\n");
}

export async function createMemory(options: MemoryAgentOptions, sessionId: string) {
  const { space, maxTokens, recentDays, countTokens } = options;
  const contextOptions = { maxTokens, countTokens };

  const [globalLongTerm, spaceLongTerm] = await Promise.all([
    space.manager.global.longTerm.context(contextOptions),
    space.longTerm.context(contextOptions),
  ]);

  const systemPrompt = [
    renderMemorySection("全局长期记忆", globalLongTerm),
    renderMemorySection("当前空间长期记忆", spaceLongTerm),
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");

  const tools = memoryTools({
    space,
    sources: [{ type: "session", sessionId }],
  });
  const allTools = options.crossSpaceSearch ? allMemoryTools({ manager: space.manager }) : [];

  return {
    systemPrompt,
    tools: [...tools, ...allTools],
    // 每日记忆只属于当前空间，并且只进入本次模型调用的临时上下文。
    transformContext: async (
      messages: AgentMessage[],
      signal?: AbortSignal,
    ): Promise<AgentMessage[]> => {
      const daily = await space.daily.context({
        recentDays,
        maxTokens,
        countTokens,
        signal,
      });

      if (!daily.text) {
        return messages;
      }

      return [{ role: "user", content: daily.text, timestamp: Date.now() }, ...messages];
    },
  };
}
