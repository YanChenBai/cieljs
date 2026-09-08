import { os } from '@orpc/server';
import * as z from 'zod';

import type { WatchBridgeEvent } from '../../shared/ipc.ts';
import type { BilibiliApi } from '../bilibili/api.ts';
import type { WatchBlive } from '../runtime.ts';

const startSchema = z.object({
  mode: z.discriminatedUnion('type', [
    z.object({ type: z.literal('follow'), roomId: z.number().int().positive() }),
    z.object({ type: z.literal('explore'), areaId: z.number().int().positive() }),
    z.object({
      type: z.literal('recording'),
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

export function createWatchRoutes(
  api: BilibiliApi,
  current: () => WatchBlive | undefined,
  requireRuntime: () => WatchBlive,
  listeners: Set<(event: WatchBridgeEvent) => void>,
) {
  return {
    start: os.input(startSchema).handler(({ input }) => requireRuntime().start(input)),
    stop: os.handler(() => current()?.stop()),
    areas: os.handler(() => api.areas()),
    snapshot: os.handler(() => ({ status: current()?.status ?? 'idle', room: current()?.room })),
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
      try {
        yield { type: 'status', status: current()?.status ?? 'idle' } satisfies WatchBridgeEvent;
        const room = current()?.room;
        if (room) yield { type: 'room_opened', room } satisfies WatchBridgeEvent;
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
  };
}
