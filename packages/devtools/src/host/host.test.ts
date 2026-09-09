import { Storage } from '@cieljs/storage';
import { createRouterClient } from '@orpc/server';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { TraceEntry } from '../protocol/index.ts';
import { DevtoolsHost } from './host.ts';
import { createDevtoolsRouter } from './router.ts';
import { devtoolsStorage } from './store.ts';

const hosts: DevtoolsHost[] = [];
async function host(capacity?: number) {
  const storage = await Storage.open({ dataDir: 'memory://', modules: [devtoolsStorage] });
  const value = await DevtoolsHost.open({ storage, capacity });
  hosts.push(value);
  return value;
}
async function entries(value: DevtoolsHost): Promise<TraceEntry[]> {
  await value.flushRecords();
  return value.store.list<TraceEntry>('entry');
}
afterEach(async () => {
  for (const value of hosts) {
    await value.close();
    await value.storage.close();
  }
  hosts.length = 0;
  vi.useRealTimers();
});

describe('DevTools 按需内容', () => {
  it('大对象、循环引用和二进制不会进入事件消息', async () => {
    const value = await host();
    const data: Record<string, unknown> = {
      image: { type: 'image', mimeType: 'image/png', data: 'x'.repeat(200_000) },
      buffer: new Uint8Array(10_000),
    };
    data.self = data;
    value.record('frame', data);
    const snapshot = await entries(value);
    expect(JSON.stringify(snapshot).length).toBeLessThan(500);
    const id = snapshot[0]!.output!.id;
    const client = createRouterClient(createDevtoolsRouter(value));
    expect(await client.values.get({ id, path: ['image'] })).toMatchObject({
      data: 'x'.repeat(200_000),
    });
    expect(await client.values.get({ id, path: ['buffer'] })).toBeInstanceOf(Uint8Array);
    const stored = (await value.store.get<Record<string, unknown>>(id))!;
    expect(stored.self).toBe(stored);
  });

  it('内容读取不执行 getter，并拒绝原型路径', async () => {
    const value = await host();
    const getter = vi.fn(() => 'secret');
    const data = Object.fromEntries(
      Array.from({ length: 250 }, (_, index) => [String(index), index]),
    );
    Object.defineProperty(data, 'secret', { get: getter });
    value.record('large', data);
    const id = (await entries(value))[0]!.output!.id;
    const client = createRouterClient(createDevtoolsRouter(value));
    expect(await client.values.get({ id, path: ['secret'] })).toBe('[Getter / Setter]');
    await expect(client.values.get({ id, path: ['__proto__'] })).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
  });

  it('内存淘汰后仍可从存储读取完整内容', async () => {
    const value = await host(1);
    value.record('first', { text: 'one' });
    const first = (await entries(value))[0]!.output!.id;
    value.record('second', { text: 'two' });
    const client = createRouterClient(createDevtoolsRouter(value));
    expect(await client.values.get({ id: first })).toEqual({ text: 'one' });
  });

  it('流式更新合并同一条消息，工具输入输出可追踪', async () => {
    const value = await host();
    vi.useFakeTimers();
    const listener = vi.fn();
    value.subscribe(listener);
    const receive = value.agentListener('room:1');
    receive({
      type: 'tool_execution_start',
      toolCallId: 'call:1',
      toolName: 'search',
      args: { query: '主播' },
    });
    receive({
      type: 'tool_execution_end',
      toolCallId: 'call:1',
      toolName: 'search',
      result: { found: true },
      isError: false,
    });
    await value.flushRecords();
    vi.advanceTimersByTime(60);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((await entries(value))[0]).toMatchObject({
      kind: 'tool',
      status: 'completed',
      input: { preview: 'Object' },
      output: { preview: 'Object' },
    });
  });

  it('非法分页位置由 oRPC schema 拒绝', async () => {
    const client = createRouterClient(createDevtoolsRouter(await host()));
    await expect(client.steps.list({ cursor: -1 })).rejects.toThrow();
  });
});
