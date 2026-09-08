import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { defineCiel, type Ciel, type CielSession } from '@cieljs/core';
import type { DevtoolsHost } from '@cieljs/devtools/host';
import { createPerception, type Perception, type PerceptionOptions } from '@cieljs/perception';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

import type {
  Account,
  RoomInfo,
  StartWatchOptions,
  WatchEvent,
  WatchStatus,
} from '../shared/types.ts';
import { parseDecision, RoomDecisionSchema, RoomSelectionSchema } from './agent/decisions.ts';
import { createRoomSessionOptions } from './agent/room-session.ts';
import { createDanmakuTool, DanmakuRunGate } from './agent/tools.ts';
import { BilibiliApi } from './bilibili/api.ts';
import { LivePage } from './bilibili/live-page.ts';
import { LiveMedia } from './media/live-media.ts';
import {
  createCandidateSources,
  createExplorationQuestion,
  createSystemPrompt,
  ROOM_REVIEW_AFTER_MS,
} from './prompts.ts';
import { RoomScorePolicy } from './room-score-policy.ts';
import { RoomVisit } from './room-visit.ts';

export interface WatchBliveOptions {
  devtools?: DevtoolsHost;
  model: Model<Api>;
  livePage: LivePage;
  dataDir?: string;
  api?: BilibiliApi;
  ffmpegPath?: string;
  perception?: PerceptionOptions;
  createPerception?: (options: PerceptionOptions) => Perception;
  periodicObservationMs?: number;
  minimumThinkIntervalMs?: number;
}

export interface WatchBlive {
  readonly status: WatchStatus;
  readonly room?: RoomInfo;

  start(options: StartWatchOptions): Promise<void>;
  stop(): Promise<void>;
  login(): Promise<Account>;
  logout(): Promise<void>;
  areas(): ReturnType<BilibiliApi['areas']>;
  close(): Promise<void>;
  onEvent(listener: (event: WatchEvent) => void): () => void;
}

const EXPLORATION_SYSTEM_PROMPT = `你负责从宿主提供的真实 Bilibili 直播间候选中选择一个房间。可通过只读工具检索其他房间的 Session 与 Memory，结合来源判断；不编造候选，最终只返回指定 JSON。`;

export function createWatchBlive(options: WatchBliveOptions): WatchBlive {
  return new WatchBliveRuntime(options);
}

class WatchBliveRuntime implements WatchBlive {
  private currentStatus: WatchStatus = 'idle';
  private startOptions?: Required<Pick<StartWatchOptions, 'danmakuDelivery'>> & StartWatchOptions;
  private closePromise?: Promise<void>;
  private operation: Promise<void> = Promise.resolve();
  private runController?: AbortController;
  private ciel?: Ciel;
  private visit?: RoomVisit;
  private accountValue?: Account;
  private visitGeneration = 0;
  private readonly listeners = new Set<(event: WatchEvent) => void>();
  private readonly api: BilibiliApi;
  private readonly danmakuGate = new DanmakuRunGate();
  private readonly scorePolicy = new RoomScorePolicy();

  constructor(private readonly options: WatchBliveOptions) {
    this.api = options.api ?? new BilibiliApi();
  }

  get status(): WatchStatus {
    return this.currentStatus;
  }

  get room(): RoomInfo | undefined {
    return this.visit?.room;
  }

  onEvent(listener: (event: WatchEvent) => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  areas(): ReturnType<BilibiliApi['areas']> {
    return this.api.areas();
  }

  async login(): Promise<Account> {
    await this.options.livePage.login();
    this.setStatus('awaiting-login');

    for (let attempt = 0; attempt < 240; attempt += 1) {
      const account = await this.options.livePage.account();

      if (account) {
        this.accountValue = account;
        this.setStatus(this.ciel ? 'watching' : 'idle');
        return account;
      }

      await delay(1_500);
    }

    throw new Error('等待 Bilibili 登录超时');
  }

  async logout(): Promise<void> {
    await this.stop();
    this.accountValue = undefined;
    await this.options.livePage.logout();
  }

  start(options: StartWatchOptions): Promise<void> {
    if (this.closePromise) {
      throw new Error('Watch Blive 已关闭');
    }

    validateStartOptions(options);
    this.runController?.abort();

    const controller = new AbortController();
    this.runController = controller;

    return this.enqueue(async () => {
      await this.stopRuntime();
      controller.signal.throwIfAborted();
      await this.startRuntime(options, controller.signal);
    });
  }

  private async startRuntime(options: StartWatchOptions, signal: AbortSignal): Promise<void> {
    this.startOptions = {
      ...options,
      danmakuDelivery: options.danmakuDelivery ?? 'simulate',
    };
    this.setStatus('starting');

    try {
      this.accountValue = await this.options.livePage.account();

      if (this.startOptions.danmakuDelivery === 'live' && !this.accountValue) {
        this.setStatus('awaiting-login');
        throw new Error('真实弹幕模式需要先登录 Bilibili');
      }

      signal.throwIfAborted();
      this.ciel = this.createCiel();
      await this.ciel.start();
      signal.throwIfAborted();

      if (options.mode.type === 'follow') {
        const room = await this.api.room(options.mode.roomId);
        await this.openRoom(room, signal);
      } else {
        await this.explore(options.mode.areaId, signal);
      }
    } catch (error) {
      await this.disposeRuntime();
      this.setStatus('idle');
      this.emitError('start', error);
      throw error;
    }
  }

  stop(): Promise<void> {
    this.runController?.abort();

    return this.enqueue(() => this.stopRuntime());
  }

  // 启动、切房和停止共用一条队列，资源关闭后才允许下一次打开。
  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = this.operation.then(action);
    this.operation = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeRuntime();

    return this.closePromise;
  }

