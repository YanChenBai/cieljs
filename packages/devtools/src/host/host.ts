import { randomUUID } from 'node:crypto';

import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

import type { DevtoolsUpdate, TraceEntry, TraceEvent, ValueRef } from '../protocol/index.ts';
import { AgentTrace, type AgentTraceMetadata } from './agent-trace.ts';
import { TraceStore } from './store.ts';
import { preview } from './trace-content.ts';
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
    const entry = this.createEntry(sessionId, 'event', name);
    entry.status = 'completed';
    entry.endedAt = Date.now();
    entry.output = this.storeValue(`${entry.id}:output`, output);
    this.saveEntry(entry);
  }

  observe(agent: Pick<Agent, 'subscribe' | 'state'>, sessionId: string) {
    const receive = this.agentListener(sessionId, () => ({
      tools: agent.state.tools,
      model: agent.state.model,
    }));
    return agent.subscribe(event => receive(event));
  }

  /** 创建独立的 Agent 事件归并器；宿主只分配序号并保存归并结果。 */
  agentListener(sessionId: string, metadata?: () => AgentTraceMetadata) {
    const observer = new AgentTrace(sessionId, {
      createEntry: (sessionId, kind, name) => this.createEntry(sessionId, kind, name),
      saveEntry: entry => this.saveEntry(entry),
      storeValue: (id, value) => this.storeValue(id, value),
    });

    return (event: AgentEvent, context?: AgentTraceMetadata) => {
      if (this.closed) return;

      const meta = { ...metadata?.(), ...context };
      const trace = observer.receive(event, meta, ++this.eventSequence);
      this.saveEvent(trace, meta);
    };
  }

  private saveEvent(trace: TraceEvent, metadata: AgentTraceMetadata) {
    this.store.put(trace.id, 'event', trace.sequence, trace, trace.runId);

    const step = createTraceStep(trace, metadata.tools, metadata.model);
    this.store.put(step.id, 'step', trace.sequence, step, trace.runId);
    this.stepChanges.set(step.id, step);
    this.scheduleFlush();

    for (const wake of this.wakeListeners) wake();
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

  private createEntry(sessionId: string, kind: TraceEntry['kind'], name: string): TraceEntry {
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

  private saveEntry(entry: TraceEntry) {
    this.store.put(entry.id, 'entry', entry.sequence, entry, entry.runId);
    if (entry.name === 'agent_start') {
      this.store.put(`run:${entry.id}`, 'run', entry.sequence, entry, entry.runId);
    }

    this.entries.set(entry.id, { ...entry });
    this.dirty.add(entry.id);

    // 淘汰只影响推送摘要的缓存，磁盘中的完整事件仍可按 ID 和游标查询。
    while (this.entries.size > this.capacity) {
      const id = this.entries.keys().next().value!;
      this.entries.delete(id);
      this.dirty.delete(id);
    }

    this.scheduleFlush();
  }

  // 将同一批 token 的摘要合并后推送，原始事件已即时落盘，不受节流影响。
  private scheduleFlush() {
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
