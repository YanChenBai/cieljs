import { Storage } from '@cieljs/storage';
import { afterAll } from 'vite-plus/test';
const storage = await Storage.open({ dataDir: 'memory://' });
afterAll(() => storage.close());
import type { DevtoolsHost } from '@cieljs/devtools/host';
import type { ASRResult } from '@cieljs/hearing';
import type { Perception } from '@cieljs/perception';
import type { OpenSessionOptions } from '@cieljs/runtime';
import { registerFauxProvider } from '@earendil-works/pi-ai/compat';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { BilibiliApi } from './bilibili/api.ts';
import type { LivePage } from './bilibili/live-page.ts';
import type { LiveMediaOptions } from './media/live-media.ts';
import { createWatchBlive, type WatchBlive } from './runtime.ts';

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  close: vi.fn(),
  session: vi.fn(),
  investigate: vi.fn(),
  mediaOptions: [] as LiveMediaOptions[],
  mediaStart: vi.fn(),
  mediaClose: vi.fn(),
}));
vi.mock('@cieljs/runtime', () => ({ defineCiel: () => mocks }));
vi.mock('@cieljs/perception', () => ({ createPerception: vi.fn() }));
vi.mock('./bilibili/api.ts', () => ({ BilibiliApi: class {} }));
vi.mock('./bilibili/live-page.ts', () => ({ LivePage: class {} }));
vi.mock('./media/live-media.ts', () => ({
  LiveMedia: class {
    get endAt() {
      return new Date(Date.now() + 120_000);
    }
    constructor(options: LiveMediaOptions) {
      mocks.mediaOptions.push(options);
    }
    start = mocks.mediaStart;
    close = mocks.mediaClose;
  },
}));

const room = {
  roomId: 123,
  streamerUid: 456,
  streamerName: '主播',
  title: '聊天',
  description: '',
  parentAreaName: '娱乐',
  areaName: '聊天',
  live: true,
};
let runtime: WatchBlive;
let faux: ReturnType<typeof registerFauxProvider>;

function setup(devtools?: DevtoolsHost) {
  faux = registerFauxProvider();
  const sessionClose = vi.fn().mockResolvedValue(undefined);
  mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
    id: options.sessionId,
    spaceId: options.spaceId,
    agent: { abort: vi.fn(), prompt: vi.fn(), state: { messages: [] } },
    close: sessionClose,
  }));
  const perceptionClose = vi.fn().mockResolvedValue(undefined);
  const setModel = vi.fn().mockResolvedValue(undefined);
  const asrOn = vi.fn(() => vi.fn());
  const perception = {
    asr: { on: asrOn, setModel },
    close: perceptionClose,
    on: vi.fn(() => vi.fn()),
    snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }),
  } as unknown as Perception;
  const page = {
    liveStatus: vi.fn().mockResolvedValue('live'),
    account: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    readiness: vi.fn().mockResolvedValue({ ready: true, roomId: room.roomId }),
  };
  const api = {
    roomByStreamer: vi.fn().mockResolvedValue(room),
    playUrl: vi.fn().mockResolvedValue('https://example.com/live'),
    rooms: vi.fn().mockResolvedValue([room]),
    room: vi.fn().mockResolvedValue(room),
    streamerHistory: vi.fn().mockResolvedValue({ dynamics: [], videos: [] }),
  };
  runtime = createWatchBlive({
    devtools,
    storage,
    model: faux.getModel(),
    livePage: page as unknown as LivePage,
    api: api as unknown as BilibiliApi,
    createPerception: () => perception,
  });
  return { page, api, sessionClose, perceptionClose, setModel, asrOn };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mediaOptions.length = 0;
});
afterEach(async () => {
  await runtime?.close();
  faux?.unregister();
  vi.useRealTimers();
});