  private createCiel(): Ciel {
    const root = resolve(this.options.dataDir ?? join(homedir(), '.ciel'));

    mkdirSync(root, { recursive: true });

    const danmakuTool = createDanmakuTool(
      {
        delivery: () => this.requireStartOptions().danmakuDelivery,
        livePage: this.options.livePage,
        room: () => this.visit?.room,
        sentDanmaku: () => this.visit?.history.map(item => item.content) ?? [],
        canSend: () => this.currentStatus === 'watching' && !this.runController?.signal.aborted,
        emit: event => this.recordDanmakuEvent(event),
      },
      this.danmakuGate,
    );

    return defineCiel({
      model: this.options.model,
      systemPrompt: createSystemPrompt(this.requireStartOptions().mode),
      tools: [danmakuTool],
      session: { dataDir: join(root, 'session') },
      memory: { dataDir: join(root, 'memory') },
      investigation: {
        dataDir: join(root, 'investigation'),
        systemPrompt: EXPLORATION_SYSTEM_PROMPT,
      },
      mcp: { enabled: true, configFile: join(root, 'mcp.json') },
    });
  }

  private async explore(areaId: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.closeVisit('explore');
    signal.throwIfAborted();
    const ciel = this.requireCiel();

    this.setStatus('exploring');
    this.emit({ type: 'exploration_started', areaId });

    const candidates = await this.api.rooms(areaId);
    this.options.devtools?.record('list_live_rooms', candidates, 'bilibili:exploration');
    signal.throwIfAborted();

    if (candidates.length === 0) {
      throw new Error(`分区 ${areaId} 当前没有直播候选`);
    }

    const result = await ciel.investigate({
      spaceId: 'bilibili:exploration',
      signal,
      crossSpace: true,
      sources: createCandidateSources(areaId, candidates),
      question: createExplorationQuestion(candidates),
      onEvent: this.options.devtools?.agentListener(`bilibili:exploration:${Date.now()}`),
    });
    signal.throwIfAborted();
    const selection = parseDecision(messageText(result.answer), RoomSelectionSchema);
    const candidate = candidates.find(item => item.roomId === selection.roomId);

    if (!candidate) {
      throw new Error(`Agent 选择的直播间 ${selection.roomId} 不在本轮候选中`);
    }

    this.emit({ type: 'room_selected', roomId: candidate.roomId, reason: selection.reason });

    const room = await this.api.room(candidate.roomId);
    await this.openRoom(room, signal);
  }

  private async openRoom(room: RoomInfo, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (!room.live) {
      throw new Error(`直播间 ${room.roomId} 当前未开播`);
    }

    await this.closeVisit('switch');
    signal.throwIfAborted();
    this.setStatus('opening');

    const generation = ++this.visitGeneration;
    let session: CielSession | undefined;
    const perception = (this.options.createPerception ?? createPerception)({
      vision: { sampleIntervalMs: 6_666, differenceThreshold: 0.03, maxFrames: 9 },
      retentionMs: 60_000,
      ...this.options.perception,
    });

    try {
      await this.options.livePage.open(room.roomId);
      await this.waitUntilReady(room.roomId, generation, signal);

      const startedAt = Date.now();
      session = await this.requireCiel().session(
        createRoomSessionOptions(room, new Date(startedAt)),
      );
      const playUrl = await this.api.playUrl(room.roomId);
      signal.throwIfAborted();
      const media = new LiveMedia({
        roomId: room.roomId,
        playUrl,
        perception,
        ffmpegPath: this.options.ffmpegPath,
        onError: error => this.emitError('media', error),
      });
      const visit = new RoomVisit({
        devtools: this.options.devtools,
        generation,
        room,
        startedAt,
        session,
        perception,
        media,
        minimumThinkIntervalMs: this.options.minimumThinkIntervalMs ?? 5_000,
        periodicObservationMs: this.options.periodicObservationMs ?? 30_000,
        canSwitch: () => this.canSwitch(startedAt),
        beforeRun: () => this.danmakuGate.beginRun(),
        afterRun: () => this.inspectDecision(generation, signal),
        emit: event => this.emit(event),
      });
      this.visit = visit;
      visit.start();
      this.setStatus('watching');
      this.emit({ type: 'room_opened', room });
    } catch (error) {
      this.options.livePage.close();
      if (this.visit?.generation === generation) {
        await this.closeVisit('open_failed');
      } else {
        await Promise.all([session?.close(), perception.close()]);
      }
      throw error;
    }
  }

