// @env node

import { EventEmitter } from 'node:events';

import sherpaOnnx from 'sherpa-onnx-node';
import type {
  CircularBuffer as CircularBufferInstance,
  OfflineRecognizer as OfflineRecognizerInstance,
  OfflineRecognizerResult,
  SpeechSegment,
  Vad as VadInstance,
} from 'sherpa-onnx-node';

import {
  SAMPLE_RATE,
  VAD_WINDOW_SIZE,
  DEFAULT_BUFFER_SECONDS,
  DEFAULT_MAX_SPEAKERS,
  DEFAULT_SPEAKER_THRESHOLD,
} from './constants.ts';
import { createModelConfig } from './models.ts';
import { ProcessASR } from './process-asr.ts';
import { SpeakerTracker } from './speaker.ts';
import type { ASREventMap, ASROptions, ASRSegment, Unsubscribe } from './types.ts';

const { CircularBuffer, OfflineRecognizer, SpeakerEmbeddingExtractor, Vad } = sherpaOnnx;
const QWEN3_ASR_TEXT_MARKER = '<asr_text>';
const MAX_TRANSCRIPTION_RETRY_DEPTH = 2;
const MIN_TRANSCRIPTION_RETRY_SAMPLES = SAMPLE_RATE * 4;

export class NativeASR {
  private readonly emitter = new EventEmitter();
  private readonly buffer: CircularBufferInstance;
  private readonly bufferCapacity: number;
  private readonly maxNewTokens: number;
  private readonly recognizer: OfflineRecognizerInstance;
  private readonly speaker: SpeakerTracker;
  private readonly vad: VadInstance;
  private readonly windowSize: number;
  private streamStartAt?: Date;

  constructor(options: ASROptions = {}) {
    validateOptions(options);

    const models = createModelConfig();
    const bufferSeconds = options.bufferSeconds ?? DEFAULT_BUFFER_SECONDS;
    this.bufferCapacity = Math.ceil(bufferSeconds * SAMPLE_RATE);
    this.buffer = new CircularBuffer(this.bufferCapacity);
    this.recognizer = new OfflineRecognizer(models.recognizer);
    this.maxNewTokens = models.recognizer.modelConfig?.qwen3Asr?.maxNewTokens ?? 128;
    this.vad = new Vad(models.vad, bufferSeconds);
    this.windowSize = models.vad.tenVad?.windowSize ?? VAD_WINDOW_SIZE;
    this.speaker = new SpeakerTracker(
      new SpeakerEmbeddingExtractor(models.speaker),
      options.speaker ?? [],
      options.speakerThreshold ?? DEFAULT_SPEAKER_THRESHOLD,
      options.maxSpeakers ?? DEFAULT_MAX_SPEAKERS,
    );
  }

  write(segment: ASRSegment): void {
    try {
      if (!this.streamStartAt) this.streamStartAt = segment.startAt;
      const samples = pcm16ToFloat32(segment.data);
      this.push(samples);
      this.processWindows();
      this.drainVad();
    } catch (error) {
      this.emit('error', toError(error));
    }
  }

  flush(): void {
    try {
      const remaining = this.buffer.size();
      if (remaining > 0) {
        const samples = this.buffer.get(this.buffer.head(), remaining);
        this.buffer.pop(remaining);
        const padded = new Float32Array(this.windowSize);
        padded.set(samples);
        this.vad.acceptWaveform(padded);
      }
      this.vad.flush();
      this.drainVad();
    } catch (error) {
      this.emit('error', toError(error));
    } finally {
      this.vad.reset();
      this.buffer.reset();
      this.streamStartAt = undefined;
    }
  }

  on<K extends keyof ASREventMap>(event: K, callback: ASREventMap[K]): Unsubscribe {
    this.emitter.on(event, callback);

    return () => this.emitter.off(event, callback);
  }

  private emit<K extends keyof ASREventMap>(event: K, ...args: Parameters<ASREventMap[K]>): void {
    this.emitter.emit(event, ...args);
  }

  private push(samples: Float32Array): void {
    let offset = 0;
    while (offset < samples.length) {
      this.processWindows();
      const free = this.bufferCapacity - this.buffer.size();
      if (free === 0) throw new Error('ASR circular buffer is full');
      const length = Math.min(free, samples.length - offset);
      this.buffer.push(samples.subarray(offset, offset + length));
      offset += length;
    }
  }

  private processWindows(): void {
    while (this.buffer.size() >= this.windowSize) {
      const samples = this.buffer.get(this.buffer.head(), this.windowSize);
      this.buffer.pop(this.windowSize);
      this.vad.acceptWaveform(samples);
    }
  }

  private drainVad(): void {
    while (!this.vad.isEmpty()) {
      const segment = this.vad.front();
      this.vad.pop();
      this.transcribe(segment);
    }
  }

