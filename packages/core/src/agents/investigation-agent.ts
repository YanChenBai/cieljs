import type { MemoryManager } from '@cieljs/memory';
import type { SessionManager } from '@cieljs/session';
import type { AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/compat';

import type { InvestigationResult } from '../types.ts';
import { createInvestigationContextTransformer } from './context.ts';
import { createInvestigationTools } from './investigation-tools.ts';
import { ManagedAgent } from './managed-agent.ts';
import { createSessionSourceSync } from './session-sources.ts';
import { assertUniqueTools } from './tools.ts';

export async function runInvestigation(options: {
  model: Model<Api>;
  apiKey?: string;
  systemPrompt: string;
  tools: AgentTool[];
  sessionManager: SessionManager;
  investigationManager: SessionManager;
  memoryManager: MemoryManager;
  sessionId?: string;
  spaceId: string;
  crossSpace?: boolean;
  resolveSources: () => string[];
  question: string | AgentMessage[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent, context: { tools: AgentTool[]; model: Model<Api> }) => void;
}): Promise<InvestigationResult> {
  options.signal?.throwIfAborted();

  const investigationSpace = options.investigationManager.space(options.spaceId);
  const initialSources = options.resolveSources();
  const session = await investigationSpace.session({
    id: options.sessionId,
    sources: initialSources,
  });
  const context = await session.context();

  const { refreshSources, resolveAndRefreshSources } = createSessionSourceSync(
    session,
    initialSources,
    options.resolveSources,
  );

  const tools = [
    ...createInvestigationTools({
      sessionManager: options.sessionManager,
      memoryManager: options.memoryManager,
      spaceId: options.spaceId,
      crossSpace: options.crossSpace,
      resolveSources: options.resolveSources,
    }),
    ...options.tools,
  ];
  assertUniqueTools(tools);

  const agent = new ManagedAgent({
    sessionId: session.id,
    streamFn: (model, context, streamOptions) =>
      streamSimple(model, context, { ...streamOptions, apiKey: options.apiKey }),
    prepareRun: resolveAndRefreshSources,
    beforeToolCall: resolveAndRefreshSources,
    transformContext: createInvestigationContextTransformer({
      spaceId: options.spaceId,
      resolveSources: options.resolveSources,
      refreshSources,
    }),
    initialState: {
      model: options.model,
      systemPrompt: options.systemPrompt,
      messages: context,
      tools,
    },
  });

  const messages: AgentMessage[] = [];
  const unsubscribe = agent.subscribe(async event => {
    options.onEvent?.(event, { tools, model: options.model });
    if (event.type !== 'message_end') {
      return;
    }

    messages.push(event.message);
    await session.appendMessage(event.message);
  });
  const abort = () => agent.abort();
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    options.signal?.throwIfAborted();

    if (typeof options.question === 'string') {
      await agent.prompt(options.question);
    } else {
      await agent.prompt(options.question);
    }
  } finally {
    options.signal?.removeEventListener('abort', abort);
    unsubscribe();
  }

  const answer = messages.findLast(message => message.role === 'assistant');

  if (!answer) {
    throw new Error('Investigation 没有产生最终回答');
  }

  if (answer.role === 'assistant' && answer.errorMessage) {
    throw new Error(`Investigation 失败：${answer.errorMessage}`);
  }

  return {
    sessionId: session.id,
    answer,
    messages,
  };
}
