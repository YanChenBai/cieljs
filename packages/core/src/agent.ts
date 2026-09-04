import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";

import {
  SessionManager,
  crossSessionTools as createCrossSessionTools,
  sessionTools,
} from "@cieljs/session";
import { createModels } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

import type { Model } from "@earendil-works/pi-ai";
import { xiaomi } from "./provider.ts";
import { createMemory, type MemoryAgentOptions } from "./memory.ts";

export interface CreateSessionAgentOptions {
  manager: SessionManager;

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

  /**
   * 是否额外启用跨 Session 检索工具。
   *
   * @default false
   */
  crossSessionTools?: boolean;

  memory?: MemoryAgentOptions;
}

const models = createModels();
const providers = [xiaomi, ...builtinProviders()];

for (const provider of providers) {
  models.setProvider(provider);
}

export async function createSessionAgent(options: CreateSessionAgentOptions) {
  const {
    manager,
    sessionId,
    model = models.getModel("xiaomi", "mimo-v2.5"),
    systemPrompt,
    useSessionTools = true,
    crossSessionTools = false,
    tools = [],
  } = options;

  const session = await manager.session(sessionId);
  const restoredMessages = await session.context();

  if (!model) {
    throw new Error("Model not found");
  }

  const sessionToolList = useSessionTools ? sessionTools({ session }) : [];
  const crossSessionToolList = crossSessionTools ? createCrossSessionTools({ manager }) : [];

  const memory = options.memory ? await createMemory(options.memory, sessionId) : undefined;
  const resolvedSystemPrompt = [systemPrompt, memory?.systemPrompt].filter(Boolean).join("\n\n");

  const agent = new Agent({
    sessionId: session.id,
    streamFn: models.streamSimple.bind(models),
    transformContext: memory?.transformContext,
    initialState: {
      model,
      systemPrompt: resolvedSystemPrompt,
      messages: restoredMessages,
      tools: [...tools, ...sessionToolList, ...crossSessionToolList, ...(memory?.tools ?? [])],
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
      .then(() => session.appendMessage(event.message))
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
