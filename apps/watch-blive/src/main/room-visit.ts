import type { CielSession } from '@cieljs/core';
import type { DevtoolsHost } from '@cieljs/devtools/host';
import type { Perception } from '@cieljs/perception';

import type { RoomInfo, StreamerHistory, WatchEvent, WatchMode } from '../shared/types.ts';
import type { LiveMedia } from './media/live-media.ts';
import { createRoomContext, type SentDanmaku } from './prompts.ts';
import { ThoughtScheduler } from './scheduling/thought-scheduler.ts';

interface RoomVisitOptions {
  devtools?: DevtoolsHost;
  generation: number;
  room: RoomInfo;
  mode: WatchMode;
  streamerHistory?: StreamerHistory;
  startedAt: number;
  session: CielSession;
  perception: Perception;
  media: LiveMedia;
  minimumThinkIntervalMs: number;
  periodicObservationMs: number;
  canSwitch: () => boolean;
  beforeRun: () => void;
  afterRun: () => void;
  emit: (event: WatchEvent) => void;
}

/** 一次访问拥有感知、媒体与思考任务；持久化身份由房间和日期另行决定。 */
export class RoomVisit {
  readonly history: SentDanmaku[] = [];
  private readonly scheduler: ThoughtScheduler;
  private unsubscribeSpeechEnd?: () => void;
  private periodicTimer?: ReturnType<typeof setInterval>;
  private closePromise?: Promise<void>;
  private unsubscribeAgent?: () => void;
  private unsubscribePerceptionError?: () => void;

  constructor(private readonly options: RoomVisitOptions) {
    this.scheduler = new ThoughtScheduler({
      perception: options.perception,
      agent: options.session.agent,
      minimumIntervalMs: options.minimumThinkIntervalMs,
      startedAt: new Date(options.startedAt),
      context: () => ({
        role: 'user',
        content: createRoomContext({
          room: options.room,
          mode: options.mode,
          startedAt: options.startedAt,
          history: this.history,
          canSwitch: options.canSwitch(),
          streamerHistory: options.streamerHistory,
        }),
        timestamp: Date.now(),
      }),
      beforeRun: options.beforeRun,
      afterRun: options.afterRun,
      onRunStarted: triggerCount => options.emit({ type: 'thought_started', triggerCount }),
      onRunFinished: durationMs => options.emit({ type: 'thought_finished', durationMs }),
      onError: error => options.emit({ type: 'error', stage: 'thought', error }),
    });
  }

  get generation() {
    return this.options.generation;
  }
  get room() {
    return this.options.room;
  }
  get startedAt() {
    return this.options.startedAt;
  }
  get session() {
    return this.options.session;
  }

  start() {
    this.unsubscribeAgent = this.options.devtools?.observe(this.session.agent, this.session.id);
    this.unsubscribePerceptionError = this.options.perception.on('error', error =>
      this.options.emit({ type: 'error', stage: 'perception', error }),
    );
    this.options.media.start();
    if (this.options.mode.type === 'recording') return;
    this.unsubscribeSpeechEnd = this.options.perception.on('speechend', ({ at }) =>
      this.scheduler.trigger(at),
    );
    this.periodicTimer = setInterval(
      () => this.scheduler.trigger(new Date()),
      this.options.periodicObservationMs,
    );
  }

  cancel(): void {
    this.scheduler.cancel();
    this.session.agent.abort();
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  async finishRecording(signal?: AbortSignal, partial = false): Promise<void> {
    clearInterval(this.periodicTimer);
    this.unsubscribeSpeechEnd?.();
    await this.options.media.close();
    this.options.emit({ type: 'video_progress', stage: 'recognizing' });
    // close 会 flush ASR 并等待尾部识别发布；快照在关闭后仍可读取。
    await this.options.perception.close();
    if (this.closePromise || signal?.aborted) return;
    this.options.emit({ type: 'video_progress', stage: 'analyzing' });
    const summary = partial
      ? '用户中途停止了视频，视频尚未完整看完。请只总结本次已经读取的画面和语音，明确标注这是一份部分总结，不推测后续内容，不声称看完全部视频。覆盖已观察到的主题、关键内容、分析结论、值得记住的信息与仍不确定之处；继续遵守视频模式的记忆规则。'
      : '录播已经播放结束。请基于本次 Session 中的全部亲历内容给出最终总结：覆盖主题、关键内容、分析结论、值得记住的信息与仍不确定之处；继续遵守录播模式的记忆规则。';
    await this.scheduler.finish(summary, this.options.media.endAt, signal);
  }

  private async closeResources() {
    clearInterval(this.periodicTimer);
    this.unsubscribeSpeechEnd?.();

    // 先停止触发并等当前思考结束，再关闭可能产生最后一次 speechend 的感知资源。
    await this.scheduler.close();
    this.unsubscribeAgent?.();
    this.unsubscribePerceptionError?.();
    const media = await Promise.allSettled([this.options.media.close()]);
    const remaining = await Promise.allSettled([
      this.options.perception.close(),
      this.options.session.close(),
    ]);
    const failures = [...media, ...remaining]
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);

    if (failures.length) {
      throw new AggregateError(failures, `直播间 ${this.room.roomId} 关闭失败`);
    }
  }
}
