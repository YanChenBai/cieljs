import type { WebContents } from "electron";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { LivePage } from "./live-page.ts";

it.each([
  ["interactive", "/6154037", true],
  ["complete", "/6154037", true],
  ["loading", "/6154037", false],
  ["complete", "/", false],
])("页面状态 %s、路径 %s 的就绪判断不依赖播放器全局变量", async (readyState, pathname, ready) => {
  const page = new LivePage();
  page.attach({
    isDestroyed: () => false,
    getURL: () => `https://live.bilibili.com${pathname}`,
    once: () => undefined,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        runInNewContext(code, {
          window: {},
          location: { hostname: "live.bilibili.com", pathname },
          document: { readyState, body: {}, querySelector: () => null },
        }),
      ),
  } as unknown as WebContents);

  await expect(page.readiness()).resolves.toMatchObject({ ready });
});

it("短房号跳转仍识别真实房间 ID", async () => {
  const page = new LivePage();
  page.attach({
    isDestroyed: () => false,
    getURL: () => "https://live.bilibili.com/52030",
    once: () => undefined,
    executeJavaScript: (code: string) =>
      Promise.resolve(
        runInNewContext(code, {
          location: { hostname: "live.bilibili.com", pathname: "/52030" },
          window: {
            __NEPTUNE_IS_MY_WAIFU__: {
              roomInitRes: { data: { room_id: 21696950, short_id: 52030 } },
            },
          },
          document: { readyState: "complete", body: {}, querySelector: () => null },
        }),
      ),
  } as unknown as WebContents);
  await expect(page.readiness()).resolves.toMatchObject({ ready: true, roomId: 21696950 });
});
