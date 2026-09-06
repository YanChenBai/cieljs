import type { Session, WebContents } from "electron";
import * as z from "zod";
import { executePage } from "./page-executor";
import Type from "typebox";

const responseSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  msg: z.string().optional(),
});

export async function _sendDanmaku(
  session: Pick<Session, "cookies" | "fetch">,
  roomId: number,
  content: string,
) {
  const text = content.trim();
  if (!text) throw new Error("弹幕不能为空");
  const cookies = await session.cookies.get({ url: "https://live.bilibili.com/" });
  const csrf = cookies.find((cookie) => cookie.name === "bili_jct")?.value;
  if (!csrf) throw new Error("登录凭据缺少 bili_jct，请重新登录");

  // 使用 webview 自己的登录分区；播放器方法可能只渲染本地弹幕。
  const body = new FormData();
  for (const [key, value] of Object.entries({
    bubble: "0",
    color: "16777215",
    csrf,
    csrf_token: csrf,
    fontsize: "25",
    mode: "1",
    msg: text,
    rnd: String(Math.floor(Date.now() / 1000)),
    roomid: String(roomId),
  }))
    body.set(key, value);
  const response = await session.fetch("https://api.live.bilibili.com/msg/send", {
    method: "POST",
    body,
    credentials: "include",
    headers: { Referer: `https://live.bilibili.com/${roomId}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`弹幕发送 HTTP ${response.status}`);
  const result = responseSchema.safeParse(await response.json());
  if (!result.success) throw new Error("发送响应缺少明确状态，无法确认送达");
  const { code, message, msg } = result.data;
  return { accepted: code === 0, code, message: message ?? msg ?? "" };
}

export async function sendDanmaku(contents: WebContents, content: string) {
  const {
    response: { code, message, msg },
  } = await executePage(
    contents,
    `livePlayer.sendDanmaku({ msg: ${JSON.stringify(content)} })`,
    Type.Object({
      uniqueID: Type.Optional(Type.Any()),
      response: Type.Object({
        code: Type.Number(),
        data: Type.Optional(Type.Any()),
        message: Type.Optional(Type.String()),
        msg: Type.Optional(Type.String()),
      }),
    }),
  );

  return { accepted: code === 0, code, message: message ?? msg ?? "" };
}
