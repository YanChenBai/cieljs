import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { MemoryManager, SpaceMemory } from "@cieljs/memory";
import { loadMemoryContext, memoryTools } from "@cieljs/memory/agent";
import type { MemoryContextSection } from "@cieljs/memory/agent";

export interface MemoryAgentOptions {
  manager: MemoryManager;
  space: SpaceMemory;
  /**
   * 是否开启跨空间搜索/读取记忆；默认仅允许访问当前空间。
   *
   * @default false
   */
  crossSpace?: boolean;
  maxTokens?: number;
  recentDays?: number;
  countTokens?: (text: string) => number;
  sources?: () => string[];
}

function renderMemorySection(title: string, context: MemoryContextSection): string | undefined {
  if (!context.text) {
    return undefined;
  }

  return [`# ${title}`, context.text].join("\n");
}

export async function createMemory(options: MemoryAgentOptions, sessionId: string) {
  const {
    manager,
    space,
    crossSpace = false,
    maxTokens,
    recentDays,
    countTokens,
    sources = () => [],
  } = options;

  const context = await loadMemoryContext({
    manager,
    space,
    globalLongTermTokens: maxTokens,
    spaceLongTermTokens: maxTokens,
    dailyTokens: 0,
    countTokens,
  });

  const systemPrompt = [
    renderMemorySection("全局长期记忆", context.globalLongTerm),
    renderMemorySection("当前空间长期记忆", context.spaceLongTerm),
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");

  const tools = memoryTools({
    space,
    sources: [`session:${sessionId}`, ...sources()],
    crossSpace: crossSpace ? { manager, access: "all" } : undefined,
  });

  return {
    systemPrompt,
    tools,
    // 每日记忆只属于当前空间，并且只进入本次模型调用的临时上下文。
    transformContext: async (
      messages: AgentMessage[],
      signal?: AbortSignal,
    ): Promise<AgentMessage[]> => {
      const dailyContext = await loadMemoryContext({
        manager,
        space,
        recentDays,
        globalLongTermTokens: 0,
        spaceLongTermTokens: 0,
        dailyTokens: maxTokens,
        countTokens,
        signal,
      });
      const daily = dailyContext.daily;

      if (!daily.text) {
        return messages;
      }

      return [
        {
          role: "user",
          content: daily.text,
          timestamp: Date.now(),
        },
        ...messages,
      ];
    },
  };
}
