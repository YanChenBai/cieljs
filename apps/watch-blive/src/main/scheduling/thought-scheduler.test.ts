import type { Perception } from '@cieljs/perception';
import type { Agent } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ThoughtScheduler } from './thought-scheduler.ts';

describe('ThoughtScheduler', () => {
  it.each([true, false])('主动取消=%s 时正确区分请求中止和运行失败', async cancelled => {
    let rejectPrompt!: (error: Error) => void;
    const prompt = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPrompt = reject;
        }),
    );
    const onError = vi.fn();
    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }) },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
      onError,
    });

    scheduler.trigger(new Date(1));
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    if (cancelled) {
      scheduler.cancel();
    }
    rejectPrompt(new Error('Agent 运行失败：Request was aborted'));
    if (!cancelled) {
      await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    }
    await scheduler.close();
    expect(onError).toHaveBeenCalledTimes(cancelled ? 0 : 1);
  });

  it('忽略迟到和重复时间，后续快照边界保持递增', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const snapshot = vi.fn().mockResolvedValue({ compose: async () => [] });
    const scheduler = new ThoughtScheduler({
      perception: { snapshot },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(100),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
    });
    scheduler.trigger(new Date(110));
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
    scheduler.trigger(new Date(105));
    scheduler.trigger(new Date(110));
    scheduler.trigger(new Date(120));
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    expect(snapshot).toHaveBeenLastCalledWith({ startAt: new Date(111), endAt: new Date(120) });
    await scheduler.close();
  });
  it('内容过滤后暂停自动提交，保留原始错误', async () => {
    const error = new Error('Provider finish_reason: content_filter');
    const prompt = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }) },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
      onError,
    });
    scheduler.trigger(new Date(1));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    scheduler.trigger(new Date(2));
    await scheduler.close();
    expect(prompt).toHaveBeenCalledOnce();
  });
  it('思考期间的新触发会合并到下一轮', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstRun = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const prompt = vi
      .fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue(undefined);
    const snapshot = vi.fn().mockResolvedValue({ compose: async () => [] });
    const scheduler = new ThoughtScheduler({
      perception: { snapshot } as Pick<Perception, 'snapshot'>,
      agent: { prompt } as unknown as Pick<Agent, 'prompt'>,
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察直播', timestamp: Date.now() }),
    });

    scheduler.trigger(new Date(1));
    scheduler.trigger(new Date(2));
    scheduler.trigger(new Date(3));
    releaseFirst?.();

    await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(2));
    await scheduler.close();

    expect(snapshot).toHaveBeenNthCalledWith(2, {
      startAt: new Date(2),
      endAt: new Date(3),
    });
  });
  it('关闭期间完成的快照不会启动新思考', async () => {
    const composing = Promise.withResolvers<[]>();
    const prompt = vi.fn();
    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: () => composing.promise }) },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: 'user', content: '观察', timestamp: 0 }),
    });
    scheduler.trigger(new Date(1));
    scheduler.trigger(new Date(2));
    const closing = scheduler.close();
    composing.resolve([]);
    await closing;
    scheduler.trigger(new Date(3));
    expect(prompt).not.toHaveBeenCalled();
  });
});

it('最终总结包含间隔内尚未思考的尾段感知', async () => {
  const tail = { role: 'user' as const, content: '最后一句语音', timestamp: 2 };
  const prompt = vi.fn().mockResolvedValue(undefined);
  const snapshot = vi.fn().mockResolvedValue({ compose: async () => [tail] });
  const scheduler = new ThoughtScheduler({
    perception: { snapshot },
    agent: { prompt },
    minimumIntervalMs: 60_000,
    startedAt: new Date(0),
    context: () => ({ role: 'user', content: '上下文', timestamp: 0 }),
  });
  scheduler.trigger(new Date(1));
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1));
  scheduler.trigger(new Date(2));
  await scheduler.finish('最终总结');
  expect(snapshot).toHaveBeenLastCalledWith({ startAt: new Date(2), endAt: expect.any(Date) });
  expect(prompt).toHaveBeenLastCalledWith(
    expect.arrayContaining([tail, expect.objectContaining({ content: '最终总结' })]),
  );
});