describe('观看生命周期', () => {
  it('视频对话保留无转写文本的声音事件', async () => {
    const recordMessage = vi.fn();
    const { asrOn } = setup({ observe: vi.fn(), recordMessage } as unknown as DevtoolsHost);
    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });
    const calls = asrOn.mock.calls as unknown as [string, (result: ASRResult) => void][];
    const receive = calls.find(([event]) => event === 'result')![1];
    receive({
      content: '',
      events: [{ type: 'applause' }],
      startAt: new Date(),
      endAt: new Date(),
    });
    expect(recordMessage).toHaveBeenCalledWith(
      expect.stringContaining('视频语音'),
      '声音事件（模型识别）：applause',
      expect.any(String),
    );
  });
  it('观看时切换听觉模型沿用当前感知实例', async () => {
    const { setModel, perceptionClose } = setup();
    await runtime.start({ mode: { type: 'follow', roomId: 123 } });
    await runtime.setHearingModel('sensevoice-small');
    expect(setModel).toHaveBeenCalledWith('sensevoice-small');
    expect(perceptionClose).not.toHaveBeenCalled();
    expect(runtime.status).toBe('watching');
  });
  it('中途停止视频先等待识别、只生成一次部分总结，再关闭会话', async () => {
    const { perceptionClose, sessionClose } = setup();
    const recognition = Promise.withResolvers<void>();
    perceptionClose.mockReturnValue(recognition.promise);
    const prompt = vi.fn().mockResolvedValue(undefined);
    const abort = vi.fn();
    mocks.session.mockResolvedValue({
      id: 'video',
      agent: { abort, prompt, state: { messages: [] } },
      close: sessionClose,
    });
    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });
    const stopping = runtime.stop();
    const repeated = runtime.stop();
    expect(repeated).toBe(stopping);
    expect(runtime.status).toBe('stopping');
    await vi.waitFor(() => expect(perceptionClose).toHaveBeenCalled());
    expect(mocks.mediaClose).toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(sessionClose).not.toHaveBeenCalled();
    recognition.resolve();
    await stopping;
    expect(abort).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]![0].at(-1).content).toContain('部分总结');
    expect(prompt.mock.calls[0]![0].at(-1).content).toContain('不推测后续内容');
    expect(sessionClose).toHaveBeenCalledOnce();
    expect(runtime.status).toBe('idle');
  });

  it('关闭应用取消视频处理，不触发部分总结', async () => {
    setup();
    const prompt = vi.fn();
    mocks.session.mockResolvedValue({
      id: 'video',
      agent: { abort: vi.fn(), prompt, state: { messages: [] } },
      close: vi.fn(),
    });
    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });
    await runtime.close();
    expect(prompt).not.toHaveBeenCalled();
    expect(runtime.status).toBe('closed');
  });
  it('视频先完成感知预处理，结束后只提交一次完整输入', async () => {
    vi.useFakeTimers();
    const { perceptionClose } = setup();
    const prompt = vi.fn().mockResolvedValue(undefined);
    mocks.session.mockResolvedValue({
      id: 'video',
      agent: { abort: vi.fn(), prompt, state: { messages: [] } },
      close: vi.fn(),
    });
    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));
    await runtime.start({
      mode: { type: 'recording', roomId: 123, source: { type: 'file', path: '/video.mp4' } },
    });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(prompt).not.toHaveBeenCalled();
    mocks.mediaOptions[0]!.onStopped?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(prompt).toHaveBeenCalledOnce();
    expect(perceptionClose.mock.invocationCallOrder[0]).toBeLessThan(
      prompt.mock.invocationCallOrder[0]!,
    );
    expect(events).toContainEqual({ type: 'video_progress', stage: 'recognizing' });
    expect(events).toContainEqual({ type: 'video_progress', stage: 'analyzing' });
    expect(runtime.status).toBe('idle');
  });
  it('停止期间返回的房间查询不能重新导航或打开 Session', async () => {
    const { api, page } = setup();
    const query = Promise.withResolvers<typeof room>();
    api.room.mockReturnValue(query.promise);
    const starting = runtime.start({ mode: { type: 'follow', roomId: 456 } });
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(api.room).toHaveBeenCalled());
    const stopping = runtime.stop();
    query.resolve(room);

    await rejected;
    await stopping;
    expect(page.open).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(runtime.status).toBe('idle');
  });

  it('切换房间前关闭旧访问，使用房间 Space 和日期 Session', async () => {
    const { api, page, sessionClose, perceptionClose } = setup();
    await runtime.start({ mode: { type: 'follow', roomId: 456 } });
    api.room.mockResolvedValue({ ...room, roomId: 789 });
    page.readiness.mockResolvedValue({ ready: true, roomId: 789 });
    await runtime.start({ mode: { type: 'follow', roomId: 456 } });

    expect(mocks.session.mock.calls[0][0].spaceId).toBe('bilibili:room:123');
    expect(mocks.session.mock.calls[1][0]).toMatchObject({
      spaceId: 'bilibili:room:789',
      crossSpace: true,
    });
    expect(mocks.session.mock.calls[1][0].sessionId).toMatch(
      /^bilibili:room:789:\d{4}-\d{2}-\d{2}$/,
    );
    expect(sessionClose.mock.invocationCallOrder[0]).toBeLessThan(
      page.open.mock.invocationCallOrder[1],
    );
    expect(perceptionClose).toHaveBeenCalledTimes(1);
  });

  it('流地址失败会释放已经打开的 Session 与感知', async () => {
    const { api, sessionClose, perceptionClose } = setup();
    api.playUrl.mockRejectedValue(new Error('播放地址失败'));
    await expect(runtime.start({ mode: { type: 'follow', roomId: 456 } })).rejects.toThrow(
      '播放地址失败',
    );
    expect(sessionClose).toHaveBeenCalledTimes(1);
    expect(perceptionClose).toHaveBeenCalledTimes(1);
    expect(runtime.room).toBeUndefined();
    expect(runtime.status).toBe('idle');
  });

  it('探索显式允许跨空间读取，停止后不使用迟到的选择', async () => {
    const { page } = setup();
    const investigation = Promise.withResolvers<unknown>();
    mocks.investigate.mockReturnValue(investigation.promise);
    const starting = runtime.start({ mode: { type: 'explore', areaId: 1 } });
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.investigate).toHaveBeenCalled());
    expect(mocks.investigate.mock.calls[0][0]).toMatchObject({
      spaceId: 'bilibili:exploration',
      crossSpace: true,
    });
    const stopping = runtime.stop();
    expect(mocks.investigate.mock.calls[0][0].signal.aborted).toBe(true);
    investigation.resolve({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: '{"roomId":123,"reason":"聊天"}' }],
      },
    });
    await rejected;
    await stopping;
    expect(page.open).not.toHaveBeenCalled();
  });
  it('录播复用房间 Space，但使用独立日期 Session 且不打开直播页面', async () => {
    const { page } = setup();

    await runtime.start({
      mode: {
        type: 'recording',
        roomId: 123,
        source: { type: 'file', path: 'C:\\Videos\\recording.mp4' },
        date: '2026-09-07',
      },
    });

    expect(page.open).not.toHaveBeenCalled();
    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'bilibili:room:123',
        sessionId: 'bilibili:room:123:recording:2026-09-07',
      }),
    );
    expect(mocks.mediaOptions[0]).toMatchObject({
      input: 'C:\\Videos\\recording.mp4',
      live: false,
      roomId: 123,
    });
  });
  it('录播自然结束后生成最终总结再关闭访问', async () => {
    const { sessionClose } = setup();
    await runtime.start({
      mode: {
        type: 'recording',
        roomId: 123,
        source: { type: 'url', url: 'https://example.com/recording.mp4' },
      },
    });
    const session = await mocks.session.mock.results[0]!.value;

    mocks.mediaOptions[0]!.onStopped?.();

    await vi.waitFor(() => expect(runtime.status).toBe('idle'));
    expect(session.agent.prompt).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('最终总结') }),
      ]),
    );
    expect(session.agent.prompt.mock.invocationCallOrder[0]).toBeLessThan(
      sessionClose.mock.invocationCallOrder[0],
    );
  });
  it('录播异常退出只报告错误并释放资源，不生成最终总结', async () => {
    const { sessionClose, perceptionClose } = setup();
    const events: unknown[] = [];
    runtime.onEvent(event => events.push(event));
    await runtime.start({
      mode: {
        type: 'recording',
        roomId: 123,
        source: { type: 'url', url: 'https://example.com/recording.mp4' },
      },
    });
    const session = await mocks.session.mock.results[0]!.value;
    const error = new Error('FFmpeg 解码失败');

    mocks.mediaOptions[0]!.onStopped?.(error);

    await vi.waitFor(() => expect(runtime.status).toBe('idle'));
    expect(events).toContainEqual({ type: 'error', stage: 'media', error });
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'recording_finished' }));
    expect(session.agent.prompt).not.toHaveBeenCalled();
    expect(sessionClose).toHaveBeenCalledOnce();
    expect(perceptionClose).toHaveBeenCalledOnce();
    expect(mocks.mediaClose).toHaveBeenCalledOnce();
    expect(runtime.room).toBeUndefined();
  });
  it('连续低分会真正重新探索和开房，不在思考结束回调中死锁', async () => {
    vi.useFakeTimers();
    const { api, page, sessionClose } = setup();
    const secondRoom = { ...room, roomId: 789 };
    api.rooms.mockResolvedValueOnce([room]).mockResolvedValue([secondRoom]);
    api.room.mockImplementation(async (id: number) => (id === 123 ? room : secondRoom));
    page.readiness.mockImplementation(async () => ({
      ready: true,
      roomId: page.open.mock.lastCall![0],
    }));
    const answer = (id: number) => ({
      answer: {
        role: 'assistant',
        content: [{ type: 'text', text: JSON.stringify({ roomId: id, reason: '看看新内容' }) }],
      },
    });
    mocks.investigate.mockResolvedValueOnce(answer(123)).mockResolvedValue(answer(789));
    mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
      id: options.sessionId,
      spaceId: options.spaceId,
      close: sessionClose,
      agent: {
        abort: vi.fn(),
        prompt: vi.fn().mockResolvedValue(undefined),
        state: {
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    action: 'explore',
                    confidence: 0.9,
                    score: 10,
                    danmakuAction: 'defer',
                    evidence: ['长期没有新内容'],
                    reason: '探索其他房间',
                  }),
                },
              ],
            },
          ],
        },
      },
    }));
    await runtime.start({ mode: { type: 'explore', areaId: 1 } });
    await vi.advanceTimersByTimeAsync(90_001);
    expect(api.rooms).toHaveBeenCalledTimes(2);
    expect(runtime.room?.roomId).toBe(789);
    expect(sessionClose.mock.invocationCallOrder[0]).toBeLessThan(
      page.open.mock.invocationCallOrder[1],
    );
    expect(mocks.session.mock.calls[1][0].spaceId).toBe('bilibili:room:789');
  });
});

