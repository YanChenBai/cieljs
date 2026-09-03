import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { eq } from "drizzle-orm";

import { SessionStore, createSessionSummarizer, sessionTools } from "../src/index.ts";
import { retrievalChunks, retrievalEmbeddings } from "../src/schema.ts";
import type { EmbeddingOptions, SummarizeInput } from "../src/types.ts";
import type { GenerateSummaryInput } from "../src/compaction.ts";

const user = (content: string): AgentMessage => ({ role: "user", content, timestamp: 1 });
const assistant = (text: string): AgentMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "openai-completions",
  model: "test",
  provider: "test",
  stopReason: "stop",
  timestamp: 2,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
});

let store: SessionStore;
let sessionId: string;
const onIndexError = vi.fn();
const embedBatch = vi.fn(async (texts: string[], _options?: EmbeddingOptions) =>
  texts.map(() => [1, 0, 0]),
);

beforeAll(async () => {
  store = await SessionStore.open({
    dataDir: "memory://",
    embedding: { model: "test/vector-v1", dimensions: 3, embedBatch, batchSize: 2 },
    onIndexError,
  });
}, 30_000);

beforeEach(async () => {
  await store.flushIndexes();
  vi.clearAllMocks();
  sessionId = (await store.createSession()).id;
});

afterAll(async () => {
  await store?.close();
});

async function appendTurns(count: number) {
  for (let index = 0; index < count; index++) {
    await store.appendMessage(sessionId, user(`question ${index}`));
    await store.appendMessage(sessionId, assistant(`answer ${index}`));
  }
}

