// packages/embedding/tests/qwen.test.ts

import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_QWEN_EMBEDDING_BATCH_SIZE,
  QWEN_EMBEDDING_DIMENSIONS,
  QWEN_EMBEDDING_MODEL,
  qwen,
} from "../src/index.ts";

describe("qwen", () => {
  test("应该创建默认 Qwen Embedding", () => {
    const embedding = qwen();

    expect(embedding.model).toBe(QWEN_EMBEDDING_MODEL);
    expect(embedding.dimensions).toBe(QWEN_EMBEDDING_DIMENSIONS);
    expect(embedding.batchSize).toBe(DEFAULT_QWEN_EMBEDDING_BATCH_SIZE);
  });

  test("应该支持 MRL 输出维度", () => {
    const embedding = qwen({
      dimensions: 512,
    });

    expect(embedding.dimensions).toBe(512);
  });

  test("应该支持自定义 batchSize", () => {
    const embedding = qwen({
      batchSize: 64,
    });

    expect(embedding.batchSize).toBe(64);
  });

  test("应该拒绝零维向量", () => {
    expect(() =>
      qwen({
        dimensions: 0,
      }),
    ).toThrow("dimensions 必须是 1 到 1024 的整数");
  });

  test("应该拒绝超过原始向量维度", () => {
    expect(() =>
      qwen({
        dimensions: 1025,
      }),
    ).toThrow("dimensions 必须是 1 到 1024 的整数");
  });

  test("应该拒绝非整数维度", () => {
    expect(() =>
      qwen({
        dimensions: 512.5,
      }),
    ).toThrow("dimensions 必须是 1 到 1024 的整数");
  });

  test("应该复用 agent-kit 的 batchSize 校验", () => {
    expect(() =>
      qwen({
        batchSize: 0,
      }),
    ).toThrow("batchSize 必须是 1 到 1000 的整数");

    expect(() =>
      qwen({
        batchSize: 1001,
      }),
    ).toThrow("batchSize 必须是 1 到 1000 的整数");
  });
});
