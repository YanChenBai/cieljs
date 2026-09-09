import { describe, expect, it } from 'vite-plus/test';

import { createAudioConfig } from '../src/models.ts';
import { createQwen3Config } from '../src/models/qwen3.ts';

describe('createAudioConfig', () => {
  it('使用 Qwen3-ASR-1.7B INT8 与 TEN-VAD', () => {
    const config = createAudioConfig();

    expect(createQwen3Config().modelConfig?.qwen3Asr).toMatchObject({
      hotwords: '',
      maxNewTokens: 64,
      maxTotalLen: 512,
    });
    expect(createQwen3Config().modelConfig?.qwen3Asr?.convFrontend).toMatch(/conv_frontend\.onnx$/);
    expect(createQwen3Config().modelConfig?.qwen3Asr?.encoder).toMatch(/encoder\.int8\.onnx$/);
    expect(createQwen3Config().modelConfig?.qwen3Asr?.decoder).toMatch(/decoder\.int8\.onnx$/);
    expect(createQwen3Config().modelConfig?.qwen3Asr?.tokenizer).toMatch(/tokenizer$/);
    expect(config.vad.sileroVad).toBeUndefined();
    expect(config.vad.tenVad).toMatchObject({
      threshold: 0.25,
      minSilenceDuration: 0.5,
      minSpeechDuration: 0.5,
      windowSize: 256,
      maxSpeechDuration: 10,
    });
    expect(config.vad.tenVad?.model).toMatch(/ten-vad\.int8\.onnx$/);
  });

  it('在创建配置时读取最新的 CIEL_DATA_DIR', () => {
    const previous = process.env.CIEL_DATA_DIR;
    try {
      process.env.CIEL_DATA_DIR = 'C:\\ciel-first';
      const first = createAudioConfig();
      process.env.CIEL_DATA_DIR = 'C:\\ciel-second';
      const second = createAudioConfig();

      expect(first.vad.tenVad?.model).toContain('ciel-first');
      expect(second.vad.tenVad?.model).toContain('ciel-second');
    } finally {
      if (previous === undefined) delete process.env.CIEL_DATA_DIR;
      else process.env.CIEL_DATA_DIR = previous;
    }
  });
});