  private inspectDecision(generation: number, signal: AbortSignal): void {
    const visit = this.visit;
    const mode = this.requireStartOptions().mode;

    if (mode.type === 'follow' || !visit || visit.generation !== generation || signal.aborted) {
      return;
    }

    const assistant = visit.session.agent.state.messages.findLast(
      message => message.role === 'assistant',
    );

    if (!assistant) {
      return;
    }

    const decision = parseDecision(messageText(assistant), RoomDecisionSchema);

    this.emit({
      type: 'room_evaluated',
      action: decision.action,
      confidence: decision.confidence,
      score: decision.score,
    });

    if (!this.canSwitch(visit.startedAt)) {
      return;
    }

    const switchDecision = this.scorePolicy.evaluate(decision);

    if (!switchDecision.shouldSwitch) {
      return;
    }

    // 不在 afterRun 内等待切房，否则 closeVisit 会等待当前调度任务自身。
    void this.enqueue(() => this.explore(mode.areaId, signal)).catch(error => {
      if (!signal.aborted) {
        this.emitError('explore', error);
      }
    });
  }

  private async waitUntilReady(
    roomId: number,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      signal.throwIfAborted();
      if (generation !== this.visitGeneration) {
        throw new Error('等待直播页面时房间已切换');
      }

      const readiness = await this.options.livePage.readiness();

      signal.throwIfAborted();
      if (readiness.ready && readiness.roomId === roomId) {
        return;
      }

      await delay(60);
    }

    throw new Error(`直播间 ${roomId} 页面未在预期时间内就绪`);
  }

  private async closeVisit(reason: string): Promise<void> {
    const visit = this.visit;

    this.visit = undefined;
    this.visitGeneration += 1;
    this.scorePolicy.reset();

    if (!visit) {
      return;
    }

    this.options.livePage.close();
    await visit.close();

    this.emit({ type: 'room_closed', roomId: visit.room.roomId, reason });
  }

  private async stopRuntime(): Promise<void> {
    if (this.currentStatus === 'closed') {
      return;
    }

    this.setStatus('stopping');
    await this.disposeRuntime();
    this.startOptions = undefined;
    this.setStatus('idle');
  }

  private async disposeRuntime(): Promise<void> {
    await this.closeVisit('stop');
    await this.ciel?.close();
    this.ciel = undefined;
  }

  private async closeRuntime(): Promise<void> {
    await this.stop();
    this.currentStatus = 'closed';
    this.listeners.clear();
  }

  private recordDanmakuEvent(event: WatchEvent): void {
    if (event.type === 'danmaku_delivered') {
      if (this.visit?.room.roomId !== event.roomId) {
        return;
      }
      this.visit.history.push({ content: event.content, sentAt: Date.now() });
    }

    this.emit(event);
  }

  private canSwitch(startedAt: number): boolean {
    return (
      this.requireStartOptions().mode.type === 'explore' &&
      Date.now() - startedAt >= ROOM_REVIEW_AFTER_MS
    );
  }

  private requireStartOptions() {
    if (!this.startOptions) {
      throw new Error('Watch Blive 尚未启动');
    }

    return this.startOptions;
  }

  private requireCiel(): Ciel {
    if (!this.ciel) {
      throw new Error('Ciel 尚未启动');
    }

    return this.ciel;
  }

  private setStatus(status: WatchStatus): void {
    this.currentStatus = status;
    this.emit({ type: 'status', status });
  }

  private emit(event: WatchEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private emitError(stage: string, error: unknown): void {
    this.emit({ type: 'error', stage, error: toError(error) });
  }
}

function validateStartOptions(options: StartWatchOptions): void {
  const value = options.mode.type === 'follow' ? options.mode.roomId : options.mode.areaId;

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${options.mode.type === 'follow' ? 'roomId' : 'areaId'} 必须是正整数`);
  }
}

function messageText(message: AgentMessage): string {
  if (message.role !== 'assistant' && message.role !== 'user') {
    throw new Error(`无法从 ${message.role} 消息读取文本决策`);
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  return message.content
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('');
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
