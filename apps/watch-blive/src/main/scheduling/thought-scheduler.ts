import type { Perception } from '@cieljs/perception';
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';

export interface ThoughtSchedulerOptions {
  perception: Pick<Perception, 'snapshot'>;
  agent: Pick<Agent, 'prompt'>;
  minimumIntervalMs: number;
  startedAt: Date;
  context: () => AgentMessage;
  beforeRun?: () => void;
  afterRun?: () => Promise<void> | void;
  onRunStarted?: (triggerCount: number) => void;
  onRunFinished?: (durationMs: number) => void;
  onError?: (error: Error) => void;
}

interface PendingWindow {
  startAt: Date;
  endAt: Date;
  triggerCount: number;
}

export class ThoughtScheduler {
  private capturedThrough: number;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private pending?: PendingWindow;
  private active?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private finishing = false;

  constructor(private readonly options: ThoughtSchedulerOptions) {
    this.capturedThrough = options.startedAt.getTime() - 1;
  }

  trigger(at = new Date()): void {
    if (this.closed) {
      return;
    }

    // 迟到或同一毫秒的触发不能倒退已消费的快照边界。
    if (at.getTime() <= this.capturedThrough) return;

    const startAt = this.pending?.startAt ?? new Date(this.capturedThrough + 1);
    const triggerCount = (this.pending?.triggerCount ?? 0) + 1;

    this.capturedThrough = Math.max(this.capturedThrough, at.getTime());
    this.pending = { startAt, endAt: at, triggerCount };

    this.schedule();
  }

  cancel(): void {
    this.closed = true;
    this.pending = undefined;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async close(): Promise<void> {
    this.cancel();
    await this.active;
  }

  /** 录播结束后把尚未消费的感知附在总结请求前，避免关闭时丢掉尾段。 */
  async finish(summary: string, mediaEndAt?: Date, signal?: AbortSignal): Promise<void> {
    this.finishing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.active;
    const startAt = this.pending?.startAt ?? new Date(this.capturedThrough + 1);
    await this.close();
    const endAt = new Date(Math.max(mediaEndAt?.getTime() ?? Date.now(), startAt.getTime()));
    const snapshot = await this.options.perception.snapshot({ startAt, endAt });
    const messages = await snapshot.compose();
    if (signal?.aborted) return;
    await this.options.agent.prompt([
      ...messages,
      this.options.context(),
      { role: 'user', content: summary, timestamp: Date.now() },
    ]);
  }

  private schedule(): void {
    if (this.closed || this.finishing || this.active || this.timer || !this.pending) {
      return;
    }

    const delay = Math.max(0, this.lastRunAt + this.options.minimumIntervalMs - Date.now());

    if (delay === 0) {
      this.startRun();
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.startRun();
    }, delay);
  }

  private startRun(): void {
    const window = this.pending;

    if (!window || this.closed) {
      return;
    }

    this.pending = undefined;
    this.lastRunAt = Date.now();
    this.options.beforeRun?.();
    this.options.onRunStarted?.(window.triggerCount);
    this.active = this.run(window).finally(() => {
      this.active = undefined;
      this.schedule();
    });
  }

  private async run(window: PendingWindow): Promise<void> {
    const startedAt = Date.now();

    try {
      const snapshot = await this.options.perception.snapshot({
        startAt: window.startAt,
        endAt: window.endAt,
      });
      const messages = await snapshot.compose();

      if (this.closed) {
        return;
      }

      await this.options.agent.prompt([...messages, this.options.context()]);
      await this.options.afterRun?.();
      this.options.onRunFinished?.(Date.now() - startedAt);
    } catch (error) {
      const failure = toError(error);
      const aborted =
        failure.name === 'AbortError' || failure.message.includes('Request was aborted');
      if (this.closed && aborted) {
        return;
      }
      if (toError(error).message.includes('content_filter')) {
        this.closed = true;
        this.pending = undefined;
      }
      this.options.onError?.(toError(error));
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
