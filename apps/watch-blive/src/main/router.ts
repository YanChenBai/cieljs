import { createDevtoolsRouter, type DevtoolsHost } from '@cieljs/devtools/host';
import { os } from '@orpc/server';
import { webContents, type BrowserWindow } from 'electron';
import * as z from 'zod';

import type { WatchBridgeEvent } from '../shared/ipc.ts';
import { BilibiliApi } from './bilibili/api.ts';
import type { LivePage } from './bilibili/live-page.ts';
import { isAllowedPageUrl } from './bilibili/page-executor.ts';
import { resolveWatchModel, watchDataDirectory } from './config.ts';
import { createWatchBlive, type WatchBlive } from './runtime.ts';

const startSchema = z.object({
  mode: z.discriminatedUnion('type', [
    z.object({ type: z.literal('follow'), roomId: z.number().int().positive() }),
    z.object({ type: z.literal('explore'), areaId: z.number().int().positive() }),
  ]),
  danmakuDelivery: z.enum(['simulate', 'live']).optional(),
});

export function createWatchRouter(
  mainWindow: BrowserWindow,
  livePage: LivePage,
  devtools: DevtoolsHost,
) {
  const api = new BilibiliApi();
  const listeners = new Set<(event: WatchBridgeEvent) => void>();
  let runtime: WatchBlive | undefined;
  let unsubscribe: (() => void) | undefined;

  function requireRuntime() {
    if (runtime) return runtime;
    runtime = createWatchBlive({
      model: resolveWatchModel(),
      livePage,
      api,
      devtools,
      dataDir: watchDataDirectory(),
    });
    unsubscribe = runtime.onEvent(event => {
      devtools.record(event.type, event);
      const value: WatchBridgeEvent =
        event.type === 'error'
          ? { type: 'error', stage: event.stage, message: event.error.message }
          : event;
      for (const listener of listeners) listener(value);
    });
    return runtime;
  }

  const router = {
    devtools: createDevtoolsRouter(devtools),
    account: {
      get: os.handler(() => livePage.account()),
      login: os.handler(async ({ signal }) => {
        await runtime?.stop();
        await livePage.login();
        return livePage.waitForLogin(signal);
      }),
      logout: os.handler(async () => {
        await runtime?.stop();
        await livePage.logout();
      }),
    },
    watch: {
      start: os.input(startSchema).handler(({ input }) => requireRuntime().start(input)),
      stop: os.handler(() => runtime?.stop()),
      areas: os.handler(() => api.areas()),
      snapshot: os.handler(() => ({ status: runtime?.status ?? 'idle', room: runtime?.room })),
      events: os.handler(async function* ({ signal }) {
        const queue: WatchBridgeEvent[] = [];
        let wake: (() => void) | undefined;
        const receive = (event: WatchBridgeEvent) => {
          queue.push(event);
          wake?.();
        };
        const abort = () => wake?.();
        listeners.add(receive);
        signal?.addEventListener('abort', abort);
        try {
          yield { type: 'status', status: runtime?.status ?? 'idle' } satisfies WatchBridgeEvent;
          if (runtime?.room)
            yield { type: 'room_opened', room: runtime.room } satisfies WatchBridgeEvent;
          while (!signal?.aborted) {
            const pending = new Promise<void>(resolve => {
              wake = resolve;
            });
            if (queue.length) yield queue.shift()!;
            else await pending;
          }
        } finally {
          listeners.delete(receive);
          signal?.removeEventListener('abort', abort);
        }
      }),
    },
    window: {
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
    },
  };

  return {
    router,
    close: async () => {
      unsubscribe?.();
      await runtime?.close();
    },
  };
}
export type WatchRouter = ReturnType<typeof createWatchRouter>['router'];