it('跟随模式下播后释放媒体与会话并返回 idle', async () => {
  vi.useFakeTimers();
  const { page, api, sessionClose, perceptionClose } = setup();
  const events: unknown[] = [];
  runtime.onEvent(event => events.push(event));
  await runtime.start({ mode: { type: 'follow', roomId: 123 } });
  page.liveStatus.mockResolvedValue('offline');
  api.room.mockResolvedValue({ ...room, live: false });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(runtime.status).toBe('idle');
  expect(runtime.room).toBeUndefined();
  expect(sessionClose).toHaveBeenCalledOnce();
  expect(perceptionClose).toHaveBeenCalledOnce();
  expect(mocks.mediaClose).toHaveBeenCalledOnce();
  expect(events).toContainEqual({ type: 'room_closed', roomId: 123, reason: 'offline' });
});

it('媒体正常 EOF 但房间仍直播时停止访问并报告媒体错误', async () => {
  vi.useFakeTimers();
  setup();
  const events: unknown[] = [];
  runtime.onEvent(event => events.push(event));
  await runtime.start({ mode: { type: 'follow', roomId: 123 } });
  mocks.mediaOptions[0]!.onStopped?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.status).toBe('idle');
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', stage: 'media' }));
});

it('旧房间的媒体退出通知不能关闭新房间', async () => {
  vi.useFakeTimers();
  const { api, page } = setup();
  await runtime.start({ mode: { type: 'follow', roomId: 123 } });
  const stopped = mocks.mediaOptions[0]!.onStopped;
  api.room.mockResolvedValue({ ...room, roomId: 789 });
  page.readiness.mockResolvedValue({ ready: true, roomId: 789 });
  await runtime.start({ mode: { type: 'follow', roomId: 789 } });
  stopped?.(new Error('迟到的退出通知'));
  await vi.advanceTimersByTimeAsync(0);
  expect(runtime.status).toBe('watching');
  expect(runtime.room?.roomId).toBe(789);
});

