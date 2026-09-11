import { randomUUID } from 'node:crypto';

import type { RuntimeReader, RuntimeWriter } from '@cieljs/agent-kit/protocol';
import type { Storage } from '@cieljs/storage';
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';

import type { DevtoolsUpdate, TraceEntry, TraceEvent, ValueRef } from '../protocol/index.ts';
import { AgentTrace, type AgentTraceMetadata } from './agent-trace.ts';
import { TraceStore } from './store.ts';
import { preview } from './trace-content.ts';
import { createTraceStep } from './trace-step.ts';

/** 宿主保存独立的完整快照；内存列表淘汰不删除磁盘记录。 */
export class DevtoolsHost implements AsyncDisposable {
  private readonly observers = new Map<string, AgentTrace>();
  private projection = Promise.resolve();
  private cursor = 0;
  private unsubscribe?: () => void;
  private currentTrace?: TraceEvent;
  private currentEntrySequence?: number;
  private entryOrdinal = 0;
  private readonly entries = new Map<string, TraceEntry>();
  private readonly listeners = new Set<(update: DevtoolsUpdate) => void>();
  private readonly dirty = new Set<string>();
  private readonly stepChanges = new Map<string, TraceEntry>();
  private sequence = 0;
  readonly store: TraceStore;
  private eventSequence = 0;
  private readonly wakeListeners = new Set<() => void>();
  private closed = false;
  private closing?: Promise<void>;
  private readonly lifetime = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;

  get signal() {
    return this.lifetime.signal;
  }

  private constructor(
    readonly storage: Storage,
    private readonly source: RuntimeReader,
    private readonly writer: RuntimeWriter,
    private readonly capacity = 300,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('capacity 必须是正整数');
    this.store = new TraceStore(storage);
  }

  static async open(options: {
    storage: Storage;
    source?: RuntimeReader;
    writer?: RuntimeWriter;
    capacity?: number;
  }) {
    const host = new DevtoolsHost(
      options.storage,
      options.source ?? options.storage.journal,
      options.writer ?? options.storage.journal,
      options.capacity,
    );
    host.sequence = await host.store.sequence();
    host.unsubscribe = host.source.subscribe(() => {
      // 失败保留在 projection 中，由 flushRecords/close 向调用者报告。
      void host.catchUp().catch(() => {});
    });
    await host.catchUp();
    return host;
  }

  private catchUp() {
    this.projection = this.projection.then(async () => {
      while (!this.closed) {
        const records = await this.source.read(this.cursor);
        if (!records.length) return;
        for (const trace of records) {
          const entryId = trace.event.type.startsWith('message_')
            ? trace.messageId!
            : `${trace.id}:0`;
          const previous = await this.store.get<TraceEntry>(entryId);

          let observer = this.observers.get(trace.sessionId);
          if (!observer) {
            observer = new AgentTrace(trace.sessionId, {
              createEntry: (id, kind, name) => this.createEntry(id, kind, name),
              saveEntry: entry => this.saveEntry(entry),
              storeValue: (id, value) => this.storeValue(id, value),
            });
            this.observers.set(trace.sessionId, observer);
          }
          this.currentTrace = trace;
          this.currentEntrySequence = previous?.sequence;
          this.entryOrdinal = 0;
          this.eventSequence = trace.sequence;
          observer.receive(trace);
          this.saveEvent(trace, trace.metadata);
          this.currentTrace = undefined;
          this.currentEntrySequence = undefined;
          await this.store.flush();
          this.cursor = trace.sequence;
        }
      }
    });
    return this.projection;
  }

  async flushRecords() {
    await this.writer.flush();
    await this.catchUp();
    await this.store.flush();
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

  /** 展示感知输入，不伪造 Agent 事件，也不重复写入模型会话。 */
  recordMessage(label: string, content: string, sessionId: string) {
    const entry = this.createEntry(sessionId, 'message', 'perception');
    entry.label = label;
    entry.status = 'completed';
    entry.endedAt = Date.now();
    entry.output = this.storeValue(`${entry.id}:output`, content);
    this.saveEntry(entry);
  }

  observe(agent: Pick<Agent, 'subscribe' | 'state'>, sessionId: string) {
    const receive = this.agentListener(sessionId, () => ({
      tools: agent.state.tools,
      model: agent.state.model,
    }));
    return agent.subscribe(async event => {
      await receive(event);
    });
  }

  /** 创建独立的 Agent 事件归并器；宿主只分配序号并保存归并结果。 */
  agentListener(sessionId: string, metadata?: () => AgentTraceMetadata) {
    return (event: AgentEvent, context?: AgentTraceMetadata) => {
      if (this.closed) return;
      return this.writer.record(sessionId, event, { ...metadata?.(), ...context });
    };
  }

  private saveEvent(trace: TraceEvent, metadata: AgentTraceMetadata) {
    // 外部日志没有本地事件表记录，保留快照以支持同样的详情引用。
    if (this.source !== this.storage.journal) {
      this.store.put(trace.id, 'value', trace.sequence, trace);
    }
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
        const events = await this.source.read(afterSequence, 100);

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

  close(): Promise<void> {
    this.closing ??= this.closeResources();
    return this.closing;
  }

  private async closeResources() {
    this.unsubscribe?.();
    try {
      await this.flushRecords();
    } finally {
      this.closed = true;
      this.lifetime.abort();
      this.stepChanges.clear();
      for (const wake of this.wakeListeners) {
        wake();
      }
      clearTimeout(this.timer);
      this.listeners.clear();
      this.entries.clear();
      this.dirty.clear();
    }
  }

  [Symbol.asyncDispose]() {
    return this.close();
  }

  private createEntry(sessionId: string, kind: TraceEntry['kind'], name: string): TraceEntry {
    return {
      id: this.currentTrace ? `${this.currentTrace.id}:${this.entryOrdinal++}` : randomUUID(),
      // 对话投影与宿主感知共用顺序；原始 Agent 事件序号仅用于执行记录。
      // 重放只恢复投影状态，已有记录沿用原顺序，不能挤到新消息之后。
      sequence: this.currentEntrySequence ?? ++this.sequence,
      sessionId,
      kind,
      name,
      status: 'running',
      startedAt: this.currentTrace?.timestamp ?? Date.now(),
    };
  }

  private storeValue(id: string, value: unknown): ValueRef {
    const trace = this.currentTrace;
    const sharedMessage =
      this.source === this.storage.journal &&
      trace?.event.type.startsWith('message_') &&
      id === `${trace.messageId}:output`;

    if (sharedMessage && trace) {
      this.store.put(id, 'message_reference', this.eventSequence, trace.id);
    } else {
      this.store.put(id, 'value', this.eventSequence, value);
    }
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
