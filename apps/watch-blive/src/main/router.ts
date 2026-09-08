import {
  createDevtoolsRouter,
  type DevtoolsRouter,
  type DevtoolsHost,
} from '@cieljs/devtools/host';
import type { BrowserWindow } from 'electron';

import type { WatchBridgeEvent } from '../shared/ipc.ts';
import { BilibiliApi } from './bilibili/api.ts';
import type { LivePage } from './bilibili/live-page.ts';
import { resolveWatchConfig, resolveWatchModel, watchDataDirectory } from './config.ts';
import { createAccountRoutes } from './routes/account.ts';
import { createRecordingRoutes } from './routes/recording.ts';
import { createSetupRoutes } from './routes/setup.ts';
import { createWatchRoutes } from './routes/watch.ts';
import { createWindowRoutes } from './routes/window.ts';
import { createWatchBlive, type WatchBlive } from './runtime.ts';

interface WatchRouterHandle {
  router: {
    devtools: DevtoolsRouter;
    account: ReturnType<typeof createAccountRoutes>;
    watch: ReturnType<typeof createWatchRoutes>;
    setup: ReturnType<typeof createSetupRoutes>;
    recording: ReturnType<typeof createRecordingRoutes>;
    window: ReturnType<typeof createWindowRoutes>;
  };
  close: () => Promise<void>;
}

/** 组装路由并持有运行实例，业务处理位于 routes。 */
export function createWatchRouter(
  mainWindow: BrowserWindow,
  livePage: LivePage,
  devtools: DevtoolsHost,
): WatchRouterHandle {
  const api = new BilibiliApi();
  const listeners = new Set<(event: WatchBridgeEvent) => void>();
  let runtime: WatchBlive | undefined;
  let unsubscribe: (() => void) | undefined;

  function requireRuntime() {
    if (runtime) return runtime;
    const config = resolveWatchConfig();
    const ai = resolveWatchModel(config);
    runtime = createWatchBlive({
      model: ai.model,
      apiKey: ai.apiKey,
      livePage,
      api,
      devtools,
      dataDir: watchDataDirectory(),
      ffmpegPath: config.ffmpegPath,
      ...config.interaction,
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

  // 显式使用公开 DevtoolsRouter，避免声明推断泄漏构建产物的私有类型。
  const devtoolsRouter: DevtoolsRouter = createDevtoolsRouter(devtools);
  const router = {
    devtools: devtoolsRouter,
    account: createAccountRoutes(livePage, () => runtime),
    watch: createWatchRoutes(api, () => runtime, requireRuntime, listeners),
    setup: createSetupRoutes(),
    recording: createRecordingRoutes(mainWindow),
    window: createWindowRoutes(mainWindow, livePage, roomId => {
      for (const listener of listeners) listener({ type: 'room_requested', roomId });
    }),
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
