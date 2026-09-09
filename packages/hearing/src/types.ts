import type { WakeEvent } from './kws.ts';
import type { ASRModelId } from './registry.ts';
import type { WakeOptions } from './wake-gate.ts';

export type Unsubscribe = () => void;

export interface SpeakerProfile {
  name: string;
  file: string;
}

export interface ASROptions {
  wake?: WakeOptions;
  model?: ASRModelId;
  mode?: 'transcription' | 'events';
  eventWindowSeconds?: number;
  speaker?: false | readonly SpeakerProfile[];
  bufferSeconds?: number;
  speakerThreshold?: number;
  maxSpeakers?: number;
}

export interface ASREventMap {
  wake(event: WakeEvent): void;
  result(data: ASRResult): void;
  speechstart(at: Date): void;
  speechend(at: Date): void;
  error(error: Error): void;
}

export interface ASRSegment {
  data: Buffer;
  startAt: Date;
  /** 默认 16 kHz、单声道 s16le。 */
  sampleRate?: number;
  channels?: number;
  format?: 's16le';
}

export interface ASRToken {
  content: string;
  startAt: Date;
  endAt: Date;
}

export interface ASRResult {
  content: string;
  language?: string;
  emotion?: string;
  events?: readonly AudioEvent[];
  speaker?: string;
  confidence?: number;
  startAt: Date;
  endAt: Date;
  tokens?: readonly ASRToken[];
}

export interface AudioEvent {
  type: string;
}

export interface ASRStream extends AsyncDisposable {
  write(chunk: ASRSegment): void | Promise<void>;
  flush(): void | Promise<void>;
  on<K extends keyof ASREventMap>(event: K, listener: ASREventMap[K]): Unsubscribe;
  close(): Promise<void>;
}
