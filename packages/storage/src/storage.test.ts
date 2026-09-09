import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';

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

test('事件和投影原子提交，重复事件不会丢失后注册的投影', async () => {
  await using storage = await Storage.open({ dataDir: 'memory://' });
  const event = {
    type: 'message_end' as const,
    message: { role: 'user' as const, content: 'hello', timestamp: 1 },
  };
  const record = await storage.journal.record('session', event);
  const projected = await storage.journal.record('session', event, {}, async transaction => {
    await transaction.execute(sql`CREATE TABLE storage.projection (id text)`);
    await transaction.execute(sql`INSERT INTO storage.projection VALUES (${record.messageId!})`);
  });
  expect(projected.id).toBe(record.id);
  expect(await storage.journal.read()).toHaveLength(1);

  await expect(
    storage.journal.record('session', { type: 'agent_start' }, {}, async () => {
      throw new Error('projection failed');
    }),
  ).rejects.toThrow('projection failed');
  expect(await storage.journal.read()).toHaveLength(1);
  await expect(storage.journal.flush()).rejects.toThrow('projection failed');
}, 20_000);
