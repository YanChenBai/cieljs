import { randomUUID } from 'node:crypto';

import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

import type { DevtoolsUpdate, TraceEntry, TraceEvent, ValueRef } from '../protocol/index.ts';
import { TraceStore } from './store.ts';
import { messageContent, preview } from './trace-content.ts';
import { createTraceStep } from './trace-step.ts';

/** 宿主保存独立的完整快照；内存列表淘汰不删除磁盘记录。 */
export class DevtoolsHost {
  private readonly entries = new Map<string, TraceEntry>();
  private readonly listeners = new Set<(update: DevtoolsUpdate) => void>();
  private readonly dirty = new Set<string>();
  private readonly stepChanges = new Map<string, TraceEntry>();
  private sequence = 0;
  readonly store: TraceStore;
  private eventSequence = 0;
  private readonly wakeListeners = new Set<() => void>();
  private closed = false;
  private readonly lifetime = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;

  get signal() {
    return this.lifetime.signal;
  }

  constructor(
    private readonly capacity = 300,
    directory?: string,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('capacity 必须是正整数');
    this.store = new TraceStore(directory);
    this.eventSequence = this.store.sequence;
    this.sequence = this.eventSequence;
  }

  subscribe(listener: (update: DevtoolsUpdate) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  record(name: string, output: unknown, sessionId = 'watch-blive') {
    const entry = this.create(sessionId, 'event', name);
    entry.status = 'completed';
    entry.endedAt = Date.now();
    entry.output = this.storeValue(`${entry.id}:output`, output);
    this.update(entry);
  }

  observe(agent: Pick<Agent, 'subscribe' | 'state'>, sessionId: string) {
    const receive = this.agentListener(sessionId, () => ({
      tools: agent.state.tools,
      model: agent.state.model,
    }));
    return agent.subscribe(event => receive(event));
  }

  agentListener(
    sessionId: string,
    metadata?: () => {
      tools?: Agent['state']['tools'];
      model?: Agent['state']['model'];
      parentRunId?: string;
    },
  ): (
    event: AgentEvent,
    context?: { tools: Agent['state']['tools']; model: Agent['state']['model'] },
  ) => void {
    let runId = randomUUID();
    let turnId: string | undefined;
    let run: TraceEntry | undefined;
    let turn: TraceEntry | undefined;
    let message: TraceEntry | undefined;
    const tools = new Map<string, TraceEntry>();
    const callMessages = new Map<string, string>();
    return (event, context) => {
      const meta = { ...metadata?.(), ...context };
      if (event.type === 'agent_start') {
        runId = randomUUID();
        turnId = undefined;
        callMessages.clear();
        tools.clear();
        message = undefined;
        turn = undefined;
      }
      if (event.type === 'turn_start') turnId = randomUUID();
      const eventSequence = ++this.eventSequence;
      const rawId = `event:${eventSequence}`;
      const model = meta?.model;
      const decorate = (entry: TraceEntry) => {
        entry.runId = runId;
        entry.turnId = turnId;
        entry.parentRunId = meta?.parentRunId;
        entry.revision = eventSequence;
        entry.raw = { id: rawId, preview: event.type };
        if (model) entry.model = { id: model.id, name: model.name, provider: model.provider };
      };
      if (event.type === 'agent_start' || event.type === 'turn_start') {
        const entry = this.create(sessionId, 'event', event.type);
        decorate(entry);
        if (event.type === 'agent_start') run = entry;
        else turn = entry;
        this.update(entry);
      }
      if (event.type === 'agent_end' || event.type === 'turn_end') {
        const entry =
          (event.type === 'agent_end' ? run : turn) ?? this.create(sessionId, 'event', event.type);
        decorate(entry);
        entry.status = 'completed';
        entry.endedAt = Date.now();
        entry.output = this.storeValue(`${entry.id}:output`, event);
        this.update(entry);
      }
      if (
        event.type === 'message_start' ||
        event.type === 'message_update' ||
        event.type === 'message_end'
      ) {
        if (event.type === 'message_start' || !message)
          message = this.create(sessionId, 'message', event.message.role);
        decorate(message);
        message.messageId = message.id;
        if (event.message.role === 'assistant') {
          for (const block of event.message.content)
            if (block.type === 'toolCall') callMessages.set(block.id, message.id);
        }
        if (event.message.role === 'toolResult') message.toolCallId = event.message.toolCallId;
        const content = messageContent(event.message);
        message.text = content.text;
        message.thinking = content.thinking;
        message.output = this.storeValue(`${message.id}:output`, event.message);
        if (event.type === 'message_end') {
          message.status =
            event.message.role === 'assistant' && event.message.stopReason === 'error'
              ? 'error'
              : 'completed';
          message.endedAt = Date.now();
        }
        this.update(message);
      }
      if (event.type === 'tool_execution_start') {
        const entry = this.create(sessionId, 'tool', event.toolName);
        decorate(entry);
        entry.toolCallId = event.toolCallId;
        entry.messageId = callMessages.get(event.toolCallId);
        const tool = meta?.tools?.find(tool => tool.name === event.toolName);
        entry.label = tool?.label;
        entry.description = tool?.description;
        entry.input = this.storeValue(`${entry.id}:input`, event.args);
        tools.set(event.toolCallId, entry);
        this.update(entry);
      }
      if (event.type === 'tool_execution_update' || event.type === 'tool_execution_end') {
        const entry = tools.get(event.toolCallId);
        if (!entry) return;
        decorate(entry);
        entry.output = this.storeValue(
          `${entry.id}:output`,
          event.type === 'tool_execution_end' ? event.result : event.partialResult,
        );
        if (event.type === 'tool_execution_end') {
          entry.status = event.isError ? 'error' : 'completed';
          entry.endedAt = Date.now();
          tools.delete(event.toolCallId);
        }
        this.update(entry);
      }
      const trace: TraceEvent = {
        id: rawId,
        sequence: eventSequence,
        sessionId,
        runId,
        parentRunId: meta?.parentRunId,
        turnId,
        messageId: event.type.startsWith('message_')
          ? message?.id
          : 'toolCallId' in event
            ? callMessages.get(event.toolCallId)
            : undefined,
        toolCallId: 'toolCallId' in event ? event.toolCallId : message?.toolCallId,
        timestamp: Date.now(),
        event,
      };
      this.store.put(rawId, 'event', eventSequence, trace, runId);
      const step = createTraceStep(trace, meta.tools, model);
      this.store.put(step.id, 'step', eventSequence, step, runId);
      this.stepChanges.set(step.id, step);
      this.timer ??= setTimeout(() => this.flush(), 60);

      if (event.type === 'message_end') message = undefined;
      for (const wake of this.wakeListeners) wake();
    };
  }

  async *events(afterSequence = 0, signal?: AbortSignal): AsyncGenerator<TraceEvent> {
    let wake: (() => void) | undefined;
    const notify = () => wake?.();
    this.wakeListeners.add(notify);
    signal?.addEventListener('abort', notify);
    try {
      while (!this.closed && !signal?.aborted) {
        const pending = new Promise<void>(resolve => {
          wake = resolve;
        });
        // 先安装唤醒器，再读水位，避免快照和订阅之间丢事件。
        const events = this.store.list<TraceEvent>('event', {
          after: afterSequence,
          limit: 100,
          ascending: true,
        });
        for (const event of events) {
          if (this.closed || signal?.aborted) return;
          afterSequence = event.sequence;
          yield event;
        }
        if (!events.length) await pending;
      }
    } finally {
      this.wakeListeners.delete(notify);
      signal?.removeEventListener('abort', notify);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    this.stepChanges.clear();
    for (const wake of this.wakeListeners) wake();
    this.store.close();
    clearTimeout(this.timer);
    this.listeners.clear();
    this.entries.clear();
    this.dirty.clear();
  }

  private create(sessionId: string, kind: TraceEntry['kind'], name: string): TraceEntry {
    return {
      id: randomUUID(),
      sequence: ++this.sequence,
      sessionId,
      kind,
      name,
      status: 'running',
      startedAt: Date.now(),
    };
  }

  private storeValue(id: string, value: unknown): ValueRef {
    this.store.put(id, 'value', this.eventSequence, value);
    return { id, preview: preview(value) };
  }

  private update(entry: TraceEntry) {
    this.store.put(entry.id, 'entry', entry.sequence, entry, entry.runId);
    if (entry.name === 'agent_start')
      this.store.put(`run:${entry.id}`, 'run', entry.sequence, entry, entry.runId);
    this.entries.set(entry.id, { ...entry });
    this.dirty.add(entry.id);
    while (this.entries.size > this.capacity) {
      const id = this.entries.keys().next().value!;
      this.entries.delete(id);
      this.dirty.delete(id);
    }
    this.timer ??= setTimeout(() => this.flush(), 60);
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const update = {
      entries: [...this.dirty].flatMap(id => this.entries.get(id) ?? []),
      steps: [...this.stepChanges.values()],
    };
    this.dirty.clear();
    this.stepChanges.clear();
    for (const listener of this.listeners) listener(update);
  }
}
