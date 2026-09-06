import { sendDanmaku } from "./send-danmaku.ts";
import type { WebContents } from "electron";
import type { Static } from "typebox";

import {
  DanmakuPageResultSchema,
  LivePageReadinessSchema,
  OptionalAccountSchema,
} from "../../shared/schemas.ts";
import type { Account } from "../../shared/types.ts";
import { executePage, isAllowedPageUrl } from "./page-executor.ts";

export type LivePageReadiness = Static<typeof LivePageReadinessSchema>;
export type DanmakuPageResult = Static<typeof DanmakuPageResultSchema>;

const LOGIN_URL = "https://passport.bilibili.com/login";

export class LivePage {
  private contents?: WebContents;
  private generation = 0;
  private roomId?: number;

  attach(contents: WebContents): void {
    if (contents.isDestroyed()) {
      throw new Error("不能绑定已经销毁的直播页面");
    }

    if (!isAllowedPageUrl(contents.getURL())) {
      throw new Error("不能绑定非 Bilibili 页面");
    }

    this.generation += 1;
    this.contents = contents;
    this.roomId = undefined;

    contents.once("destroyed", () => {
      if (this.contents !== contents) {
        return;
      }

      this.generation += 1;
      this.contents = undefined;
      this.roomId = undefined;
    });
  }

  async login(): Promise<void> {
    const contents = this.requireContents();

    this.generation += 1;
    this.roomId = undefined;
    await contents.loadURL(LOGIN_URL);
  }

  async logout(): Promise<void> {
    const contents = this.requireContents();

    this.generation += 1;
    this.roomId = undefined;

    await contents.session.clearStorageData({
      storages: ["cookies", "localstorage"],
    });
    await contents.loadURL(LOGIN_URL);
  }

  async open(roomId: number): Promise<void> {
    if (!Number.isSafeInteger(roomId) || roomId < 1) {
      throw new Error("roomId 必须是正整数");
    }

    const contents = this.requireContents();

    this.generation += 1;
    const generation = this.generation;
    this.roomId = undefined;

    await contents.loadURL(`https://live.bilibili.com/${roomId}`);

    if (generation !== this.generation) {
      throw new Error("打开直播间期间页面已切换");
    }

    this.roomId = roomId;
  }

  async account(): Promise<Account | undefined> {
    const contents = this.requireContents();
    const generation = this.generation;
    const account = await executePage(
      contents,
      `fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" })
        .then(response => response.json())
        .then(body => body.code === 0 && body.data?.isLogin
          ? ({ uid: body.data.mid, name: body.data.uname, face: body.data.face ?? "" })
          : null)`,
      OptionalAccountSchema,
      this.executionOptions("读取登录账号", generation),
    );

    return account ?? undefined;
  }

  readiness(): Promise<LivePageReadiness> {
    const contents = this.requireContents();
    const generation = this.generation;

    return executePage(
      contents,
      `(() => {
        const match = location.pathname.match(/^\\/(\\d+)/u);
        const pathRoomId = match ? Number(match[1]) : null;
        const room = window.__NEPTUNE_IS_MY_WAIFU__?.roomInitRes?.data;
        // B 站会把真实房号重定向为短房号，仅在当前路径匹配时采用页面房间信息。
        const matchesRoom = room && (pathRoomId === room.room_id || pathRoomId === room.short_id);
        const roomId = matchesRoom ? room.room_id : pathRoomId;
        return {
          roomId,
          // 感知通过独立媒体流运行，不依赖页面暴露播放器实例或所有资源加载完毕。
          ready: location.hostname === "live.bilibili.com"
            && roomId !== null
            && document.readyState !== "loading"
            && Boolean(document.body),
          canSendDanmaku: Boolean(document.querySelector("textarea, [contenteditable=true]")),
        };
      })()`,
      LivePageReadinessSchema,
      this.executionOptions("检查直播页面状态", generation),
    );
  }

  async sendDanmaku(content: string): Promise<DanmakuPageResult> {
    const contents = this.requireContents();
    const generation = this.generation;
    const roomId = this.roomId;
    if (!roomId || (await this.readiness()).roomId !== roomId)
      throw new Error("当前页面不是目标直播间");
    if (generation !== this.generation) throw new Error("检查发送目标期间直播间已切换");
    const result = await sendDanmaku(contents, content);
    if (generation !== this.generation)
      throw new Error("发送期间直播间已切换，发送结果不再属于当前访问");
    return result;
  }

  close(): void {
    this.generation += 1;
    this.roomId = undefined;
  }

  private requireContents(): WebContents {
    if (!this.contents || this.contents.isDestroyed()) {
      throw new Error("直播页面尚未绑定");
    }

    return this.contents;
  }

  private executionOptions(action: string, generation: number) {
    return {
      action,
      generation,
      currentGeneration: () => this.generation,
    };
  }
}
