import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';

import { Storage } from '@cieljs/storage';
import { RPCLink } from '@orpc/client/message-port';
import { createRouterClient } from '@orpc/server';
import type { RouterClient } from '@orpc/server';
import { RPCHandler } from '@orpc/server/message-port';
import { afterEach, expect, it } from 'vite-plus/test';

import { createDevtoolsClient } from '../client/index.ts';
import type { TraceEntry } from '../protocol/index.ts';
import { DevtoolsHost } from './host.ts';
import { createDevtoolsRouter } from './router.ts';
import { devtoolsStorage } from './store.ts';
const cleanup: (() => void | Promise<void>)[] = [];
async function openHost(capacity?: number, directory = 'memory://') {
  const storage = await Storage.open({ dataDir: directory, modules: [devtoolsStorage] });
  const host = await DevtoolsHost.open({ storage, capacity });
  cleanup.push(async () => {
    await host.close();
    await storage.close();
  });
  return host;
}
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it('运行日志的消息输出、工具输入输出和原始事件均可通过详情接口读取', async () => {
  const host = await openHost();
  const receive = host.agentListener('session');
  const message = { role: 'user' as const, content: '查看房间', timestamp: 0 };
  await receive({ type: 'message_start', message });
  await receive({ type: 'message_end', message });
  await receive({
    type: 'tool_execution_start',
    toolCallId: 'call',
    toolName: 'search',
    args: { query: '直播' },
  });
  await receive({
    type: 'tool_execution_end',
    toolCallId: 'call',
    toolName: 'search',
    result: { hits: [] },
    isError: false,
  });
  await host.flushRecords();

  const client = createRouterClient(createDevtoolsRouter(host));
  const steps = await host.store.list<TraceEntry>('step');
  expect(await client.values.get(steps[1]!.output!)).toEqual(message);
  expect(await client.values.get(steps[2]!.input!)).toEqual({ query: '直播' });
  expect(await client.values.get(steps[3]!.output!)).toEqual({ hits: [] });
  expect(await client.values.get(steps[3]!.raw!)).toMatchObject({
    event: { type: 'tool_execution_end' },
  });
  const entries = await host.store.list<TraceEntry>('entry');
  expect(entries.filter(entry => entry.kind === 'message')).toHaveLength(1);
});

it('完整保存多轮事件、稳定消息 ID 和 toolCallId，快照不随原对象变化', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const receive = host.agentListener('session');
  const message = {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: 'x'.repeat(20000) }],
    timestamp: 0,
  };
  receive({ type: 'agent_start' });
  receive({ type: 'turn_start' });
  receive({ type: 'message_start', message });
  receive({ type: 'message_end', message });
  receive({
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'search',
    args: { text: 'hello' },
  });
  receive({
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'search',
    result: { content: [{ type: 'text', text: 'result' }] },
    isError: false,
  });
  receive({ type: 'turn_end', message, toolResults: [] });
  receive({ type: 'turn_start' });
  receive({ type: 'message_start', message });
  receive({ type: 'message_end', message });
  receive({ type: 'turn_end', message, toolResults: [] });
  receive({ type: 'agent_end', messages: [message] });
  message.content = [];
  await host.flushRecords();
  const events = await host.storage.journal.read();
  expect(events.map(item => item.event.type)).toEqual([
    'agent_start',
    'turn_start',
    'message_start',
    'message_end',
    'tool_execution_start',
    'tool_execution_end',
    'turn_end',
    'turn_start',
    'message_start',
    'message_end',
    'turn_end',
    'agent_end',
  ]);
  expect(new Set(events.map(item => item.runId)).size).toBe(1);
  expect(events[2]!.messageId).toBe(events[3]!.messageId);
  expect(events[2]!.turnId).not.toBe(events[8]!.turnId);
  expect(events[4]!.toolCallId).toBe('call-1');
  const entries = await host.store.list<TraceEntry>('entry');
  expect(entries.find(entry => entry.kind === 'message')!.text).toHaveLength(20000);
  expect(await host.store.get(`${events[2]!.messageId}:output`)).toMatchObject({
    content: [{ text: 'x'.repeat(20000) }],
  });
  const controller = new AbortController();
  const stream = host.events(events[10]!.sequence, controller.signal);
  expect((await stream.next()).value?.event.type).toBe('agent_end');
  const pending = stream.next();
  controller.abort();
  expect((await pending).done).toBe(true);
});

