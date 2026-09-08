import type { Perception } from '@cieljs/perception';
import type { Agent } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vite-plus/test';

import { ThoughtScheduler } from './thought-scheduler.ts';

describe('ThoughtScheduler', () => {
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
