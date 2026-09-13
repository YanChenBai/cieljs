import { Storage } from '@cieljs/storage';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { afterAll } from 'vite-plus/test';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { defineCiel } from '../src/index.ts';

const { opened, closed, failOpening, failClosing } = vi.hoisted(() => ({
  opened: [] as string[],
  closed: [] as string[],
  failOpening: vi.fn((_name: string) => {}),
  failClosing: vi.fn(async (_name: string) => {}),
}));

function resource(name: string) {
  opened.push(name);
  failOpening(name);
  return {
    async [Symbol.asyncDispose]() {
      closed.push(name);
      await failClosing(name);
    },
  };
}
vi.mock('@cieljs/session', () => ({
  SessionManager: { open: async (options: { namespace: string }) => resource(options.namespace) },
}));
vi.mock('@cieljs/memory', () => ({
  MemoryManager: { open: async () => resource('memory') },
}));
const faux = registerFauxProvider();
const options = {
  model: faux.getModel(),
  systemPrompt: 'test',
  storage: await Storage.open({ dataDir: 'memory://' }),
  mcp: { tools: [] },
};
afterEach(() => {
  opened.length = 0;
  closed.length = 0;
  failOpening.mockReset();
  failClosing.mockReset();
});

test('成功启动转移资源所有权，关闭失败仍逆序释放全部资源', async () => {
  const ciel = defineCiel(options);
  await ciel.start();
  expect(closed).toEqual([]);
  const failure = new Error('investigation close');
  failClosing.mockImplementation(async name => {
    if (name === 'memory') throw failure;
  });
  const closing = ciel.close();
  expect(ciel.close()).toBe(closing);
  expect(ciel[Symbol.asyncDispose]()).toBe(closing);
  await expect(closing).rejects.toMatchObject({ errors: [failure] });
  expect(closed).toEqual(['memory', 'investigation', 'session']);
  expect(ciel.status).toBe('closed');
});

test.each(['session', 'investigation', 'memory'])(
  '%s 启动失败回收此前资源，之后允许重试',
  async name => {
    const failure = new Error('open');
    failOpening.mockImplementation(value => {
      if (value === name) throw failure;
    });
    const ciel = defineCiel(options);
    await expect(ciel.start()).rejects.toBe(failure);
    expect(closed).toEqual(opened.slice(0, -1).reverse());
    expect(ciel.status).toBe('idle');
    failOpening.mockReset();
    await ciel.start();
    await ciel.close();
  },
);

test('启动错误与回滚错误均保留，其他资源继续回收', async () => {
  const openingError = new Error('memory open');
  const closingError = new Error('memory close');
  failOpening.mockImplementation(name => {
    if (name === 'memory') throw openingError;
  });
  failClosing.mockImplementation(async name => {
    if (name === 'investigation') throw closingError;
  });
  const ciel = defineCiel(options);
  await expect(ciel.start()).rejects.toMatchObject({
    name: 'SuppressedError',
    error: closingError,
    suppressed: openingError,
  });
  expect(closed).toEqual(['investigation', 'session']);
  await ciel.close();
});

afterAll(() => options.storage.close());

test('启动失败与关闭并发时仍进入终态', async () => {
  failOpening.mockImplementation(name => {
    if (name === 'memory') throw new Error('memory open');
  });
  const ciel = defineCiel(options);
  const starting = ciel.start();
  const failure = expect(starting).rejects.toThrow('memory open');
  const closing = ciel.close();
  await failure;
  await closing;
  expect(ciel.status).toBe('closed');
  await expect(ciel.start()).rejects.toThrow('关闭');
});
