import { os, ORPCError } from '@orpc/server';
import * as z from 'zod';

import type { TraceEntry } from '../../protocol/index.ts';
import type { DevtoolsHost } from '../host.ts';
import type { DevtoolsRouterOptions } from '../router.ts';

// 游标采用记录序号，翻页期间新写入的记录不会挤占历史页的位置。
const pageSchema = z.object({
  cursor: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(300).default(100),
  sessionId: z.string().min(1).max(300).optional(),
});
const idSchema = z.object({ id: z.string().min(1).max(200) });

export function createRunRoutes(host: DevtoolsHost, options: DevtoolsRouterOptions = {}) {
  return {
    list: os.input(pageSchema).handler(({ input }) => listRecords(host, 'run', input, options)),
  };
}

export function createStepRoutes(host: DevtoolsHost, options: DevtoolsRouterOptions = {}) {
  return {
    list: os.input(pageSchema).handler(({ input }) => listRecords(host, 'step', input, options)),
  };
}

export function createEntryRoutes(host: DevtoolsHost, options: DevtoolsRouterOptions = {}) {
  return {
    list: os
      .input(pageSchema.extend({ runId: z.string().optional() }))
      .handler(({ input }) => listRecords(host, 'entry', input, options)),
    get: os.input(idSchema).handler(({ input }) => readEntry(host, input.id)),
  };
}

export function createMessageRoutes(host: DevtoolsHost) {
  return {
    get: os
      .input(z.object({ messageId: z.string().min(1).max(200) }))
      .handler(({ input }) => host.store.get<unknown>(input.messageId + ':output')),
  };
}

function listRecords(
  host: DevtoolsHost,
  category: 'run' | 'step' | 'entry',
  input: { cursor?: number; limit: number; runId?: string; sessionId?: string },
  options: DevtoolsRouterOptions,
) {
  if (input.sessionId && options.session && !options.session(input.sessionId)) return [];

  return host.store
    .list<TraceEntry>(category, {
      before: input.cursor,
      limit: input.limit,
      runId: input.runId,
      sessionId: input.sessionId,
    })
    .then(entries => entries.filter(entry => options.session?.(entry.sessionId) ?? true));
}

async function readEntry(host: DevtoolsHost, id: string) {
  const entry = await host.store.get<TraceEntry>(id);
  if (!entry) throw new ORPCError('NOT_FOUND');
  return entry;
}
