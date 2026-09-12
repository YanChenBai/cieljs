import { join } from 'node:path';

import {
  createDevtoolsRouter,
  DevtoolsHost,
  devtoolsStorage,
  type DevtoolsRouter,
} from '@cieljs/devtools/host';
import { createMcp } from '@cieljs/mcp';
import { memoryStorage } from '@cieljs/memory';
import { sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { vectorStorage } from '@cieljs/vector';
import { os } from '@orpc/server';
import type { BrowserWindow } from 'electron';
import * as z from 'zod';

import type { WatchBridgeEvent } from '../shared/ipc.ts';
import { BilibiliApi } from './bilibili/api.ts';
import { LivePage } from './bilibili/live-page.ts';
import { resolveWatchConfig, resolveWatchModel, watchDataDirectory } from './config.ts';
import { readHearingModel, saveHearingModel } from './hearing-settings.ts';
import { createRecordingRoutes } from './routes/recording.ts';
import { createSetupRoutes } from './routes/setup.ts';
import { createWindowRoutes } from './routes/window.ts';
import { createWatchBlive, type WatchBlive } from './runtime.ts';

const startSchema = z.object({
  mode: z.discriminatedUnion('type', [
    z.object({ type: z.literal('follow'), roomId: z.number().int().positive() }),
    z.object({ type: z.literal('explore'), areaId: z.number().int().positive() }),
    z.object({
      type: z.literal('recording'),
      prompt: z.string().trim().optional(),
      roomId: z.number().int().positive(),
      source: z.discriminatedUnion('type', [
        z.object({ type: z.literal('url'), url: z.url() }),
        z.object({ type: z.literal('file'), path: z.string().trim().min(1) }),
      ]),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional(),
    }),
  ]),
  danmakuDelivery: z.enum(['simulate', 'live']).optional(),
});

/** 固定观看场景的资源与路由共享同一生命周期，初始化失败按逆序回收。 */
export async function createWatchApplication(mainWindow: BrowserWindow) {
  await using resources = new AsyncDisposableStack();
  const storage = resources.use(
    await Storage.open({
      dataDir: join(watchDataDirectory(), 'storage'),
      modules: [sessionStorage, memoryStorage, vectorStorage, devtoolsStorage],
    }),
  );
  // PGlite 没有后台 checkpointer：不推进 checkpoint 的话，进程被强杀后下次启动要重放
  // 上个 checkpoint 之后的全部 WAL，随会话数只增不减。
  let checkpointsStopped = false;
  const advanceCheckpoint = () => {
    if (checkpointsStopped) return;
    void storage.checkpoint().catch(error => console.error('推进存储 checkpoint 失败', error));
  };
  const checkpointInterval = setInterval(advanceCheckpoint, 5 * 60_000);
  const firstCheckpoint = setTimeout(advanceCheckpoint, 15_000);
  resources.defer(() => {
    checkpointsStopped = true;
    clearInterval(checkpointInterval);
    clearTimeout(firstCheckpoint);
  });
  // 历史重放留给后台：它随会话数增长，不能排在窗口显示前面。
  const devtools = resources.use(await DevtoolsHost.open({ storage, awaitReplay: false }));
  const mcp = resources.use(
    await createMcp({ configFile: join(watchDataDirectory(), 'mcp.json') }),
  );

  const livePage = new LivePage();
  resources.defer(() => livePage.close());
  const api = new BilibiliApi();
  const listeners = new Set<(event: WatchBridgeEvent) => void>();
  let runtime: WatchBlive | undefined;
  const dataDirectory = watchDataDirectory();
  let hearingModel = readHearingModel(dataDirectory);
  let unsubscribe: (() => void) | undefined;
  const lifetimeController = new AbortController();

  function requireRuntime() {
    if (lifetimeController.signal.aborted) throw new Error('Watch Blive 已关闭');
    if (runtime) return runtime;
    const config = resolveWatchConfig();
    const ai = resolveWatchModel(config);
    runtime = createWatchBlive({
      mcp,
      model: ai.model,
      apiKey: ai.apiKey,
      livePage,
      api,
      devtools,
      storage,
      dataDir: dataDirectory,
      ffmpegPath: config.ffmpegPath,
      wake: config.wake === false ? undefined : config.wake,
      perception: {
        asr: {
          model: hearingModel,
          bufferSeconds: 30,
          // 不覆盖 vad：沿用包默认的 0.5 秒停顿 / 10 秒单段上限。
        },
      },
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
        // 先注册再发送快照，避免订阅建立期间漏掉房间事件。
        listeners.add(receive);
        signal?.addEventListener('abort', abort);
        lifetimeController.signal.addEventListener('abort', abort);
        try {
          yield { type: 'status', status: runtime?.status ?? 'idle' } satisfies WatchBridgeEvent;
          const room = runtime?.room;
          const sessionId = runtime?.sessionId;
          if (room && sessionId)
            yield { type: 'room_opened', room, sessionId } satisfies WatchBridgeEvent;
          while (!signal?.aborted && !lifetimeController.signal.aborted) {
            const pending = new Promise<void>(resolve => {
              wake = resolve;
            });
            if (queue.length) yield queue.shift()!;
            else await pending;
          }
        } finally {
          listeners.delete(receive);
          signal?.removeEventListener('abort', abort);
          lifetimeController.signal.removeEventListener('abort', abort);
        }
      }),
    },
    setup: createSetupRoutes(async model => {
      const previous = hearingModel;
      await runtime?.setHearingModel(model);
      try {
        saveHearingModel(dataDirectory, model);
      } catch (error) {
        await runtime?.setHearingModel(previous);
        throw error;
      }
      hearingModel = model;
    }, hearingModel),
    recording: createRecordingRoutes(mainWindow),
    window: createWindowRoutes(mainWindow, livePage, roomId => {
      for (const listener of listeners) listener({ type: 'room_requested', roomId });
    }),
  };

  resources.defer(async () => {
    lifetimeController.abort();
    unsubscribe?.();
    listeners.clear();
    await runtime?.close();
  });
  const lifetime = resources.move();
  let closing: Promise<void> | undefined;
  return { router, close: () => (closing ??= lifetime.disposeAsync()) };
}
export type WatchRouter = Awaited<ReturnType<typeof createWatchApplication>>['router'];
