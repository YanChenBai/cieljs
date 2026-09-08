import type { MemoryManager } from '@cieljs/memory';
import { globalMemoryTools, memoryTools } from '@cieljs/memory/agent';
import type { Session, SessionManager } from '@cieljs/session';
import { sessionTools } from '@cieljs/session/agent';
import type { Agent, AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/compat';

import { createSessionContextTransformer } from './context.ts';
import { ManagedAgent } from './managed-agent.ts';
import { createSessionSourceSync } from './session-sources.ts';
import { assertUniqueTools } from './tools.ts';

export class SessionAgentHandle {
  private closePromise: Promise<void> | undefined;

  constructor(
    readonly agent: Agent,
    readonly session: Session,
    private readonly unsubscribe: () => void,
    private readonly markClosed: () => void,
    private readonly onClose: (handle: SessionAgentHandle) => void,
  ) {}

  close(): Promise<void> {
    this.closePromise ??= this.closeAgent();

    return this.closePromise;
  }

  private async closeAgent() {
    this.markClosed();
    await this.agent.waitForIdle();
    this.unsubscribe();
    this.onClose(this);
  }
}

export async function createCielSessionAgent(options: {
  model: Model<Api>;
  apiKey?: string;
  systemPrompt: string;
  tools: AgentTool[];
  sessionManager: SessionManager;
  memoryManager: MemoryManager;
  sessionId?: string;
  spaceId: string;
  crossSpace?: boolean;
  resolveSources: () => string[];
  assertRunning: () => void;
  onClose: (handle: SessionAgentHandle) => void;
}): Promise<SessionAgentHandle> {
  const sessionSpace = options.sessionManager.space(options.spaceId);
  const memorySpace = options.memoryManager.space(options.spaceId);
  const initialSources = options.resolveSources();
  const session = await sessionSpace.session({
    id: options.sessionId,
    sources: initialSources,
  });
  const messages = await session.context();

  const { refreshSources, resolveAndRefreshSources } = createSessionSourceSync(
    session,
    initialSources,
    options.resolveSources,
  );

  const tools = [
    ...options.tools,
    ...sessionTools({
      session,
      space: sessionSpace,
      crossSpace: options.crossSpace
        ? { manager: options.sessionManager, access: 'related' }
        : undefined,
    }),
    ...memoryTools({
      space: memorySpace,
      crossSpace: options.crossSpace
        ? { manager: options.memoryManager, access: 'related' }
        : undefined,
      sources: () => [`session:${session.id}`, ...options.resolveSources()],
    }),
    ...globalMemoryTools({
      memory: options.memoryManager.global,
      sources: () => [`session:${session.id}`, ...options.resolveSources()],
    }),
  ];
  assertUniqueTools(tools);

  let isClosed = false;
  const agent = new ManagedAgent({
    sessionId: session.id,
    streamFn: (model, context, streamOptions) =>
      streamSimple(model, context, { ...streamOptions, apiKey: options.apiKey }),
    prepareRun: async () => {
      options.assertRunning();

      if (isClosed) {
        throw new Error(`Session 已关闭：${session.id}`);
      }

      await resolveAndRefreshSources();
    },
    beforeToolCall: resolveAndRefreshSources,
    transformContext: createSessionContextTransformer({
      manager: options.memoryManager,
      space: memorySpace,
      spaceId: options.spaceId,
      resolveSources: options.resolveSources,
      refreshSources,
    }),
    initialState: {
      model: options.model,
      systemPrompt: options.systemPrompt,
      messages,
      tools,
    },
  });

  const unsubscribe = agent.subscribe(async event => {
    if (event.type === 'message_end') {
      await session.appendMessage(event.message);
    }
  });

  return new SessionAgentHandle(
    agent,
    session,
    unsubscribe,
    () => {
      isClosed = true;
    },
    options.onClose,
  );
}