it('淘汰后与宿主重启后均可按 ID 回读原始图片', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ciel-trace-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const host = await openHost(1, directory);
  host.record('image', { type: 'image', mimeType: 'image/png', data: 'a'.repeat(100000) });
  const entry = (await host.store.list<TraceEntry>('entry'))[0]!;
  host.record('next', 'hello');
  await host.close();
  await host.storage.close();
  const reopened = await openHost(1, directory);
  cleanup.push(() => reopened.close());
  expect(await reopened.store.get(entry.output!.id)).toMatchObject({ data: 'a'.repeat(100000) });
});

it('重放保留消息与宿主记录的顺序，随后新增消息使用更大的序号', async () => {
  const host = await openHost();
  const receive = host.agentListener('replay');
  const message = { role: 'user' as const, content: '第一条', timestamp: 0 };
  await receive({ type: 'agent_start' });
  await receive({ type: 'message_start', message });
  await host.flushRecords();
  host.record('perception', '听觉输入');
  await receive({ type: 'message_end', message });
  await receive({ type: 'agent_end', messages: [message] });
  await host.flushRecords();
  const before = await host.store.list<TraceEntry>('entry');
  await host.close();

  const reopened = await DevtoolsHost.open({ storage: host.storage });
  cleanup.push(() => reopened.close());
  expect(await reopened.store.list('entry')).toEqual(before);
  await reopened.agentListener('replay')({
    type: 'message_end',
    message: { ...message, content: '第二条' },
  });
  await reopened.flushRecords();
  const after = await reopened.store.list<TraceEntry>('entry');
  expect(after.slice(0, -1)).toEqual(before);
  expect(after.at(-1)!.sequence).toBeGreaterThan(Math.max(...before.map(entry => entry.sequence)));
});

it('oRPC MessagePort 可读取完整内容和取消更新订阅', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const router = createDevtoolsRouter(host);
  const handler = new RPCHandler(router);
  const channel = new MessageChannel();
  cleanup.push(() => {
    channel.port1.close();
    channel.port2.close();
  });
  handler.upgrade(channel.port1);
  channel.port1.start();
  channel.port2.start();
  const client: RouterClient<typeof router> = createDevtoolsClient(
    new RPCLink({ port: channel.port2 }),
  );
  host.record('hello', '完整输出');
  const entries = await client.entries.list({ limit: 10 });
  expect(await client.values.get({ id: entries[0]!.output!.id })).toBe('完整输出');
  const controller = new AbortController();
  const stream = await client.updates(undefined, { signal: controller.signal });
  expect((await stream.next()).value?.entries).toHaveLength(1);
  controller.abort();
  await stream.return?.(undefined);
  await handler.close(channel.port1);
});

it('宿主关闭会结束等待中的更新订阅', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const client = createRouterClient(createDevtoolsRouter(host));
  const updates = await client.updates();
  await updates.next();
  const pending = updates.next();
  host.close();
  expect((await pending).done).toBe(true);
});

it('缺少工具 start 的 update 仍保存原始事件', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  host.agentListener('late')({
    type: 'tool_execution_update',
    toolCallId: 'unknown',
    toolName: 'search',
    args: {},
    partialResult: { text: '部分结果' },
  });
  await host.flushRecords();
  const events = await host.storage.journal.read();
  expect(events).toHaveLength(1);
  expect(events[0]?.toolCallId).toBe('unknown');
});

it('两个观察器交错执行时保持独立的消息和 run 关联', async () => {
  const host = await openHost();
  cleanup.push(() => host.close());
  const first = host.agentListener('first');
  const second = host.agentListener('second');
  const message = { role: 'user' as const, content: 'hello', timestamp: 0 };
  first({ type: 'agent_start' });
  second({ type: 'agent_start' });
  first({ type: 'message_start', message });
  second({ type: 'message_start', message });
  first({ type: 'message_end', message });
  second({ type: 'message_end', message });
  await host.flushRecords();
  const events = await host.storage.journal.read();
  const a = events.filter(event => event.sessionId === 'first');
  const b = events.filter(event => event.sessionId === 'second');
  expect(a[1]?.messageId).toBe(a[2]?.messageId);
  expect(b[1]?.messageId).toBe(b[2]?.messageId);
  expect(a[1]?.messageId).not.toBe(b[1]?.messageId);
  expect(a[0]?.runId).not.toBe(b[0]?.runId);
});
