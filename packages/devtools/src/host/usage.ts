import type { RuntimeRecord } from '@cieljs/agent-kit/protocol';

import type { DevtoolsSession, DevtoolsUsage, TraceUsage } from '../protocol/index.ts';

type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
};

/**
 * 累计模型用量。message_end 是每条 assistant 消息唯一一次收尾，按它求和不会像
 * message_update 那样把同一次请求重复计入；宿主每次启动完整重放事件，计数随之重建。
 */
export class TraceUsageTally {
  private readonly total = empty();
  private context: TraceUsage | null = null;
  private readonly sessionStates = new Map<
    string,
    { startedAt: number; endedAt: number; total: TraceUsage; context: TraceUsage | null }
  >();

  consume(record: RuntimeRecord) {
    const session = this.touch(record.sessionId, record.timestamp);
    if (record.event.type !== 'message_end') return;

    const usage = assistantUsage(record.event.message);
    if (!usage) return;

    this.context = usage;
    session.context = usage;
    addUsage(this.total, usage);
    addUsage(session.total, usage);
  }

  touch(sessionId: string, timestamp: number) {
    const existing = this.sessionStates.get(sessionId);
    if (existing) {
      existing.startedAt = Math.min(existing.startedAt, timestamp);
      existing.endedAt = Math.max(existing.endedAt, timestamp);
      return existing;
    }

    const session = { startedAt: timestamp, endedAt: timestamp, total: empty(), context: null };
    this.sessionStates.set(sessionId, session);
    return session;
  }

  snapshot(sessionId?: string): DevtoolsUsage {
    if (sessionId) {
      const session = this.sessionStates.get(sessionId);
      if (!session) return { total: empty(), context: null };
      return { total: { ...session.total }, context: session.context && { ...session.context } };
    }

    return { total: { ...this.total }, context: this.context };
  }

  sessions(): DevtoolsSession[] {
    return [...this.sessionStates.entries()]
      .map(([id, session]) => ({
        id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        usage: this.snapshot(id),
        turn: 0,
        steps: 0,
      }))
      .sort((left, right) => left.startedAt - right.startedAt);
  }
}

function addUsage(target: TraceUsage, usage: TraceUsage) {
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.total += usage.total;
}

function empty(): TraceUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

/**
 * 只认带有效用量的 assistant 消息；错误和中断的请求同样计入了消耗，不能按 stopReason 丢弃。
 * 但对不上号的零用量（例如还没产出就被中止）既不计入累计，也不该顶替当前上下文。
 */
function assistantUsage(message: unknown): TraceUsage | null {
  const value = message as { role?: unknown; usage?: Partial<Usage> };
  if (value?.role !== 'assistant' || !value.usage) return null;

  const usage = value.usage;
  const counts = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens];
  if (!counts.every(count => Number.isFinite(count) && count! >= 0)) return null;

  const { input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = usage;
  const total = usage.totalTokens || input + output + cacheRead + cacheWrite;
  if (total <= 0) return null;

  return { input, output, cacheRead, cacheWrite, total };
}
