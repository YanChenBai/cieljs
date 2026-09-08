import type { WebContents } from 'electron';
import { Type, type Static } from 'typebox';

import {
  DanmakuPageResultSchema,
  LivePageReadinessSchema,
  OptionalAccountSchema,
} from '../../shared/schemas.ts';
import type { Account } from '../../shared/types.ts';
import { executePage, isAllowedPageUrl } from './page-executor.ts';
import {
  READ_ACCOUNT_SCRIPT,
  PREPARE_PLAYER_SCRIPT,
  READ_READINESS_SCRIPT,
  READ_LIVE_STATUS_SCRIPT,
} from './page-scripts.ts';
import { sendDanmaku } from './send-danmaku.ts';
import { waitForPage } from './wait-for-page.ts';

export type LivePageReadiness = Static<typeof LivePageReadinessSchema>;
export type DanmakuPageResult = Static<typeof DanmakuPageResultSchema>;

// 登录后返回直播站，只有这里会提供 BilibiliLive.UID。
const LOGIN_URL = 'https://passport.bilibili.com/login?gourl=https%3A%2F%2Flive.bilibili.com%2F';

export class LivePage {
  private contents?: WebContents;
  private generation = 0;
  private lifetime = new AbortController();
  private roomId?: number;

  attach(contents: WebContents): void {
    if (contents.isDestroyed()) {
      throw new Error('不能绑定已经销毁的直播页面');
    }

    if (!isAllowedPageUrl(contents.getURL())) {
      throw new Error('不能绑定非 Bilibili 页面');
    }

    this.invalidate();
    this.contents = contents;
    this.roomId = undefined;

    contents.once('destroyed', () => {
      if (this.contents !== contents) {
        return;
      }

      this.invalidate();
      this.contents = undefined;
      this.roomId = undefined;
    });
  }

  async login(): Promise<void> {
    const contents = this.requireContents();

    this.invalidate();
    this.roomId = undefined;
    await contents.loadURL(LOGIN_URL);
  }

  async logout(): Promise<void> {
    const contents = this.requireContents();

    this.invalidate();
    this.roomId = undefined;

    await contents.session.clearStorageData({
      storages: ['cookies', 'localstorage'],
    });
    await contents.loadURL(LOGIN_URL);
  }

  async open(roomId: number, signal?: AbortSignal): Promise<void> {
    if (!Number.isSafeInteger(roomId) || roomId < 1) {
      throw new Error('roomId 必须是正整数');
    }

    const contents = this.requireContents();

    this.invalidate();
    const generation = this.generation;
    this.roomId = undefined;

    await contents.loadURL(`https://live.bilibili.com/${roomId}`);

    if (generation !== this.generation) {
      throw new Error('打开直播间期间页面已切换');
    }

    await this.prepareRoom(generation, signal);
    this.roomId = roomId;
  }

  /** UID 就绪前只读页面状态，避免未登录时反复请求账号 API。 */
  async account(signal?: AbortSignal): Promise<Account | undefined> {
    const contents = this.requireContents();
    const generation = this.generation;
    const account = await executePage(
      contents,
      READ_ACCOUNT_SCRIPT,
      OptionalAccountSchema,
      this.executionOptions('读取登录账号', generation, signal),
    );

    return account ?? undefined;
  }

  waitForLogin(signal?: AbortSignal): Promise<Account> {
    const options = this.executionOptions('等待 Bilibili 登录', this.generation, signal);

    return waitForPage(() => this.account(options.signal), {
      action: options.action,
      timeoutMs: 360_000,
      intervalMs: 1_500,
      signal: options.signal,
    });
  }

  /** 导航完成不代表播放器已经挂载，等待实例可用后再应用网页全屏。 */
  private prepareRoom(generation: number, signal?: AbortSignal) {
    const contents = this.requireContents();
    const options = this.executionOptions('初始化直播播放器', generation, signal);

    return waitForPage(
      async () => {
        const ready = await executePage(contents, PREPARE_PLAYER_SCRIPT, Type.Boolean(), options);

        if (ready) return true;
        return undefined;
      },
      { action: options.action, timeoutMs: 15_000, signal: options.signal },
    );
  }

  readiness(): Promise<LivePageReadiness> {
    const contents = this.requireContents();
    const generation = this.generation;

    return executePage(
      contents,
      READ_READINESS_SCRIPT,
      LivePageReadinessSchema,
      this.executionOptions('检查直播页面状态', generation),
    );
  }

  /** 定期读取播放器当前状态，避免依赖页面没有公开解绑接口的事件监听器。 */
  liveStatus(signal?: AbortSignal) {
    const contents = this.requireContents();
    const generation = this.generation;

    return executePage(
      contents,
      READ_LIVE_STATUS_SCRIPT,
      Type.Union([Type.Literal('live'), Type.Literal('offline'), Type.Null()]),
      this.executionOptions('检查直播状态', generation, signal),
    );
  }

  async sendDanmaku(content: string): Promise<DanmakuPageResult> {
    const contents = this.requireContents();
    const generation = this.generation;
    const roomId = this.roomId;

    if (!roomId) throw new Error('当前页面不是目标直播间');

    const readiness = await this.readiness();
    if (readiness.roomId !== roomId) {
      throw new Error('当前页面不是目标直播间');
    }

    if (generation !== this.generation) throw new Error('检查发送目标期间直播间已切换');

    const result = await sendDanmaku(contents, content);
    if (generation !== this.generation) {
      throw new Error('发送期间直播间已切换，发送结果不再属于当前访问');
    }

    return result;
  }

  close(): void {
    this.invalidate();
    this.roomId = undefined;
  }

  private requireContents(): WebContents {
    if (!this.contents || this.contents.isDestroyed()) {
      throw new Error('直播页面尚未绑定');
    }

    return this.contents;
  }

  private invalidate() {
    this.lifetime.abort(new Error('直播页面已切换或关闭'));
    this.lifetime = new AbortController();
    this.generation += 1;
  }

  private executionOptions(action: string, generation: number, signal?: AbortSignal) {
    return {
      action,
      signal: signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal,
      generation,
      currentGeneration: () => this.generation,
    };
  }
}
