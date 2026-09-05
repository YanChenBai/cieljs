import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import type { Model } from "@earendil-works/pi-ai";
import { xiaomi } from "./provider.ts";
import { createMemory, type MemoryAgentOptions } from "./memory.ts";
import { createSession, type SessionAgentOptions } from "./session.ts";

export interface CreateSessionAgentOptions {
  model?: Model<any>;
  systemPrompt: string;
  /**
   * Session Tools 之外的其他工具。
   */
  tools?: AgentTool[];
  session: SessionAgentOptions;
  memory?: MemoryAgentOptions;
}

const models = createModels();
const providers = [xiaomi, ...builtinProviders()];

for (const provider of providers) {
  models.setProvider(provider);
}

export async function createSessionAgent(options: CreateSessionAgentOptions) {
  const {
    session: sessionOptions,
    model = models.getModel("xiaomi", "mimo-v2.5"),
    systemPrompt,
    tools = [],
  } = options;

  if (!model) {
    throw new Error("Model not found");
  }

  const { session, context, tools: sessionToolList } = await createSession(sessionOptions);

  const memory = options.memory ? await createMemory(options.memory, session.id) : undefined;
  const resolvedSystemPrompt = [systemPrompt, memory?.systemPrompt].filter(Boolean).join("\n\n");

  console.log("SystemPrompt:", resolvedSystemPrompt);

  const agent = new Agent({
    sessionId: session.id,
    streamFn: models.streamSimple.bind(models),
    transformContext: memory?.transformContext,
    initialState: {
      model,
      systemPrompt: resolvedSystemPrompt,
      messages: context,
      tools: [...tools, ...sessionToolList, ...(memory?.tools ?? [])],
    },
  });

  let persistence: Promise<unknown> = Promise.resolve();

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
      .then(() => session.appendMessage(event.message))
      .catch((error) => {
        console.error("[session] Failed to persist message", error);
      });
  });

  return {
    agent,

    session,

    unsubscribe,

    flushPersistence: () => persistence,
  };
}