describe("递归累计压缩", () => {
  test("压缩后不复用保留消息中的旧 usage，避免立即再次压缩", async () => {
    await appendTurns(3);
    const message = assistant("last answer");
    if (message.role === "assistant") message.usage.totalTokens = 50000;
    await store.appendMessage(sessionId, message);
    const summarize = vi.fn(async () => "S1");
    const options = { contextWindow: 20000, keepRecentMessages: 2, summarize };
    expect(await store.compactSession(sessionId, options)).not.toBeNull();
    expect(await store.compactSession(sessionId, options)).toBeNull();
    expect(summarize).toHaveBeenCalledTimes(1);
  });
  test("下一次只压缩上次摘要和新增旧消息，原始历史仍可检索", async () => {
    await appendTurns(3);
    const summarize = vi.fn(async ({ summary }: SummarizeInput) => (summary ? "S2" : "S1"));
    const options = { contextWindow: 14, reserveTokens: 0, summarize, keepRecentMessages: 2 };

    expect(await store.compactSession(sessionId, options)).toMatchObject({
      throughSeq: 4,
      summary: "S1",
    });
    expect(summarize.mock.calls[0]![0]).toMatchObject({
      summary: null,
      messages: expect.any(Array),
    });
    expect(summarize.mock.calls[0]![0].messages).toHaveLength(4);

    await appendTurns(2);
    expect(await store.compactSession(sessionId, options)).toMatchObject({
      throughSeq: 8,
      summary: "S2",
    });
    expect(summarize.mock.calls[1]![0].summary).toBe("S1");
    expect(summarize.mock.calls[1]![0].messages).toHaveLength(4);
    expect(await store.getContext(sessionId)).toMatchObject({
      summary: "S2",
      messages: [user("question 1"), assistant("answer 1")],
    });
    expect(await store.getMessages(sessionId)).toHaveLength(10);
    expect(await store.searchFullText("question", { sessionId })).not.toHaveLength(0);
  });

  test("保留完整工具调用轮次，不拆开调用与结果", async () => {
    await appendTurns(1);
    await store.appendMessage(sessionId, user("调用工具"));
    const call = assistant("");
    if (call.role === "assistant")
      call.content = [{ type: "toolCall", id: "call-1", name: "lookup", arguments: {} }];
    await store.appendMessage(sessionId, call);
    await store.appendMessage(sessionId, {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "lookup",
      content: [{ type: "text", text: "结果" }],
      isError: false,
      timestamp: 3,
    });
    await store.appendMessage(sessionId, assistant("完成"));

    await store.compactSession(sessionId, {
      contextWindow: 32000,
      summarize: async () => "摘要",
      keepRecentMessages: 2,
      force: true,
    });
    expect((await store.getContext(sessionId)).messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });

  test("阈值以下不调用模型，强制压缩仍保留最近消息", async () => {
    await appendTurns(2);
    const summarize = vi.fn(async () => "摘要");
    expect(
      await store.compactSession(sessionId, {
        contextWindow: 32000,
        summarize,
        keepRecentMessages: 2,
      }),
    ).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
    await store.compactSession(sessionId, {
      contextWindow: 32000,
      summarize,
      keepRecentMessages: 2,
      force: true,
    });
    expect((await store.getContext(sessionId)).messages).toHaveLength(2);
  });

  test("失败、空摘要和取消均不推进边界，之后可重试", async () => {
    await appendTurns(2);
    const options = { contextWindow: 32000, keepRecentMessages: 2, force: true };
    await expect(
      store.compactSession(sessionId, {
        ...options,
        summarize: async () => {
          throw new Error("模型故障");
        },
      }),
    ).rejects.toThrow("模型故障");
    await expect(
      store.compactSession(sessionId, {
        ...options,
        summarize: async () => " ",
      }),
    ).rejects.toThrow("不能为空");
    const controller = new AbortController();
    await expect(
      store.compactSession(sessionId, {
        ...options,
        signal: controller.signal,
        summarize: async () => {
          controller.abort();
          return "摘要";
        },
      }),
    ).rejects.toThrow();
    expect(await store.getLatestCompaction(sessionId)).toBeNull();
    expect(
      await store.compactSession(sessionId, {
        ...options,
        summarize: async () => "恢复",
      }),
    ).toMatchObject({ summary: "恢复" });
  });

  test("同会话并发请求串行处理，不重复调用摘要模型", async () => {
    await appendTurns(2);
    const summarize = vi.fn(async () => "摘要");
    const options = { contextWindow: 32000, summarize, keepRecentMessages: 2, force: true };
    const results = await Promise.all([
      store.compactSession(sessionId, options),
      store.compactSession(sessionId, options),
    ]);
    expect(results[1]).toBeNull();
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  test("压缩期间追加消息不会被旧摘要吞掉", async () => {
    await appendTurns(2);
    await store.compactSession(sessionId, {
      contextWindow: 32000,
      keepRecentMessages: 2,
      force: true,
      summarize: async () => {
        await store.appendMessage(sessionId, user("新增消息"));
        return "摘要";
      },
    });
    expect((await store.getContext(sessionId)).messages.at(-1)).toEqual(user("新增消息"));
  });

  test("拒绝覆盖压缩期间被外部更新的摘要", async () => {
    await appendTurns(3);
    await expect(
      store.compactSession(sessionId, {
        contextWindow: 32000,
        keepRecentMessages: 2,
        force: true,
        summarize: async () => {
          await store.appendCompaction(sessionId, { throughSeq: 2, summary: "外部摘要" });
          return "过期摘要";
        },
      }),
    ).rejects.toThrow("摘要已更新");
    expect((await store.getLatestCompaction(sessionId))?.summary).toBe("外部摘要");
  });

  test("校验保留数和触发阈值", async () => {
    const summarize = vi.fn(async () => "摘要");
    await expect(
      store.compactSession(sessionId, { contextWindow: 32000, summarize, keepRecentMessages: 0 }),
    ).rejects.toThrow("正整数");
    await expect(
      store.compactSession(sessionId, {
        contextWindow: 100,
        reserveTokens: 100,
        summarize,
        keepRecentMessages: 4,
      }),
    ).rejects.toThrow("小于");
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe("通用向量接口", () => {
  test("三路检索保持会话隔离，并按 RRF 合并同一个文本块", async () => {
    const message = await store.appendMessage(sessionId, user("retrieval"));
    const otherSession = await store.createSession();
    await store.appendMessage(otherSession.id, user("retrieval"));
    await store.flushIndexes();

    expect(await store.searchFullText("retrieval", { sessionId })).toHaveLength(1);
    expect(await store.searchTrigram("retrieval", { sessionId })).toHaveLength(1);
    expect(await store.searchVector("retrieval", { sessionId })).toHaveLength(1);

    const hits = await store.search("retrieval", { sessionId });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      sessionId,
      messageId: message.id,
      sources: ["fts", "trigram", "vector"],
    });
    expect(hits[0]!.score).toBeCloseTo(2.7 / 61);
    expect(await store.search("retrieval", { limit: 1 })).toHaveLength(1);
  });

  test("重建全文与向量索引后仍可通过统一入口检索原始消息", async () => {
    const message = await store.appendMessage(sessionId, user("rebuildable"));
    await store.flushIndexes();
    const [before] = await store.searchFullText("rebuildable", { sessionId });

    await store.rebuildIndex(sessionId);

    const [after] = await store.search("rebuildable", { sessionId });
    expect(after).toMatchObject({
      messageId: message.id,
      sources: ["fts", "trigram", "vector"],
    });
    expect(after!.chunkId).not.toBe(before!.chunkId);
    expect(await store.getMessages(sessionId)).toHaveLength(1);
  });

  test("显式重建失败会传给调用方，但不会阻断后续索引队列", async () => {
    await store.appendMessage(sessionId, user("before"));
    await store.flushIndexes();
    embedBatch.mockRejectedValueOnce(new Error("重建故障"));

    await expect(store.rebuildEmbeddings(sessionId)).rejects.toThrow("重建故障");
    expect(onIndexError).not.toHaveBeenCalled();

    await store.appendMessage(sessionId, user("after"));
    await store.flushIndexes();
    expect(await store.searchVector("after", { sessionId })).toHaveLength(2);
  });

  test("批量接口的查询必须返回一个有效向量", async () => {
    embedBatch.mockResolvedValueOnce([]);
    await expect(store.searchVector("query")).rejects.toThrow("数量必须为 1");
    embedBatch.mockResolvedValueOnce([
      [1, 0, 0],
      [1, 0, 0],
    ]);
    await expect(store.searchVector("query")).rejects.toThrow("数量必须为 1");
    embedBatch.mockResolvedValueOnce([[NaN, 0, 0]]);
    await expect(store.searchVector("query")).rejects.toThrow("有限数值");
  });
  test("按批次索引文档，查询使用独立用途且保留原始文本", async () => {
    await store.appendMessage(sessionId, user("long ".repeat(2000)));
    await store.flushIndexes();
    expect(embedBatch).toHaveBeenCalledTimes(2);
    expect(embedBatch.mock.calls[0]![0]).toHaveLength(2);
    expect(embedBatch.mock.calls[0]![1]).toEqual({ purpose: "document" });
    const hits = await store.searchVector("a\n query", { sessionId });
    expect(hits.length).toBeGreaterThan(0);
    expect(embedBatch).toHaveBeenCalledWith(["a\n query"], { purpose: "query", signal: undefined });
  });

  test("同模型不同维数和不同模型的数据不会相互参与距离计算", async () => {
    await store.appendMessage(sessionId, user("mixed vectors"));
    await store.flushIndexes();
    const [chunk] = await store.db
      .select()
      .from(retrievalChunks)
      .where(eq(retrievalChunks.sessionId, sessionId));
    await store.db.insert(retrievalEmbeddings).values([
      { chunkId: chunk!.id, model: "test/vector-v1", dimensions: 2, embedding: [1, 0] },
      { chunkId: chunk!.id, model: "another-model", dimensions: 4, embedding: [1, 0, 0, 0] },
    ]);
    expect(await store.searchVector("mixed", { sessionId })).toHaveLength(1);
    expect(
      (
        await store.db
          .select()
          .from(retrievalEmbeddings)
          .where(eq(retrievalEmbeddings.chunkId, chunk!.id))
      )
        .map((row) => row.embedding.length)
        .sort((a, b) => a - b),
    ).toEqual([2, 3, 4]);
  });

  test("向量服务失败时全文检索仍可用，重建后可恢复", async () => {
    embedBatch.mockRejectedValueOnce(new Error("索引服务故障"));
    await store.appendMessage(sessionId, user("recoverable keyword"));
    await store.flushIndexes();
    expect(onIndexError).toHaveBeenCalledTimes(1);
    embedBatch.mockRejectedValueOnce(new Error("查询服务故障"));
    expect(await store.search("recoverable", { sessionId })).not.toHaveLength(0);
    await store.rebuildEmbeddings(sessionId);
    expect(await store.searchVector("recoverable", { sessionId })).toHaveLength(1);
  });

  test("拒绝批次数量不符、错误维数和无效向量", async () => {
    for (const vectors of [[], [[1, 0]], [[NaN, 0, 0]], [[0, 0, 0]]]) {
      embedBatch.mockResolvedValueOnce(vectors);
      await store.appendMessage(sessionId, user("invalid embedding"));
      await store.flushIndexes();
    }
    expect(onIndexError).toHaveBeenCalledTimes(4);
    expect(await store.getMessages(sessionId)).toHaveLength(4);
  });

  test("取消查询时不降级为正常结果", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(store.search("query", { signal: controller.signal })).rejects.toThrow();
  });
});

test("摘要适配器传递累计摘要并排除历史推理", async () => {
  const generateText = vi.fn(async (_input: GenerateSummaryInput) => "新摘要");
  const summarize = createSessionSummarizer({ generateText, instructions: "保留订单编号" });
  const message = assistant("可见内容");
  if (message.role === "assistant")
    message.content.push({ type: "thinking", thinking: "私有推理" });
  expect(await summarize({ sessionId, summary: "旧摘要", messages: [message] })).toBe("新摘要");
  expect(generateText.mock.calls[0]).toBeDefined();
  const [input] = generateText.mock.calls[0]!;
  expect(input.prompt).toContain("旧摘要");
  expect(input.prompt).not.toContain("私有推理");
  expect(input.systemPrompt).toContain("保留订单编号");
});

test("当前上下文工具需显式启用，默认仅提供历史搜索和读取", () => {
  expect(sessionTools({ store, sessionId }).map((tool) => tool.name)).toEqual([
    "search_session",
    "read_session",
  ]);
  expect(sessionTools({ store, sessionId, includeContextTool: true })).toHaveLength(3);
});