it('探索模式确认下播后释放旧房间并重新选房', async () => {
  vi.useFakeTimers();
  const { api, page, sessionClose } = setup();
  const secondRoom = { ...room, roomId: 789 };
  api.rooms.mockResolvedValueOnce([room]).mockResolvedValue([secondRoom]);
  api.room.mockResolvedValueOnce(room).mockImplementation(async (id: number) => {
    if (id === 123) return { ...room, live: false };
    return secondRoom;
  });
  page.readiness.mockImplementation(async () => ({
    ready: true,
    roomId: page.open.mock.lastCall![0],
  }));
  page.liveStatus.mockImplementation(async () =>
    page.open.mock.lastCall![0] === 123 ? 'offline' : 'live',
  );
  const answer = (id: number) => ({
    answer: {
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify({ roomId: id, reason: '下一间' }) }],
    },
  });
  mocks.investigate.mockResolvedValueOnce(answer(123)).mockResolvedValue(answer(789));
  await runtime.start({ mode: { type: 'explore', areaId: 1 } });
  await vi.advanceTimersByTimeAsync(0);
  expect(api.rooms).toHaveBeenCalledTimes(2);
  expect(runtime.room?.roomId).toBe(789);
  expect(runtime.status).toBe('watching');
  expect(sessionClose).toHaveBeenCalledOnce();
});
