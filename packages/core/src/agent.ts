import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";

import { SessionStore, sessionTools } from "@cieljs/session";
import { createModels } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import type { Model } from "@earendil-works/pi-ai";
import { xiaomi } from "./provider.ts";
import { createMemoryIntegration, type MemoryAgentOptions } from "./memory.ts";

export interface CreateSessionAgentOptions {
  store: SessionStore;

  sessionId: string;

  model?: Model<any>;

  systemPrompt: string;

  /**
   * Session Tools 之外的其他工具。
   */
  tools?: AgentTool[];

  /**
   * 是否启用 Session 检索工具。
   *
   * @default true
   */
  useSessionTools?: boolean;

  memory?: MemoryAgentOptions;
}

const models = createModels();

models.setProvider(xiaomi);

for (const provider of builtinProviders()) {
  models.setProvider(provider);
}

export async function createSessionAgent(options: CreateSessionAgentOptions) {
  const {
    store,
    sessionId,
    model = models.getModel("xiaomi", "mimo-v2.5"),
    systemPrompt,
    useSessionTools = true,
    tools = [],
  } = options;

  const session = await store.getOrCreateSession(sessionId);

  /**
   * 从数据库恢复：
   *
   * summary
   * +
   * 尚未压缩的 messages
   */
  const context = await store.getContext(session.id);

  const restoredMessages = createRestoredMessages(context.summary, context.messages ?? []);

  if (!model) {
    throw new Error("Model not found");
  }

  const sessionToolList = useSessionTools
    ? sessionTools({
        store,
        sessionId,
      })
    : [];

  const memory = options.memory ? createMemoryIntegration(options.memory, sessionId) : undefined;

  const agent = new Agent({
    sessionId: session.id,
    streamFn: models.streamSimple.bind(models),
    transformContext: memory?.transformContext,
    initialState: {
      model,
      systemPrompt,
      messages: restoredMessages,
      tools: [...tools, ...sessionToolList, ...(memory?.tools ?? [])],
    },
  });

  let persistence: Promise<any> = Promise.resolve();

  /**
   * Pi 的 message_end 包括：
   *
   * user
   * assistant
   * toolResult
   *
   * 所以这里统一持久化即可。
   */
  const unsubscribe = agent.subscribe((event) => {
    if (event.type !== "message_end") {
      return;
    }

    persistence = persistence
      .then(() => store.appendMessage(sessionId, event.message))
      .catch((error) => {
        console.error("[session] Failed to persist message", error);
      });
  });

  return {
    agent,

    unsubscribe,

    flushPersistence: () => persistence,
  };
}

function createRestoredMessages(
  summary: string | null,
  messages: Parameters<typeof createSummaryMessage>[1],
) {
  if (!summary) {
    return messages;
  }

  return [
    createSummaryMessage(summary, messages),

    ...messages,
  ];
}

function createSummaryMessage(summary: string, _messages: AgentMessage[]): AgentMessage {
  return {
    role: "user",

    content: [
      {
        type: "text",

        text: [
          "<session_summary>",
          "以下内容是此前会话历史的压缩摘要。",
          "它代表更早的对话历史，应作为已有上下文使用，而不是新的用户请求。",
          "",
          summary,
          "</session_summary>",
        ].join("\n"),
      },
    ],

    timestamp: Date.now(),
  };
}
