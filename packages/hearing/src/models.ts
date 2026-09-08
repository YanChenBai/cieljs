// @env node

import { stat } from 'node:fs/promises';
import path from 'node:path';

import {
  ASR_CONV_FRONTEND,
  ASR_DECODER,
  ASR_ENCODER,
  SAMPLE_RATE,
  TOKENIZER_DIR,
  TOKENIZER_FILES,
  resolveModelPaths,
  resolveModelsPath,
} from './constants.ts';
import type { ModelConfig } from './types.ts';

export interface ConfigurationCheck {
  readonly modelsPath: string;
  readonly missingFiles: readonly string[];
  readonly valid: boolean;
}

export function createModelConfig(): ModelConfig {
  const paths = resolveModelPaths();

  return {
    recognizer: {
      featConfig: {
        sampleRate: SAMPLE_RATE,
        featureDim: 80,
      },
      modelConfig: {
        qwen3Asr: {
          convFrontend: path.join(paths.asr, ASR_CONV_FRONTEND),
          encoder: path.join(paths.asr, ASR_ENCODER),
          decoder: path.join(paths.asr, ASR_DECODER),
          tokenizer: path.join(paths.asr, TOKENIZER_DIR),
          hotwords: '',
          maxTotalLen: 512,
          // 在 sherpa 的 65-token 重复保护前触发现有退化重试
          maxNewTokens: 64,
          temperature: 0.000_001,
          topP: 0.8,
          seed: 42,
        },
        tokens: '',
        numThreads: 2,
        provider: 'cpu',
      },
    },
    vad: {
      tenVad: {
        model: paths.vad,
        threshold: 0.25,
        minSpeechDuration: 0.5,
        minSilenceDuration: 0.5,
        windowSize: 256,
        maxSpeechDuration: 10,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: 'cpu',
    },
    speaker: {
      model: paths.speaker,
      numThreads: 1,
      provider: 'cpu',
    },
  };
}

export async function checkConfiguration(): Promise<ConfigurationCheck> {
  const paths = resolveModelPaths();
  const requiredFiles = [
    path.join(paths.asr, ASR_CONV_FRONTEND),
    path.join(paths.asr, ASR_ENCODER),
    path.join(paths.asr, ASR_DECODER),
    paths.vad,
    paths.speaker,
    ...TOKENIZER_FILES.map(file => path.join(paths.asr, TOKENIZER_DIR, file)),
  ];

  const fileStates = await Promise.all(requiredFiles.map(file => exists(file)));

  const missingFiles = requiredFiles.filter((_file, index) => !fileStates[index]);

  return {
    modelsPath: resolveModelsPath(),
    missingFiles,
    valid: missingFiles.length === 0,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    const info = await stat(file);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}
