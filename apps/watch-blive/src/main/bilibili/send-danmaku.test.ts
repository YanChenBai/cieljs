import { expect, it, vi } from "vite-plus/test";
import type { Session } from "electron";
import { sendDanmaku } from "./send-danmaku.ts";
function session(result: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));
  const cookies = { get: vi.fn().mockResolvedValue([{ name: "bili_jct", value: "test-token" }]) };
  return {
    value: { fetch, cookies } as unknown as Pick<Session, "fetch" | "cookies">,
    fetch,
    cookies,
  };
}
it("使用当前 webview 会话发送，只有 code=0 确认成功", async () => {
  const mock = session({ code: 0 });
  expect(await sendDanmaku(mock.value, 123, " 晚上好 ")).toMatchObject({ accepted: true });
  const init = mock.fetch.mock.calls[0]![1] as RequestInit;
  expect((init.body as FormData).get("roomid")).toBe("123");
  expect((init.body as FormData).get("msg")).toBe("晚上好");
  expect((init.body as FormData).get("csrf")).toBe("test-token");
});
it("缺少状态不能误报成功，服务端拒绝不重试", async () => {
  const unknown = session({});
  await expect(sendDanmaku(unknown.value, 123, "hello")).rejects.toThrow("无法确认");
  const rejected = session({ code: -1, message: "拒绝" });
  expect(await sendDanmaku(rejected.value, 123, "hello")).toMatchObject({
    accepted: false,
    message: "拒绝",
  });
  expect(rejected.fetch).toHaveBeenCalledTimes(1);
});
it("缺少登录凭据不发请求", async () => {
  const mock = session({ code: 0 });
  mock.cookies.get.mockResolvedValue([]);
  await expect(sendDanmaku(mock.value, 123, "hello")).rejects.toThrow("bili_jct");
  expect(mock.fetch).not.toHaveBeenCalled();
});
