import type { Agent } from "@earendil-works/pi-agent-core";
import type { Perception } from "@cieljs/perception";
import { describe, expect, it, vi } from "vite-plus/test";

import { ThoughtScheduler } from "./thought-scheduler.ts";

describe("ThoughtScheduler", () => {
  it("思考期间的新触发会合并到下一轮", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const prompt = vi
      .fn()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue(undefined);
    const snapshot = vi.fn().mockResolvedValue({ compose: async () => [] });
    const scheduler = new ThoughtScheduler({
      perception: { snapshot } as Pick<Perception, "snapshot">,
      agent: { prompt } as unknown as Pick<Agent, "prompt">,
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: "user", content: "观察直播", timestamp: Date.now() }),
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
  it("关闭期间完成的快照不会启动新思考", async () => {
    const composing = Promise.withResolvers<[]>();
    const prompt = vi.fn();
    const scheduler = new ThoughtScheduler({
      perception: { snapshot: vi.fn().mockResolvedValue({ compose: () => composing.promise }) },
      agent: { prompt },
      minimumIntervalMs: 0,
      startedAt: new Date(0),
      context: () => ({ role: "user", content: "观察", timestamp: 0 }),
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
