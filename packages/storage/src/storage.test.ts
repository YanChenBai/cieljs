import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { expect, test, vi } from 'vite-plus/test';

import { Storage, type StorageModule } from './storage.ts';

test('模块迁移隔离、重开幂等，失败迁移回滚并释放数据库', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ciel-storage-'));
  const first: StorageModule = {
    id: 'first',
    migrations: [{ id: '1', sql: 'CREATE TABLE first.items (id text PRIMARY KEY)' }],
  };
  const second: StorageModule = {
    id: 'second',
    migrations: [{ id: '1', sql: 'CREATE TABLE second.items (id text PRIMARY KEY)' }],
  };
  try {
    const storage = await Storage.open({ dataDir: directory, modules: [first, second] });
    await storage.db.execute(sql`INSERT INTO first.items VALUES ('first')`);
    await storage.close();

    await using reopened = await Storage.open({ dataDir: directory, modules: [second, first] });
    expect((await reopened.db.execute(sql`SELECT * FROM first.items`)).rows).toEqual([
      { id: 'first' },
    ]);
    expect((await reopened.db.execute(sql`SELECT * FROM second.items`)).rows).toEqual([]);
    await reopened.close();

    await expect(
      Storage.open({
        dataDir: directory,
        modules: [
          {
            id: 'broken',
            migrations: [{ id: '1', sql: 'CREATE TABLE broken.items (id text); INVALID SQL' }],
          },
        ],
      }),
    ).rejects.toThrow();
    await using recovered = await Storage.open({ dataDir: directory });
    expect(
      (await recovered.db.execute(sql`SELECT to_regclass('broken.items') AS name`)).rows,
    ).toEqual([{ name: null }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('checkpoint 可随时推进，关闭后再推进是空操作', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ciel-storage-'));
  try {
    const storage = await Storage.open({ dataDir: directory });
    await storage.db.execute(sql`CREATE TABLE public.items (id text PRIMARY KEY)`);
    await storage.db.execute(sql`INSERT INTO public.items VALUES ('kept')`);
    await storage.checkpoint();
    await storage.close();
    await storage.checkpoint();

    await using reopened = await Storage.open({ dataDir: directory });
    expect((await reopened.db.execute(sql`SELECT * FROM public.items`)).rows).toEqual([
      { id: 'kept' },
    ]);
    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);

test('事件和投影原子提交，重复观察同一事件不会重复落盘', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });
  const event = {
    type: 'message_end' as const,
    message: { role: 'user' as const, content: 'hello', timestamp: 1 },
  };
  const first = await storage.events.publish('session', event);
  const record = (await storage.journal.read())[0]!;
  const projected = await storage.events.publishWithProject('session', event, {}, async transaction => {
    await transaction.execute(sql`CREATE TABLE storage.projection (id text)`);
    await transaction.execute(sql`INSERT INTO storage.projection VALUES (${record.messageId!})`);
  });
  expect(projected.id).toBe(first.id);
  expect(await storage.journal.read()).toHaveLength(1);

  await expect(
    storage.events.publishWithProject('session', { type: 'agent_start' }, {}, async () => {
      throw new Error('projection failed');
    }),
  ).rejects.toThrow('projection failed');
  expect(await storage.journal.read()).toHaveLength(1);
  await expect(storage.journal.flush()).rejects.toThrow('projection failed');
}, 20_000);

test('update 实时分发但不进入 durable journal，start/end 共享稳定实体 ID', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });
  const listener = vi.fn();
  storage.events.subscribe(listener);

  const message = { role: 'assistant' as const, content: [], timestamp: 1 };
  const start = await storage.events.publish('session', {
    type: 'message_start',
    message,
  });
  const update = await storage.events.publish('session', {
    type: 'message_update',
    message,
    // 这里只验证 Runtime 的生命周期语义，不绑定 pi-ai 某一版 delta 的附加字段。
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' } as never,
  });
  const end = await storage.events.publish('session', {
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'hello' }],
      timestamp: 1,
      api: 'openai-completions',
      provider: 'test',
      model: 'test',
      stopReason: 'stop',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  });

  expect(listener).toHaveBeenCalledTimes(3);
  expect(start.messageId).toBeTruthy();
  expect(update.messageId).toBe(start.messageId);
  expect(end.messageId).toBe(start.messageId);
  expect((await storage.journal.read()).map(record => record.event.type)).toEqual([
    'message_start',
    'message_end',
  ]);
});

test('复用同一 update 对象时，内容 mutation 仍会持续实时发布', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });
  const listener = vi.fn();
  storage.events.subscribe(listener);

  const message = {
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text: 'a' }],
    timestamp: 1,
  };
  const update = {
    type: 'message_update' as const,
    message,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'a' } as never,
  };

  const first = await storage.events.publish('session', update);
  const duplicate = await storage.events.publish('session', update);
  expect(duplicate.id).toBe(first.id);

  message.content[0]!.text = 'ab';
  (update.assistantMessageEvent as { delta: string }).delta = 'b';
  const second = await storage.events.publish('session', update);

  expect(second.id).not.toBe(first.id);
  expect(second.revision).toBeGreaterThan(first.revision);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(await storage.journal.read()).toEqual([]);
});

test('事件首次写入即持久化生成后的序号', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });
  const envelope = await storage.events.publish('session', {
    type: 'message_end',
    message: { role: 'user', content: 'hello', timestamp: 1 },
  });
  const record = (await storage.journal.read())[0]!;

  const result = await storage.db.execute<{ sequence: number; storedSequence: number }>(sql`
    SELECT sequence, (record->>'sequence')::bigint AS "storedSequence"
    FROM storage.events
    WHERE id = ${envelope.id}
  `);

  expect(result.rows).toEqual([{ sequence: record.sequence, storedSequence: record.sequence }]);
});

test('关闭等待进行中的事件提交并拒绝后续写入', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ciel-storage-'));
  let markTransactionStarted!: () => void;
  const transactionStarted = new Promise<void>(resolve => {
    markTransactionStarted = resolve;
  });
  let releaseTransaction!: () => void;
  const transactionPending = new Promise<void>(resolve => {
    releaseTransaction = resolve;
  });

  try {
    const storage = await Storage.open({ dataDir: directory });
    const recording = storage.events.publishWithProject(
      'session',
      { type: 'agent_start' },
      {},
      async () => {
        markTransactionStarted();
        await transactionPending;
      },
    );
    await transactionStarted;

    const closing = storage.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });

    await Promise.resolve();
    expect(closed).toBe(false);
    await expect(storage.events.publish('session', { type: 'agent_start' })).rejects.toThrow(
      '已关闭',
    );

    releaseTransaction();
    const envelope = await recording;
    await closing;

    await using reopened = await Storage.open({ dataDir: directory });
    expect((await reopened.journal.read()).map(item => item.id)).toEqual([envelope.id]);
  } finally {
    releaseTransaction();
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
