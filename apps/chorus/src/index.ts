import { models } from '@cieljs/model-kit/models';
import type { Api, Model } from '@earendil-works/pi-ai';

export { defaultChorusConfig, defineChorusConfig } from './config.ts';
export type {
  ChorusAudioInputConfig,
  ChorusAudioOutputConfig,
  ChorusConfig,
  ChorusConversationConfig,
  ChorusPerceptionConfig,
  ChorusTtsConfig,
} from './config.ts';

export { CHORUS_SYSTEM_PROMPT } from './system-prompt.ts';

export { createChorus } from './runtime.ts';
export type { Chorus, ChorusOptions, ChorusStatus } from './runtime.ts';

export { ConversationScheduler } from './conversation/scheduler.ts';
export type { ChorusEvent, PendingWindow, SchedulerState } from './conversation/scheduler.ts';
export { createSpeakTool, SpeakController } from './conversation/speak-tool.ts';
export type { SpeakResult, SpeakToolOptions, ThinkRunGate } from './conversation/speak-tool.ts';

export { createAudioInput } from './audio/input.ts';
export { createAudioOutput } from './audio/output.ts';
export { AudioNormalizer } from './audio/normalizer.ts';
export { resampleS16le } from './audio/resample.ts';
export { decodeWavToPcm16, parseWav } from './audio/wav.ts';
export type { ParsedWav, DecodedPcm } from './audio/wav.ts';
export { resolveDevice } from './audio/types.ts';
export type {
  AudioDevice,
  AudioInput,
  AudioInputChunk,
  AudioInputDevice,
  AudioOutput,
  AudioOutputDevice,
  DeviceSelector,
} from './audio/types.ts';

export { createXiaomiTextToSpeech } from './tts/xiaomi.ts';
export type { XiaomiTextToSpeechOptions } from './tts/xiaomi.ts';
export type {
  SpeechAudio,
  SpeechAudioFormat,
  SpeechSynthesisRequest,
  TextToSpeech,
} from './tts/types.ts';

export function resolveChorusModel(): Model<Api> {
  const model = models.getModel('xiaomi', 'mimo-v2.5');

  if (!model) {
    throw new Error('未找到 Xiaomi mimo-v2.5 模型');
  }

  return model;
}
