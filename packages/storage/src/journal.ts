import type {
  RuntimeEventEnvelope,
  RuntimeReader,
  RuntimeRecord,
} from '@cieljs/agent-kit/protocol';
import { asc, gt, sql } from 'drizzle-orm';

import { runtimeRecords } from './schema.ts';
import type { Database, Transaction } from './storage.ts';

export type RuntimeProjector = (tx: Transaction, record: RuntimeRecord) => Promise<void>;

/** Durable journal：只负责事实追加、读取和唤醒，不理解 Agent 生命周期。 */
export class RuntimeJournal implements RuntimeReader {
  private readonly listeners = new Set<() => void>();
  private pending = Promise.resolve();
  private failure: unknown;
  private closed = false;

  constructor(private readonly db: Database) {}

  record(envelope: RuntimeEventEnvelope, project?: RuntimeProjector): Promise<RuntimeRecord> {
    if (this.closed) {
      return Promise.reject(new Error('RuntimeJournal 已关闭'));
    }

    // Live envelope 可能仍被观察者持有；入队前固定完整快照。
    const record: RuntimeRecord = {
      ...structuredClone(envelope),
      sequence: 0,
    };

    const operation = this.pending.then(async () => {
      await this.db.transaction(async tx => {
        const result = await tx.execute<{ sequence: number | string }>(sql`
          SELECT nextval(pg_get_serial_sequence('storage.events', 'sequence')) AS sequence
        `);
        const sequence = Number(result.rows[0]!.sequence);
        record.sequence = sequence;
        record.revision = sequence;

        await tx.execute(
          sql`INSERT INTO storage.events (id, sequence, session_id, message_id, record)
              OVERRIDING SYSTEM VALUE
              VALUES (${record.id}, ${record.sequence}, ${record.sessionId}, ${record.messageId ?? null}, ${JSON.stringify(record)}::jsonb)`,
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
    return operation;
  }

  project(record: RuntimeRecord, project: RuntimeProjector): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('RuntimeJournal 已关闭'));
    }
    return this.db.transaction(transaction => project(transaction, record));
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
