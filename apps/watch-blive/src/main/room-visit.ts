import type { CielSession } from "@cieljs/core";
import type { Perception } from "@cieljs/perception";

import type { RoomInfo, WatchEvent } from "../shared/types.ts";
import type { LiveMedia } from "./media/live-media.ts";
import { createRoomContext, type SentDanmaku } from "./prompts.ts";
import { ThoughtScheduler } from "./scheduling/thought-scheduler.ts";
import type { DevtoolsHost } from "@cieljs/devtools/host";

interface RoomVisitOptions {
  devtools?: DevtoolsHost;
  generation: number;
  room: RoomInfo;
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

  constructor(private readonly options: RoomVisitOptions) {
    this.scheduler = new ThoughtScheduler({
      perception: options.perception,
      agent: options.session.agent,
      minimumIntervalMs: options.minimumThinkIntervalMs,
      startedAt: new Date(options.startedAt),
      context: () => ({
        role: "user",
        content: createRoomContext({
          room: options.room,
          startedAt: options.startedAt,
          history: this.history,
          canSwitch: options.canSwitch(),
        }),
        timestamp: Date.now(),
      }),
      beforeRun: options.beforeRun,
      afterRun: options.afterRun,
      onRunStarted: (triggerCount) => options.emit({ type: "thought_started", triggerCount }),
      onRunFinished: (durationMs) => options.emit({ type: "thought_finished", durationMs }),
      onError: (error) => options.emit({ type: "error", stage: "thought", error }),
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
    this.options.media.start();
    this.unsubscribeSpeechEnd = this.options.perception.on("speechend", ({ at }) =>
      this.scheduler.trigger(at),
    );
    this.periodicTimer = setInterval(
      () => this.scheduler.trigger(new Date()),
      this.options.periodicObservationMs,
    );
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  private async closeResources() {
    clearInterval(this.periodicTimer);
    this.unsubscribeSpeechEnd?.();

    // 先停止触发并等当前思考结束，再关闭可能产生最后一次 speechend 的感知资源。
    await this.scheduler.close();
    this.unsubscribeAgent?.();
    const media = await Promise.allSettled([this.options.media.close()]);
    const remaining = await Promise.allSettled([
      this.options.perception.close(),
      this.options.session.close(),
    ]);
    const failures = [...media, ...remaining]
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);

    if (failures.length) {
      throw new AggregateError(failures, `直播间 ${this.room.roomId} 关闭失败`);
    }
  }
}
