import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { qwen } from '@cieljs/embed';
import { createMcp, type Mcp } from '@cieljs/mcp';
import { memoryStorage } from '@cieljs/memory';
import { createPerception, type Perception, type SpeechEndEvent } from '@cieljs/perception';
import { sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { VectorService, vectorStorage } from '@cieljs/vector';
import type { Api, Model } from '@earendil-works/pi-ai';
import { defineCiel, type Ciel, type CielSession } from 'cieljs';

import { createAudioInput } from './audio/input.ts';
import { AudioNormalizer } from './audio/normalizer.ts';
import { createAudioOutput } from './audio/output.ts';
import type { AudioInput, AudioOutput, DeviceSelector } from './audio/types.ts';
import { resolveDevice } from './audio/types.ts';
import type { ChorusConfig } from './config.ts';
import {
  ConversationScheduler,
  type ChorusEvent,
  type SchedulerState,
} from './conversation/scheduler.ts';
import { createSpeakTool, SpeakController } from './conversation/speak-tool.ts';
import { CHORUS_SYSTEM_PROMPT } from './system-prompt.ts';
import type { TextToSpeech } from './tts/types.ts';
import { createXiaomiTextToSpeech } from './tts/xiaomi.ts';

export type ChorusStatus = 'idle' | 'starting' | 'running' | 'closing' | 'closed';

export interface ChorusOptions {
  config: ChorusConfig;
  model: Model<Api>;
  dataDir?: string;
  input?: AudioInput;
  output?: AudioOutput;
  tts?: TextToSpeech;
  perception?: Perception;
}

export interface Chorus {
  readonly status: ChorusStatus;
  readonly scheduler: SchedulerState;

  start(): Promise<void>;
  close(): Promise<void>;
  onEvent(listener: (event: ChorusEvent) => void): () => void;
}

export function createChorus(options: ChorusOptions): Chorus {
  return new ChorusRuntime(options);
}

class ChorusRuntime implements Chorus {
  private currentStatus: ChorusStatus = 'idle';
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;

  private readonly listeners = new Set<(event: ChorusEvent) => void>();
  private readonly selfEcho = new SelfEchoFilter();

  private storage?: Storage;
  private vectors?: VectorService;
  private ciel?: Ciel;
  private mcp?: Mcp;
  private session?: CielSession;
  private perception?: Perception;
  private schedulerInstance?: ConversationScheduler;
  private input?: AudioInput;
  private output?: AudioOutput;
  private tts?: TextToSpeech;
  private unsubscribeSpeechEnd?: () => void;
  private unsubscribeAgent?: () => void;

  constructor(private readonly options: ChorusOptions) {}

  get status(): ChorusStatus {
    return this.currentStatus;
  }

  get scheduler(): SchedulerState {
    return (
      this.schedulerInstance?.state ?? {
        status: this.currentStatus === 'running' ? 'idle' : 'closed',
      }
    );
  }

  onEvent(listener: (event: ChorusEvent) => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.currentStatus === 'running') {
      return Promise.resolve();
    }

    if (this.currentStatus === 'starting' && this.startPromise) {
      return this.startPromise;
    }

    if (this.currentStatus !== 'idle') {
      return Promise.reject(new Error(`Chorus 当前不可用：${this.currentStatus}`));
    }

    this.currentStatus = 'starting';
    this.startPromise = this.startRuntime();

    return this.startPromise;
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeRuntime();

    return this.closePromise;
  }

  private async startRuntime(): Promise<void> {
    try {
      const config = this.options.config;

      this.tts = this.options.tts ?? this.createDefaultTts();
      this.perception =
        this.options.perception ??
        createPerception({
          asr: config.perception.asr,
          retentionMs: config.perception.retentionMs,
        });
      this.input = this.options.input ?? createAudioInput(config.audio.input);
      this.output =
        this.options.output ?? createAudioOutput({ sampleRate: config.audio.input.sampleRate });

      if (!this.options.input) {
        await assertInputDevice(this.input, config.audio.input.device, config.audio.input.channels);
      }
      if (!this.options.output) {
        await assertOutputDevice(this.output, config.audio.output.device);
      }

      const speak = new SpeakController();
      const speakTool = createSpeakTool({
        controller: speak,
        tts: this.tts,
        output: this.output,
        voice: config.tts.voice,
        format: config.tts.format,
        instructions: config.tts.instructions,
        outputDevice: config.audio.output.device,
        emit: event => this.emit(event),
        onDelivered: delivery => this.selfEcho.recordPlayback(delivery),
        onAecReference: pcm => this.input?.pushAecReference(pcm),
      });

      this.storage = await Storage.open({
        dataDir: join(resolve(this.options.dataDir ?? join(homedir(), '.ciel')), 'storage'),
        modules: [sessionStorage, memoryStorage, vectorStorage],
      });
      if (config.embedding) {
        this.vectors = new VectorService({
          storage: this.storage,
          provider: qwen(config.embedding),
          providerId: 'qwen',
          revision: '1',
          granularity: 'chunk',
          inputConfig: 'qwen-default',
        });
      }

      if (config.mcp.enabled && !this.mcp) {
        const { enabled: _, ...options } = config.mcp;
        this.mcp = await createMcp(options);
      }

      this.ciel = defineCiel({
        model: this.options.model,
        systemPrompt: CHORUS_SYSTEM_PROMPT,
        storage: this.storage,
        vectors: this.vectors,
        tools: [speakTool],
        mcp: this.mcp,
      });

      await this.ciel.start();

      this.session = await this.ciel.session({
        sessionId: config.conversation.sessionId,
        spaceId: config.conversation.spaceId,
        sources: config.conversation.sources,
      });

      this.unsubscribeAgent = this.session.agent.subscribe(event => {
        if (event.type === 'tool_execution_start') {
          this.emit({ type: 'tool_call_started', name: event.toolName, args: event.args });
        } else if (event.type === 'tool_execution_end') {
          this.emit({ type: 'tool_call_finished', name: event.toolName, isError: event.isError });
        }
      });

      const scheduler = new ConversationScheduler({
        perception: this.perception,
        agent: this.session.agent,
        speak,
        minimumThinkIntervalMs: config.conversation.minimumThinkIntervalMs,
        startedAt: new Date(),
        emit: event => this.emit(event),
      });

      this.schedulerInstance = scheduler;

      this.unsubscribeSpeechEnd = this.perception.on('speechend', event =>
        this.handleSpeechEnd(event),
      );

      await this.pumpAudio(scheduler, config);

      this.currentStatus = 'running';
    } catch (error) {
      await this.dispose();
      this.startPromise = undefined;
      this.currentStatus = 'idle';

      throw error;
    }
  }

  private createDefaultTts(): TextToSpeech {
    const apiKey = process.env.XIAOMI_API_KEY;

    if (!apiKey) {
      throw new Error('缺少 XIAOMI_API_KEY 环境变量');
    }

    return createXiaomiTextToSpeech({
      apiKey,
      model: this.options.config.tts.model,
    });
  }

  private async pumpAudio(scheduler: ConversationScheduler, config: ChorusConfig): Promise<void> {
    if (!this.input || !this.perception) {
      return;
    }

    const normalizer = new AudioNormalizer();

    void (async () => {
      for await (const chunk of this.input!.start({ device: config.audio.input.device })) {
        const pcm = normalizer.normalize(chunk);

        if (pcm.length > 0) {
          await this.perception!.asr.write({ data: pcm, startAt: chunk.capturedAt });
        }
      }
    })().catch(error => {
      this.emit({ type: 'error', stage: 'input', error: toError(error) });
    });
  }

  private handleSpeechEnd(event: SpeechEndEvent): void {
    if (!this.schedulerInstance) {
      return;
    }

    if (this.selfEcho.isSelfEcho(event.at, event.result?.content)) {
      this.emit({ type: 'self_echo_ignored', at: event.at });
      this.schedulerInstance.skipThrough(event.at);

      return;
    }

    this.emit({
      type: 'speech_end',
      at: event.at,
      speaker: event.result?.speaker,
      content: event.result?.content,
    });
    this.schedulerInstance.handleSpeechEnd(event.at);
  }

  private async closeRuntime(): Promise<void> {
    if (this.currentStatus === 'closed') {
      return;
    }

    if (this.currentStatus === 'starting' && this.startPromise) {
      // 启动错误由 start() 返回；关闭仍需释放宿主持有的 MCP。
      await Promise.allSettled([this.startPromise]);
    }

    this.currentStatus = 'closing';

    try {
      await this.dispose();
    } finally {
      try {
        await this.mcp?.close();
      } finally {
        this.currentStatus = 'closed';
      }
    }
  }

  private async dispose(): Promise<void> {
    this.unsubscribeSpeechEnd?.();
    this.unsubscribeSpeechEnd = undefined;

    this.unsubscribeAgent?.();
    this.unsubscribeAgent = undefined;

    await this.input?.close();
    await this.schedulerInstance?.close();
    await this.perception?.close();
    await this.output?.stop();
    await this.output?.close();
    await this.tts?.close();
    await this.session?.close();
    try {
      await this.ciel?.close();
    } finally {
      try {
        await this.vectors?.close();
      } finally {
        await this.storage?.close();
      }
    }

    this.schedulerInstance = undefined;
    this.session = undefined;
    this.ciel = undefined;
    this.perception = undefined;
    this.input = undefined;
    this.output = undefined;
    this.tts = undefined;
  }

  private emit(event: ChorusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

async function assertInputDevice(
  input: AudioInput,
  device: DeviceSelector | undefined,
  channels: number,
): Promise<void> {
  const devices = await input.devices();

  if (device === undefined) {
    if (!devices.some(candidate => candidate.maxInputChannels > 0)) {
      throw new Error('未找到可用的输入设备');
    }

    return;
  }

  const resolved = resolveDevice(devices, device);

  if (!resolved) {
    throw new Error(`输入设备不存在：${describeSelector(device)}`);
  }

  if (resolved.maxInputChannels < channels) {
    throw new Error(
      `输入设备声道数不足：${describeSelector(device)}，需要 ${channels}，实际 ${resolved.maxInputChannels}`,
    );
  }
}

async function assertOutputDevice(
  output: AudioOutput,
  device: DeviceSelector | undefined,
): Promise<void> {
  const devices = await output.devices();

  if (device === undefined) {
    if (!devices.some(candidate => candidate.maxOutputChannels > 0)) {
      throw new Error('未找到可用的输出设备');
    }

    return;
  }

  const resolved = resolveDevice(devices, device);

  if (!resolved) {
    throw new Error(`输出设备不存在：${describeSelector(device)}`);
  }

  if (resolved.maxOutputChannels <= 0) {
    throw new Error(`设备不是输出设备：${describeSelector(device)}（${resolved.name}）`);
  }
}

function describeSelector(selector: DeviceSelector): string {
  if (typeof selector === 'number') {
    return `index=${selector}`;
  }

  if (typeof selector === 'string') {
    return `name="${selector}"`;
  }

  return `id=${selector.id}`;
}

class SelfEchoFilter {
  private window?: { text: string; startedAt: number; endedAt: number };

  recordPlayback(delivery: { text: string; startedAt: Date; endedAt: Date }): void {
    this.window = {
      text: delivery.text,
      startedAt: delivery.startedAt.getTime(),
      endedAt: delivery.endedAt.getTime(),
    };
  }

  isSelfEcho(at: Date, transcript?: string): boolean {
    if (!this.window || !transcript) {
      return false;
    }

    const time = at.getTime();
    const overlaps = time >= this.window.startedAt && time <= this.window.endedAt;

    if (!overlaps) {
      return false;
    }

    return textSimilar(this.window.text, transcript);
  }
}

function textSimilar(left: string, right: string): boolean {
  const a = normalize(left);
  const b = normalize(right);

  if (!a || !b) {
    return false;
  }

  return a === b || a.includes(b) || b.includes(a);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
