import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_RATE = 16_000;
export const VAD_WINDOW_SIZE = 256;
export const DEFAULT_BUFFER_SECONDS = 30;
export const DEFAULT_SPEAKER_THRESHOLD = 0.6;
export const DEFAULT_MAX_SPEAKERS = 8;

export const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

export const MODELS_DIR = 'models' as const;
export const VOICEPRINTS_DIR = 'voiceprints' as const;

export const ASR_DIR = 'asr' as const;
export const VAD_DIR = 'vad' as const;
export const SPEAKER_DIR = 'speaker' as const;
export const TOKENIZER_DIR = 'tokenizer' as const;

export const ASR_MODEL_SUBDIR = 'qwen3-asr-1.7b-int8' as const;
export const ASR_CONV_FRONTEND = 'conv_frontend.onnx' as const;
export const ASR_ENCODER = 'encoder.int8.onnx' as const;
export const ASR_DECODER = 'decoder.int8.onnx' as const;
export const VAD_MODEL = 'ten-vad.int8.onnx' as const;
export const SPEAKER_MODEL = 'model.onnx' as const;

export const TOKENIZER_FILES = ['merges.txt', 'tokenizer_config.json', 'vocab.json'] as const;

export function resolveDataPath(): string {
  return process.env.CIEL_DATA_DIR?.trim() || path.join(homedir(), '.ciel');
}

export function resolveModelsPath(): string {
  return path.join(resolveDataPath(), MODELS_DIR);
}

export function resolveVoiceprintsPath(): string {
  return path.join(resolveDataPath(), VOICEPRINTS_DIR);
}

export function resolveAsrPath(): string {
  return path.join(resolveModelsPath(), ASR_DIR, ASR_MODEL_SUBDIR);
}

export function resolveVadPath(): string {
  return path.join(resolveModelsPath(), VAD_DIR, VAD_MODEL);
}

export function resolveSpeakerPath(): string {
  return path.join(resolveModelsPath(), SPEAKER_DIR, SPEAKER_MODEL);
}

export function resolveModelPaths() {
  return {
    asr: resolveAsrPath(),
    vad: resolveVadPath(),
    speaker: resolveSpeakerPath(),
  } as const;
}