  private transcribe(segment: SpeechSegment): void {
    const baseAt = this.streamStartAt;
    if (!baseAt) {
      throw new Error('Cannot map ASR timestamps before audio is written');
    }

    const segmentStartAt = addSamples(baseAt, segment.start);
    const segmentEndAt = addSamples(segmentStartAt, segment.samples.length);
    this.emit('speechstart', segmentStartAt);

    const content = this.recognize(segment.samples);
    if (content) {
      this.emit('result', {
        content,
        speaker: this.speaker.assign(segment.samples, SAMPLE_RATE),
        startAt: segmentStartAt,
        endAt: segmentEndAt,
      });
    }
    this.emit('speechend', segmentEndAt);
  }

  private recognize(samples: Float32Array, depth = 0): string {
    const stream = this.recognizer.createStream();
    stream.acceptWaveform({
      samples,
      sampleRate: SAMPLE_RATE,
    });
    this.recognizer.decode(stream);
    const result = this.recognizer.getResult(stream);
    const content = parseQwen3AsrText(result.text);
    if (!isDegenerateResult(result, content, this.maxNewTokens)) return content;
    if (
      depth >= MAX_TRANSCRIPTION_RETRY_DEPTH ||
      samples.length < MIN_TRANSCRIPTION_RETRY_SAMPLES
    ) {
      return '';
    }
    const midpoint = Math.floor(samples.length / 2);
    return joinTranscriptParts([
      this.recognize(samples.subarray(0, midpoint), depth + 1),
      this.recognize(samples.subarray(midpoint), depth + 1),
    ]);
  }
}

/**
 * 在普通 Node 中直接使用原生 sherpa；Electron 的 V8 memory cage 不允许 sherpa 返回堆外 ArrayBuffer，因此自动将识别工作移入独立 Node
 * ESM 进程。
 */
export class ASR {
  private readonly backend: NativeASR | ProcessASR;

  constructor(options: ASROptions = {}) {
    this.backend = process.versions.electron ? new ProcessASR(options) : new NativeASR(options);
  }

  write(segment: ASRSegment): void {
    this.backend.write(segment);
  }

  flush(): void {
    this.backend.flush();
  }

  on<K extends keyof ASREventMap>(event: K, callback: ASREventMap[K]): Unsubscribe {
    return this.backend.on(event, callback);
  }

  close(): Promise<void> {
    return this.backend instanceof ProcessASR ? this.backend.close() : Promise.resolve();
  }
}

function pcm16ToFloat32(data: Buffer): Float32Array {
  if (data.length % Int16Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Echo data must contain aligned s16le PCM samples');
  }
  const samples = new Float32Array(data.length / Int16Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < samples.length; index += 1) {
    const value = data.readInt16LE(index * Int16Array.BYTES_PER_ELEMENT);
    samples[index] = value < 0 ? value / 32_768 : value / 32_767;
  }
  return samples;
}

function parseQwen3AsrText(text: string): string {
  const marker = text.indexOf(QWEN3_ASR_TEXT_MARKER);
  return (marker < 0 ? text : text.slice(marker + QWEN3_ASR_TEXT_MARKER.length)).trim();
}

function isDegenerateResult(
  result: OfflineRecognizerResult,
  content: string,
  maxNewTokens: number,
): boolean {
  return result.tokens.length >= maxNewTokens || hasExcessiveRepetition(content);
}

function hasExcessiveRepetition(content: string): boolean {
  const characters = Array.from(content.normalize().replaceAll(/[\s\p{P}\p{S}]+/gu, ''));
  if (characters.length < 32) return false;
  for (let unitLength = 1; unitLength <= 8; unitLength += 1) {
    const unitStart = characters.length - unitLength;
    const unit = characters.slice(unitStart).join('');
    let repeats = 1;
    for (let cursor = unitStart - unitLength; cursor >= 0; cursor -= unitLength) {
      if (characters.slice(cursor, cursor + unitLength).join('') !== unit) break;
      repeats += 1;
    }
    if (repeats >= 8 && repeats * unitLength >= characters.length / 2) return true;
  }
  return false;
}

function joinTranscriptParts(parts: readonly string[]): string {
  return parts.filter(Boolean).reduce((combined, part) => {
    if (!combined) return part;
    const separator =
      /[\p{Script=Han}\p{P}]$/u.test(combined) || /^[\p{Script=Han}\p{P}]/u.test(part) ? '' : ' ';
    return `${combined}${separator}${part}`;
  }, '');
}

function addSamples(at: Date, samples: number): Date {
  return addSeconds(at, samples / SAMPLE_RATE);
}

function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1_000);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function validateOptions(options: ASROptions): void {
  if (
    options.bufferSeconds !== undefined &&
    options.bufferSeconds < VAD_WINDOW_SIZE / SAMPLE_RATE
  ) {
    throw new Error(`bufferSeconds must hold at least one ${VAD_WINDOW_SIZE}-sample VAD window`);
  }
  if (
    options.speakerThreshold !== undefined &&
    !(options.speakerThreshold > 0 && options.speakerThreshold <= 1)
  ) {
    throw new Error('speakerThreshold must be greater than 0 and at most 1');
  }
  if (
    options.maxSpeakers !== undefined &&
    (!Number.isInteger(options.maxSpeakers) || options.maxSpeakers < 1)
  ) {
    throw new Error('maxSpeakers must be a positive integer');
  }
}
