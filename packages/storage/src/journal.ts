import { randomUUID } from 'node:crypto';

import type {
  AgentEvent,
  RuntimeMetadata,
  RuntimeReader,
  RuntimeRecord,
  RuntimeWriter,
} from '@cieljs/runtime-protocol';
import { asc, gt, sql } from 'drizzle-orm';

import { runtimeRecords } from './schema.ts';
import type { Database, Transaction } from './storage.ts';

interface Correlation {
  runId: string;
  turnId?: string;
  messageId?: string;
  calls: Map<string, string>;
}

export class RuntimeJournal implements RuntimeReader, RuntimeWriter {
  private readonly states = new Map<string, Correlation>();
  private readonly listeners = new Set<() => void>();
  private readonly seen = new WeakMap<AgentEvent, Map<string, Promise<RuntimeRecord>>>();
  private pending = Promise.resolve();
  private failure: unknown;
  private closed = false;

  constructor(private readonly db: Database) {}

  /** 同一事件对象可由多个观察器提交，但只持久化一次。投影在同一事务内提交。 */
  record(
    sessionId: string,
    event: AgentEvent,
    metadata: RuntimeMetadata = {},
    project?: (tx: Transaction, record: RuntimeRecord) => Promise<void>,
  ): Promise<RuntimeRecord> {
    if (this.closed) {
      return Promise.reject(new Error('RuntimeJournal 已关闭'));
    }
    const previous = this.seen.get(event)?.get(sessionId);
    if (previous) {
      if (!project) {
        return previous;
      }

      return previous.then(async record => {
        await this.db.transaction(transaction => project(transaction, record));
        return record;
      });
    }
    const state = this.states.get(sessionId) ?? {
      runId: randomUUID(),
      calls: new Map<string, string>(),
    };
    this.states.set(sessionId, state);
    if (event.type === 'agent_start') {
      state.runId = randomUUID();
      state.turnId = undefined;
      state.messageId = undefined;
      state.calls.clear();
    }
    if (event.type === 'turn_start') {
      state.turnId = randomUUID();
    }
    if (event.type === 'message_start' || (event.type.startsWith('message_') && !state.messageId))
      state.messageId = randomUUID();
    if ('message' in event && event.message.role === 'assistant') {
      for (const block of event.message.content) {
        if (block.type === 'toolCall' && state.messageId)
          state.calls.set(block.id, state.messageId);
      }
    }
    let toolCallId: string | undefined;
    if ('toolCallId' in event) {
      toolCallId = event.toolCallId;
    } else if ('message' in event && event.message.role === 'toolResult') {
      toolCallId = event.message.toolCallId;
    }

    let messageId: string | undefined;
    if (event.type.startsWith('message_')) {
      messageId = state.messageId;
    } else if (toolCallId) {
      messageId = state.calls.get(toolCallId);
    }
    // 事件中的 message 在流式生成时会被原地修改，入队前固定快照。
    const snapshot = structuredClone(event);
    const record: RuntimeRecord = {
      version: 1,
      id: randomUUID(),
      sequence: 0,
      sessionId,
      runId: state.runId,
      turnId: state.turnId,
      messageId,
      toolCallId,
      parentRunId: metadata.parentRunId,
      timestamp: Date.now(),
      event: snapshot,
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
    if (event.type === 'message_end') {
      state.messageId = undefined;
    }
    const operation = this.pending.then(async () => {
      await this.db.transaction(async tx => {
        const result = await tx.execute<{ sequence: number | string }>(
          sql`INSERT INTO storage.events (id, session_id, message_id, record)
              VALUES (${record.id}, ${sessionId}, ${messageId ?? null}, ${JSON.stringify(record)}::jsonb)
              RETURNING sequence`,
        );
        record.sequence = Number(result.rows[0]!.sequence);
        await tx.execute(
          sql`UPDATE storage.events SET record = ${JSON.stringify(record)}::jsonb WHERE id = ${record.id}`,
        );
        await project?.(tx, record);
      });
      for (const listener of this.listeners) listener();
      return record;
    });
    this.pending = operation.then(
      () => {},
      error => {
        this.failure = error;
      },
    );
    const entries = this.seen.get(event) ?? new Map<string, Promise<RuntimeRecord>>();
    entries.set(sessionId, operation);
    this.seen.set(event, entries);
    return operation;
  }

  async read(after = 0, limit = 100): Promise<RuntimeRecord[]> {
    const rows = await this.db
      .select()
      .from(runtimeRecords)
      .where(gt(runtimeRecords.sequence, after))
      .orderBy(asc(runtimeRecords.sequence))
      .limit(limit);
    return rows.map(row => row.record);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async flush() {
    let pending: Promise<void>;
    do {
      pending = this.pending;
      await pending;
    } while (pending !== this.pending);
    if (this.failure) {
      const error = this.failure;
      this.failure = undefined;
      throw error;
    }
  }

  async close() {
    this.closed = true;
    await this.flush();
    this.listeners.clear();
  }
}
