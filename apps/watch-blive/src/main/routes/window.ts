import { os } from '@orpc/server';
import { webContents, type BrowserWindow } from 'electron';
import * as z from 'zod';

import type { LivePage } from '../bilibili/live-page.ts';
import { isAllowedPageUrl } from '../bilibili/page-executor.ts';

/** guest 必须属于当前窗口，避免渲染进程附加任意页面。 */
export function createWindowRoutes(
  mainWindow: BrowserWindow,
  livePage: LivePage,
  requestRoom: (roomId: number) => void,
) {
  return {
    attach: os.input(z.object({ id: z.number().int().positive() })).handler(({ input }) => {
      const contents = webContents.fromId(input.id);
      if (
        !contents ||
        contents.isDestroyed() ||
        contents.hostWebContents !== mainWindow.webContents ||
        !isAllowedPageUrl(contents.getURL())
      )
        throw new Error('直播 guest 不属于当前窗口或地址不合法');
      livePage.attach(contents);
      contents.setWindowOpenHandler(({ url }) => {
        const target = URL.parse(url);
        const match = target?.pathname.match(/^\/(\d+)\/?$/u);
        const roomId = match ? Number(match[1]) : 0;
        if (
          target?.hostname === 'live.bilibili.com' &&
          ['https:', 'http:'].includes(target.protocol) &&
          Number.isSafeInteger(roomId) &&
          roomId > 0
        ) {
          requestRoom(roomId);
        } else if (target?.protocol === 'https:' && isAllowedPageUrl(url)) {
          // 分区和全部直播页也使用新窗口链接，改为在当前 webview 内浏览。
          void contents.loadURL(url).catch(error => console.error('打开 Bilibili 页面失败', error));
        }

        return { action: 'deny' };
      });
    }),
  };
}
