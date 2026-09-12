import { serialize, deserialize } from 'node:v8';

import type { Storage, StorageModule } from '@cieljs/storage';
import { sql } from 'drizzle-orm';

export const devtoolsStorage: StorageModule = {
  id: 'devtools',
  migrations: [
    {
      id: '0001',
      sql: `
 CREATE TABLE devtools.records (
   id text PRIMARY KEY,
   category text NOT NULL,
   sequence bigint NOT NULL,
   run_id text,
   value bytea NOT NULL
 );
 CREATE INDEX records_order ON devtools.records(category, sequence);
 CREATE INDEX records_run ON devtools.records(run_id, category, sequence);
`,
    },
    {
      id: '0002',
      sql: `
 ALTER TABLE devtools.records ADD COLUMN session_id text;
 CREATE INDEX records_session ON devtools.records(session_id, category, sequence);
`,
    },
  ],
};

export class TraceStore {
  private pending = Promise.resolve();
  private error: unknown;
  constructor(private readonly storage: Storage) {
    storage.require(devtoolsStorage);
  }
  async sequence() {
    const result = await this.storage.db.execute<{ n: string }>(
      sql`SELECT COALESCE(MAX(sequence), 0) AS n FROM devtools.records`,
    );
    return Number(result.rows[0]!.n);
  }
  put(
    id: string,
    category: string,
    sequence: number,
    value: unknown,
    runId?: string,
    sessionId?: string,
  ) {
    const bytes = serialize(snapshot(value));
    this.pending = this.pending
      .then(async () => {
        await this.storage.db.execute(
          sql`INSERT INTO devtools.records (id, category, sequence, run_id, value, session_id)
              VALUES (${id}, ${category}, ${sequence}, ${runId ?? null}, ${bytes}, ${sessionId ?? null})
              ON CONFLICT (id) DO UPDATE SET
                category = EXCLUDED.category,
                sequence = EXCLUDED.sequence,
                run_id = EXCLUDED.run_id,
                value = EXCLUDED.value,
                session_id = EXCLUDED.session_id`,
        );
      })
      .catch(error => {
        this.error = error;
      });
  }
  async get<T>(id: string): Promise<T | undefined> {
    await this.flush();
    const result = await this.storage.db.execute<{ value: Uint8Array; category: string }>(
      sql`SELECT category, value FROM devtools.records WHERE id = ${id}`,
    );
    const row = result.rows[0];
    if (!row) {
      const event = await this.storage.db.execute<{ record: T }>(
        sql`SELECT record FROM storage.events WHERE id = ${id}`,
      );
      return event.rows[0]?.record;
    }

    const value = deserialize(row.value);
    if (row.category === 'message_reference') {
      const message = await this.storage.db.execute<{ message: T }>(
        sql`SELECT record->'event'->'message' AS message FROM storage.events WHERE id = ${value}`,
      );
      return message.rows[0]?.message;
    }
    return value as T;
  }
  async list<T>(
    category: string,
    options: {
      after?: number;
      before?: number;
      limit?: number;
      runId?: string;
      sessionId?: string;
      ascending?: boolean;
    } = {},
  ): Promise<T[]> {
    await this.flush();
    const result = await this.storage.db.execute<{ value: Uint8Array }>(
      sql`SELECT value FROM devtools.records
          WHERE category = ${category}
            AND sequence > ${options.after ?? 0}
            AND sequence < ${options.before ?? Number.MAX_SAFE_INTEGER}
            AND (${options.runId ?? null}::text IS NULL OR run_id = ${options.runId ?? null})
            AND (${options.sessionId ?? null}::text IS NULL OR session_id = ${options.sessionId ?? null})
          ORDER BY sequence ${sql.raw(options.ascending ? 'ASC' : 'DESC')}
          LIMIT ${options.limit ?? 100}`,
    );
    const rows = options.ascending ? result.rows : result.rows.reverse();
    return rows.map(row => deserialize(row.value) as T);
  }
  async flush() {
    await this.pending;
    if (this.error) {
      const error = this.error;
      this.error = undefined;
      throw error;
    }
  }
  close() {
    return this.flush();
  }
}

function snapshot(value: unknown, seen = new Map<object, unknown>()): unknown {
  if (!value || typeof value !== 'object')
    return typeof value === 'function' ? '[Function]' : value;
  if (seen.has(value)) return seen.get(value);
  if (
    value instanceof Date ||
    value instanceof Error ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  )
    return value;
  if (value instanceof Map) {
    const result = new Map();
    seen.set(value, result);
    for (const [key, item] of value) result.set(snapshot(key, seen), snapshot(item, seen));
    return result;
  }
  if (value instanceof Set) {
    const result = new Set();
    seen.set(value, result);
    for (const item of value) result.add(snapshot(item, seen));
    return result;
  }
  const result: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (key === 'length' && Array.isArray(result)) continue;
    Object.defineProperty(result, key, {
      value: 'value' in descriptor ? snapshot(descriptor.value, seen) : '[Getter / Setter]',
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}
