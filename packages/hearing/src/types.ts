import type {
  OfflineRecognizerConfig,
  SpeakerEmbeddingExtractorConfig,
  VadConfig,
} from 'sherpa-onnx-node';

export type Unsubscribe = () => void;

export interface SpeakerProfile {
  name: string;
  file: string;
}

export interface ASROptions {
  speaker?: readonly SpeakerProfile[];
  bufferSeconds?: number;
  speakerThreshold?: number;
  maxSpeakers?: number;
}

export interface ASREventMap {
  result(data: ASRResult): void;
  speechstart(at: Date): void;
  speechend(at: Date): void;
  error(error: Error): void;
}

export interface ASRSegment {
  data: Buffer;
  startAt: Date;
}

export interface ASRToken {
  content: string;
  startAt: Date;
  endAt: Date;
}

export interface ASRResult {
  content: string;
  speaker?: string;
  confidence?: number;
  startAt: Date;
  endAt: Date;
  tokens?: readonly ASRToken[];
}

export interface ModelConfig {
  recognizer: OfflineRecognizerConfig;
  vad: VadConfig;
  speaker: SpeakerEmbeddingExtractorConfig;
}
