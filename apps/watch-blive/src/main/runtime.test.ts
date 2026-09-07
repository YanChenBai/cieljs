import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { OpenSessionOptions } from "@cieljs/core";
import type { Perception } from "@cieljs/perception";
import type { LivePage } from "./bilibili/live-page.ts";
import type { BilibiliApi } from "./bilibili/api.ts";
import { createWatchBlive, type WatchBlive } from "./runtime.ts";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  close: vi.fn(),
  session: vi.fn(),
  investigate: vi.fn(),
  mediaStart: vi.fn(),
  mediaClose: vi.fn(),
}));
vi.mock("@cieljs/core", () => ({ defineCiel: () => mocks }));
vi.mock("@cieljs/perception", () => ({ createPerception: vi.fn() }));
vi.mock("./bilibili/api.ts", () => ({ BilibiliApi: class {} }));
vi.mock("./bilibili/live-page.ts", () => ({ LivePage: class {} }));
vi.mock("./media/live-media.ts", () => ({
  LiveMedia: class {
    start = mocks.mediaStart;
    close = mocks.mediaClose;
  },
}));

const room = {
  roomId: 123,
  streamerUid: 456,
  streamerName: "主播",
  title: "聊天",
  description: "",
  parentAreaName: "娱乐",
  areaName: "聊天",
  live: true,
};
let runtime: WatchBlive;
let faux: ReturnType<typeof registerFauxProvider>;

function setup() {
  faux = registerFauxProvider();
  const sessionClose = vi.fn().mockResolvedValue(undefined);
  mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
    id: options.sessionId,
    spaceId: options.spaceId,
    agent: { prompt: vi.fn(), state: { messages: [] } },
    close: sessionClose,
  }));
  const perceptionClose = vi.fn().mockResolvedValue(undefined);
  const perception = {
    close: perceptionClose,
    on: vi.fn(() => vi.fn()),
    snapshot: vi.fn().mockResolvedValue({ compose: async () => [] }),
  } as unknown as Perception;
  const page = {
    account: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    readiness: vi.fn().mockResolvedValue({ ready: true, roomId: room.roomId }),
  };
  const api = {
    roomByStreamer: vi.fn().mockResolvedValue(room),
    playUrl: vi.fn().mockResolvedValue("https://example.com/live"),
    rooms: vi.fn().mockResolvedValue([room]),
    room: vi.fn().mockResolvedValue(room),
  };
  runtime = createWatchBlive({
    model: faux.getModel(),
    livePage: page as unknown as LivePage,
    api: api as unknown as BilibiliApi,
    createPerception: () => perception,
  });
  return { page, api, sessionClose, perceptionClose };
}

beforeEach(() => vi.resetAllMocks());
afterEach(async () => {
  await runtime?.close();
  faux?.unregister();
  vi.useRealTimers();
});

describe("观看生命周期", () => {
  it("停止期间返回的房间查询不能重新导航或打开 Session", async () => {
    const { api, page } = setup();
    const query = Promise.withResolvers<typeof room>();
    api.room.mockReturnValue(query.promise);
    const starting = runtime.start({ mode: { type: "follow", roomId: 456 } });
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(api.room).toHaveBeenCalled());
    const stopping = runtime.stop();
    query.resolve(room);

    await rejected;
    await stopping;
    expect(page.open).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
    expect(runtime.status).toBe("idle");
  });

  it("切换房间前关闭旧访问，使用房间 Space 和日期 Session", async () => {
    const { api, page, sessionClose, perceptionClose } = setup();
    await runtime.start({ mode: { type: "follow", roomId: 456 } });
    api.room.mockResolvedValue({ ...room, roomId: 789 });
    page.readiness.mockResolvedValue({ ready: true, roomId: 789 });
    await runtime.start({ mode: { type: "follow", roomId: 456 } });

    expect(mocks.session.mock.calls[0][0].spaceId).toBe("bilibili:room:123");
    expect(mocks.session.mock.calls[1][0]).toMatchObject({
      spaceId: "bilibili:room:789",
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

  it("流地址失败会释放已经打开的 Session 与感知", async () => {
    const { api, sessionClose, perceptionClose } = setup();
    api.playUrl.mockRejectedValue(new Error("播放地址失败"));
    await expect(runtime.start({ mode: { type: "follow", roomId: 456 } })).rejects.toThrow(
      "播放地址失败",
    );
    expect(sessionClose).toHaveBeenCalledTimes(1);
    expect(perceptionClose).toHaveBeenCalledTimes(1);
    expect(runtime.room).toBeUndefined();
    expect(runtime.status).toBe("idle");
  });

  it("探索显式允许跨空间读取，停止后不使用迟到的选择", async () => {
    const { page } = setup();
    const investigation = Promise.withResolvers<unknown>();
    mocks.investigate.mockReturnValue(investigation.promise);
    const starting = runtime.start({ mode: { type: "explore", areaId: 1 } });
    const rejected = expect(starting).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.investigate).toHaveBeenCalled());
    expect(mocks.investigate.mock.calls[0][0]).toMatchObject({
      spaceId: "bilibili:exploration",
      crossSpace: true,
    });
    const stopping = runtime.stop();
    expect(mocks.investigate.mock.calls[0][0].signal.aborted).toBe(true);
    investigation.resolve({
      answer: {
        role: "assistant",
        content: [{ type: "text", text: '{"roomId":123,"reason":"聊天"}' }],
      },
    });
    await rejected;
    await stopping;
    expect(page.open).not.toHaveBeenCalled();
  });
  it("连续低分会真正重新探索和开房，不在思考结束回调中死锁", async () => {
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
        role: "assistant",
        content: [{ type: "text", text: JSON.stringify({ roomId: id, reason: "看看新内容" }) }],
      },
    });
    mocks.investigate.mockResolvedValueOnce(answer(123)).mockResolvedValue(answer(789));
    mocks.session.mockImplementation(async (options: OpenSessionOptions) => ({
      id: options.sessionId,
      spaceId: options.spaceId,
      close: sessionClose,
      agent: {
        prompt: vi.fn().mockResolvedValue(undefined),
        state: {
          messages: [
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    action: "explore",
                    confidence: 0.9,
                    score: 10,
                    danmakuAction: "defer",
                    evidence: ["长期没有新内容"],
                    reason: "探索其他房间",
                  }),
                },
              ],
            },
          ],
        },
      },
    }));
    await runtime.start({ mode: { type: "explore", areaId: 1 } });
    await vi.advanceTimersByTimeAsync(90_001);
    expect(api.rooms).toHaveBeenCalledTimes(2);
    expect(runtime.room?.roomId).toBe(789);
    expect(sessionClose.mock.invocationCallOrder[0]).toBeLessThan(
      page.open.mock.invocationCallOrder[1],
    );
    expect(mocks.session.mock.calls[1][0].spaceId).toBe("bilibili:room:789");
  });
});
