import { afterEach, expect, test, vi } from 'vite-plus/test';

import { EmbeddingIndex } from '../src/embedding-index.ts';
import { SessionManager } from '../src/session-manager.ts';

const { client } = vi.hoisted(() => ({
  client: {
    waitReady: Promise.resolve(),
    exec: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  },
}));

vi.mock('../src/database.ts', () => ({ createDatabase: () => ({ client, db: {} }) }));
vi.mock('drizzle-orm/pglite/migrator', () => ({ migrate: vi.fn(async () => {}) }));

afterEach(() => {
  vi.restoreAllMocks();
  client.exec.mockReset();
  client.close.mockReset();
});

test('初始化和回滚都失败时保留两个错误', async () => {
  const openingError = new Error('opening');
  const closingError = new Error('closing');
  client.exec.mockRejectedValueOnce(openingError);
  client.close.mockRejectedValueOnce(closingError);

  await expect(SessionManager.open({ dataDir: 'test' })).rejects.toMatchObject({
    name: 'SuppressedError',
    error: closingError,
    suppressed: openingError,
  });
  expect(client.close).toHaveBeenCalledTimes(1);
});

test('索引刷新失败仍关闭数据库，并保留两个错误', async () => {
  const manager = await SessionManager.open({ dataDir: 'test' });
  expect(client.close).not.toHaveBeenCalled();
  const flushError = new Error('flush');
  const closingError = new Error('closing');
  vi.spyOn(EmbeddingIndex.prototype, 'flush').mockRejectedValueOnce(flushError);
  client.close.mockRejectedValueOnce(closingError);

  const closing = manager.close();
  expect(manager.close()).toBe(closing);
  expect(manager[Symbol.asyncDispose]()).toBe(closing);
  expect(() => manager.space('test')).toThrow();
  await expect(closing).rejects.toMatchObject({
    name: 'SuppressedError',
    error: closingError,
    suppressed: flushError,
  });
  expect(client.close).toHaveBeenCalledTimes(1);
});

test('并发关闭等待索引刷新结束，再释放数据库', async () => {
  const manager = await SessionManager.open({ dataDir: 'test' });
  let release = () => {};
  const pending = new Promise<void>(resolve => {
    release = resolve;
  });
  vi.spyOn(EmbeddingIndex.prototype, 'flush').mockReturnValueOnce(pending);
  const closing = manager.close();
  expect(manager.close()).toBe(closing);
  await Promise.resolve();
  expect(client.close).not.toHaveBeenCalled();
  release();
  await closing;
  expect(client.close).toHaveBeenCalledTimes(1);
});
