import { os } from '@orpc/server';
import { webContents, type BrowserWindow } from 'electron';
import * as z from 'zod';

import type { LivePage } from '../bilibili/live-page.ts';
import { isAllowedPageUrl } from '../bilibili/page-executor.ts';

/** guest 必须属于当前窗口，避免渲染进程附加任意页面。 */
export function createWindowRoutes(mainWindow: BrowserWindow, livePage: LivePage) {
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
    }),
  };
}
