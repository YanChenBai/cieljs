import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type {
  RuntimeEvent,
  RuntimeEventBus,
  RuntimeEventEnvelope,
  RuntimeMetadata,
  RuntimeRecord,
} from '@cieljs/agent-kit/protocol';

import type { RuntimeJournal, RuntimeProjector } from './journal.ts';

interface CorrelationState {
  runId: string;
  turnId?: string;
  messageId?: string;
  messageByToolCall: Map<string, string>;
  toolExecutions: Map<string, string>;
}

interface PublishedEvent {
  envelope: RuntimeEventEnvelope;
  durable?: Promise<RuntimeRecord>;
}

/**
 * Runtime 事件入口：负责关联 ID、实时分发和 durable 策略。
 * 同一原始事件可能同时被 Session 与 Trace 观察；只有对象及其内容快照都相同才视为同一次观察。
 */
export class RuntimeEventHub implements RuntimeEventBus {
  private readonly listeners = new Set<(event: RuntimeEventEnvelope) => void>();
  private readonly states = new Map<string, CorrelationState>();
  private readonly seen = new WeakMap<RuntimeEvent, Map<string, PublishedEvent>>();
  private revision = 0;
  private closed = false;

  constructor(private readonly journal: RuntimeJournal) {}

  publish(
    sessionId: string,
    event: RuntimeEvent,
    metadata: RuntimeMetadata = {},
  ): Promise<RuntimeEventEnvelope> {
    return this.publishWithProject(sessionId, event, metadata);
  }

  async publishWithProject(
    sessionId: string,
    event: RuntimeEvent,
    metadata: RuntimeMetadata = {},
    project?: RuntimeProjector,
  ): Promise<RuntimeEventEnvelope> {
    if (this.closed) throw new Error('RuntimeEventHub 已关闭');

    const existing = this.seen.get(event)?.get(sessionId);
    // Pi 的流式实现可能复用同一个 event 对象并原地更新 message/delta。
    // WeakMap 只能用来合并 Session + Trace 对“同一快照”的双重观察，不能永久吞掉后续 mutation。
    if (existing && isDeepStrictEqual(existing.envelope.event, event)) {
      if (existing.durable) {
        const record = await existing.durable;
        if (project) await this.journal.project(record, project);
      }
      return existing.envelope;
    }

    const envelope = this.correlate(sessionId, event, metadata);
    const published: PublishedEvent = { envelope };
    const events = this.seen.get(event) ?? new Map<string, PublishedEvent>();
    events.set(sessionId, published);
    this.seen.set(event, events);

    // Durable append 先建立 Promise，但不等待；这样重复观察者能立即复用同一次写入。
    if (shouldPersistRuntimeEvent(event)) {
      published.durable = this.journal.record(envelope, project);
    }

    // Live 分发不等待数据库；update 只走这条路径。
    for (const listener of this.listeners) listener(envelope);

    if (published.durable) await published.durable;
    return envelope;
  }

  subscribe(listener: (event: RuntimeEventEnvelope) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flush() {
    return this.journal.flush();
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    this.states.clear();
  }

  private correlate(
    sessionId: string,
    event: RuntimeEvent,
    metadata: RuntimeMetadata,
  ): RuntimeEventEnvelope {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        runId: randomUUID(),
        messageByToolCall: new Map(),
        toolExecutions: new Map(),
      };
      this.states.set(sessionId, state);
    }

    if (event.type === 'agent_start') {
      state.runId = randomUUID();
      state.turnId = undefined;
      state.messageId = undefined;
      state.messageByToolCall.clear();
      state.toolExecutions.clear();
    }
    if (event.type === 'turn_start') state.turnId = randomUUID();
    if (event.type === 'message_start' || (event.type.startsWith('message_') && !state.messageId)) {
      state.messageId = randomUUID();
    }

    if ('message' in event && event.message.role === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'toolCall' && state.messageId) {
          state.messageByToolCall.set(block.id, state.messageId);
        }
      }
    }

    let toolCallId: string | undefined;
    if ('toolCallId' in event) {
      toolCallId = event.toolCallId;
    } else if ('message' in event && event.message.role === 'toolResult') {
      toolCallId = event.message.toolCallId;
    }

    let toolExecutionId: string | undefined;
    if (event.type === 'tool_execution_start') {
      toolExecutionId = randomUUID();
      state.toolExecutions.set(event.toolCallId, toolExecutionId);
    } else if (toolCallId) {
      toolExecutionId = state.toolExecutions.get(toolCallId);
    }

    let messageId: string | undefined;
    if (event.type.startsWith('message_')) {
      messageId = state.messageId;
    } else if (toolCallId) {
      messageId = state.messageByToolCall.get(toolCallId);
    }

    const envelope: RuntimeEventEnvelope = {
      version: 1,
      id: randomUUID(),
      revision: ++this.revision,
      sessionId,
      runId: state.runId,
      turnId: state.turnId,
      messageId,
      toolCallId,
      toolExecutionId,
      parentRunId: metadata.parentRunId,
      timestamp: Date.now(),
      event: structuredClone(event),
      metadata: {
        ...metadata,
        tools: metadata.tools?.map(tool => ({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    };

    if (event.type === 'message_end') state.messageId = undefined;
    // tool execution 关联保留到 run 结束，使随后到达的 toolResult message 仍可关联 execution。
    if (event.type === 'turn_end') state.turnId = undefined;

    return envelope;
  }
}

export function shouldPersistRuntimeEvent(event: RuntimeEvent): boolean {
  return event.type !== 'message_update' && event.type !== 'tool_execution_update';
}
