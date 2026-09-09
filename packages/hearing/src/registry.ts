import path from 'node:path';

import {
  resolveAsrPath,
  resolveModelsPath,
  resolveSpeakerPath,
  resolveVadPath,
} from './constants.ts';
import { installFile, type InstallModelsOptions } from './download.ts';
import { Qwen3Recognizer } from './models/qwen3.ts';
import { SenseVoiceRecognizer } from './models/sensevoice.ts';

const release = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

export const ASR_MODELS = {
  'qwen3-asr-1.7b-int8': {
    events: false,
    async prepare(options: InstallModelsOptions = {}) {
      for (const file of ASR_MODELS['qwen3-asr-1.7b-int8'].files())
        await installFile(file.url, file.target, options);
    },
    files: () =>
      [
        'model_1.7B/conv_frontend.onnx',
        'model_1.7B/encoder.int8.onnx',
        'model_1.7B/decoder.int8.onnx',
        'tokenizer/merges.txt',
        'tokenizer/tokenizer_config.json',
        'tokenizer/vocab.json',
      ].map(file => ({
        url: `https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/master/${file}`,
        target: path.join(
          resolveAsrPath(),
          file.startsWith('tokenizer/') ? file : path.basename(file),
        ),
      })),
    create: () => new Qwen3Recognizer(),
  },
  'sensevoice-small': {
    events: true,
    async prepare(options: InstallModelsOptions = {}) {
      for (const file of ASR_MODELS['sensevoice-small'].files())
        await installFile(file.url, file.target, options);
    },
    files: () =>
      ['model.int8.onnx', 'tokens.txt'].map(file => ({
        url: `https://modelscope.cn/models/pengzhendong/sherpa-onnx-sense-voice-zh-en-ja-ko-yue/resolve/master/${file}`,
        target: path.join(resolveModelsPath(), 'asr/sensevoice-small', file),
      })),
    create: () => new SenseVoiceRecognizer(),
  },
} as const;

export type ASRModelId = keyof typeof ASR_MODELS;
export const DEFAULT_ASR_MODEL: ASRModelId = 'qwen3-asr-1.7b-int8';

export function modelFiles(
  options: {
    model?: ASRModelId;
    speaker?: false | readonly unknown[];
    mode?: 'transcription' | 'events';
  } = {},
) {
  const model = ASR_MODELS[options.model ?? DEFAULT_ASR_MODEL];
  if (!model) throw new Error(`Unsupported ASR model: ${options.model}`);
  const files = model.files();
  if (options.mode !== 'events')
    files.push({ url: `${release}/asr-models/ten-vad.int8.onnx`, target: resolveVadPath() });
  if (options.speaker !== false)
    files.push({
      url: `${release}/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`,
      target: resolveSpeakerPath(),
    });
  return files;
}
