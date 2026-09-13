import { createRouterClient } from '@orpc/server';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  investigate: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  defineCiel: vi.fn(),
  completeSimple: vi.fn(),
}));

vi.mock('cieljs', () => ({ defineCiel: mocks.defineCiel }));
vi.mock('@earendil-works/pi-ai/compat', () => ({ completeSimple: mocks.completeSimple }));

import type { RoomInfo } from '../../shared/types.ts';
import { createInvestigationRoutes } from './investigation.ts';

const room: RoomInfo = {
  roomId: 123,
  streamerUid: 456,
  streamerName: '测试主播',
  title: '测试直播间',
  description: '',
  parentAreaName: '娱乐',
  areaName: '虚拟主播',
  live: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.defineCiel.mockReturnValue({
    start: mocks.start,
    investigate: mocks.investigate,
    close: mocks.close,
  });
  mocks.completeSimple.mockResolvedValue({
    stopReason: 'stop',
    content: [{ type: 'text', text: '跨直播间观看比较' }],
  });
});

function createRoutes(current: { room?: RoomInfo; sessionId?: string } = {}) {
  return createInvestigationRoutes({
    storage: {} as never,
    resolveModel: () => ({ model: { id: 'test' } as never }),
    api: { room: vi.fn(async () => room) } as never,
    current: () => current,
  });
}

it('全局调查只绑定全局目标，并获得显式 Memory 写权限', async () => {
  const routes = createRoutes();
  const client = createRouterClient(routes.router);
  const conversation = await client.create({ target: { type: 'global' } });

  expect(await client.list()).toEqual([conversation]);
  expect(conversation.sessionId).toMatch(/^investigation:global:/u);

  const updates = await client.updates();
  const iterator = updates[Symbol.asyncIterator]();
  const provisionalUpdate = iterator.next();

  const updated = await client.prompt({
    sessionId: conversation.sessionId,
    content: '比较所有直播间',
  });

  expect(await provisionalUpdate).toEqual({
    done: false,
    value: {
      type: 'title_updated',
      sessionId: conversation.sessionId,
      title: '比较所有直播间',
    },
  });
  await expect(iterator.next()).resolves.toEqual({
    done: false,
    value: {
      type: 'title_updated',
      sessionId: conversation.sessionId,
      title: '跨直播间观看比较',
    },
  });
  expect(updated.title).toBe('跨直播间观看比较');
  expect(
    (await client.rename({ sessionId: conversation.sessionId, title: '今日直播总结' })).title,
  ).toBe('今日直播总结');

  expect(mocks.investigate).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: conversation.sessionId,
      target: { type: 'global' },
      question: '比较所有直播间',
      memoryAccess: 'read-write',
      crossSpace: true,
    }),
  );
  await routes.close();
  expect(mocks.close).toHaveBeenCalledOnce();
});

it('房间调查绑定目标空间，当前房间同时绑定正在观看的 Session', async () => {
  const routes = createRoutes({ room, sessionId: 'room-session' });
  const client = createRouterClient(routes.router);
  const conversation = await client.create({ target: { type: 'room', roomId: room.roomId } });

  expect(conversation.label).toBe('测试主播 · 测试直播间');
  await client.prompt({ sessionId: conversation.sessionId, content: '分析这个房间' });

  expect(mocks.investigate).toHaveBeenCalledWith(
    expect.objectContaining({
      target: {
        type: 'space',
        spaceId: 'bilibili:room:123',
        sessionId: 'room-session',
      },
      sources: expect.arrayContaining(['bilibili:room:123', 'bilibili:streamer:456']),
    }),
  );
});

it('同一调查拒绝并发回答', async () => {
  let finish: (() => void) | undefined;
  mocks.investigate.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const routes = createRoutes();
  const client = createRouterClient(routes.router);
  const conversation = await client.create({ target: { type: 'global' } });
  const first = client.prompt({ sessionId: conversation.sessionId, content: '第一条' });

  await vi.waitFor(() => expect(mocks.investigate).toHaveBeenCalledOnce());
  await expect(
    client.prompt({ sessionId: conversation.sessionId, content: '第二条' }),
  ).rejects.toThrow('正在回答');

  finish?.();
  await first;
});

it('从 DevTools 历史恢复 Investigation 会话并允许继续提问', async () => {
  const routes = createInvestigationRoutes({
    storage: {} as never,
    resolveModel: () => ({ model: { id: 'test' } as never }),
    api: { room: vi.fn(async () => room) } as never,
    current: () => ({}),
    history: () => [{ id: 'investigation:global:history', startedAt: 10 }],
  });
  const client = createRouterClient(routes.router);

  expect(await client.list()).toEqual([
    expect.objectContaining({
      sessionId: 'investigation:global:history',
      title: '全局调查',
      createdAt: 10,
    }),
  ]);
  await client.prompt({ sessionId: 'investigation:global:history', content: '继续分析' });

  expect(mocks.investigate).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: 'investigation:global:history',
      target: { type: 'global' },
    }),
  );
});
