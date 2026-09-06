import { describe, expect, it } from "vite-plus/test";

import { createModelConfig } from "../src/models.ts";

describe("createModelConfig", () => {
  it("使用 Qwen3-ASR-1.7B INT8 与 TEN-VAD", () => {
    const config = createModelConfig();

    expect(config.recognizer.modelConfig?.qwen3Asr).toMatchObject({
      hotwords: "",
      maxNewTokens: 64,
      maxTotalLen: 512,
    });
    expect(config.recognizer.modelConfig?.qwen3Asr?.convFrontend).toMatch(/conv_frontend\.onnx$/);
    expect(config.recognizer.modelConfig?.qwen3Asr?.encoder).toMatch(/encoder\.int8\.onnx$/);
    expect(config.recognizer.modelConfig?.qwen3Asr?.decoder).toMatch(/decoder\.int8\.onnx$/);
    expect(config.recognizer.modelConfig?.qwen3Asr?.tokenizer).toMatch(/tokenizer$/);
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

  it("在创建配置时读取最新的 CIEL_DATA_DIR", () => {
    const previous = process.env.CIEL_DATA_DIR;
    try {
      process.env.CIEL_DATA_DIR = "C:\\ciel-first";
      const first = createModelConfig();
      process.env.CIEL_DATA_DIR = "C:\\ciel-second";
      const second = createModelConfig();

      expect(first.vad.tenVad?.model).toContain("ciel-first");
      expect(second.vad.tenVad?.model).toContain("ciel-second");
    } finally {
      if (previous === undefined) delete process.env.CIEL_DATA_DIR;
      else process.env.CIEL_DATA_DIR = previous;
    }
  });
});
