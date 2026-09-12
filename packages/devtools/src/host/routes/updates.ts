import { os, ORPCError } from '@orpc/server';

import type { DevtoolsUpdate, TraceEntry } from '../../protocol/index.ts';
import type { DevtoolsHost } from '../host.ts';

export function createUpdatesProcedure(host: DevtoolsHost) {
  return os.handler(({ signal }) => subscribeUpdates(host, signal));
}

/** 先订阅再读快照，读取期间到达的变更留在队列中，避免初始化丢事件。 */
async function* subscribeUpdates(
  host: DevtoolsHost,
  requestSignal?: AbortSignal,
): AsyncGenerator<DevtoolsUpdate> {
  // 宿主关闭与客户端取消都必须唤醒等待中的订阅。
  const signal = requestSignal ? AbortSignal.any([requestSignal, host.signal]) : host.signal;
  if (signal.aborted) return;

  let wake: (() => void) | undefined;
  let dirty = false;
  const changed = new Map<string, TraceEntry>();
  const steps = new Map<string, TraceEntry>();
  const notify = (update: DevtoolsUpdate) => {
    for (const entry of update.entries) changed.set(entry.id, entry);
    for (const step of update.steps) steps.set(step.id, step);
    dirty = true;
    wake?.();
  };
  const unsubscribe = host.subscribe(notify);
  const abort = () => wake?.();
  signal.addEventListener('abort', abort);
  try {
    checkHealth(host);
    const initial = host.usage();
    let sent = JSON.stringify(initial);
    yield {
      entries: await host.store.list<TraceEntry>('entry', { limit: 300 }),
      steps: await host.store.list<TraceEntry>('step', { limit: 300 }),
      usage: initial,
      sessions: host.sessions(),
    };
    while (!signal.aborted) {
      checkHealth(host);
      const pending = new Promise<void>(resolve => {
        wake = resolve;
      });
      if (dirty) {
        dirty = false;
        const entries = [...changed.values()];
        changed.clear();
        const stepEntries = [...steps.values()];
        steps.clear();
        // 用量随每次推送重新取快照：宿主已合并完整历史，客户端不必自己累加。
        // 只靠用量变化也要推送：后台重放结束后没有新条目，但累计值已经变了。
        const usage = host.usage();
        const current = JSON.stringify(usage);
        if (entries.length || stepEntries.length || current !== sent) {
          sent = current;
          yield { entries, steps: stepEntries, usage, sessions: host.sessions() };
        }
      } else await pending;
    }
  } finally {
    unsubscribe();
    signal.removeEventListener('abort', abort);
  }
}

function checkHealth(host: DevtoolsHost) {
  try {
    host.assertHealthy();
  } catch (cause) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: cause instanceof Error ? cause.message : 'Devtools 事件处理失败',
      cause,
    });
  }
}
