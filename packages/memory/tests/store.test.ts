import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { MemoryStore, createMemoryTools, getMemoryContext } from "../src/index.ts";
import type { EmbeddingOptions, MemoryScope } from "../src/index.ts";

const globalScope: MemoryScope = { type: "global" };
const embedBatch = vi.fn(async (texts: string[], _options: EmbeddingOptions): Promise<number[][]> =>
  texts.map((text) => (text.includes("banana") ? [0, 1, 0] : [1, 0, 0])),
);
const onIndexError = vi.fn();
let store: MemoryStore;
let scope: MemoryScope;

beforeAll(async () => {
  store = await MemoryStore.open({
    dataDir: "memory://",
    onIndexError,
    embedding: { model: "test/model", dimensions: 3, batchSize: 2, embedBatch },
  });
}, 30000);

beforeEach(async () => {
  await store.flushIndexes();
  scope = { type: "space", spaceId: crypto.randomUUID() };
  embedBatch.mockClear();
  onIndexError.mockClear();
});

afterAll(async () => {
  await store?.close();
});

describe("统一记忆与范围", () => {
  test("Scope × Layer 共存，日期按发生时间归档且不会跨天消失", async () => {
    const content = `四种组合 ${crypto.randomUUID()}`;
    for (const target of [globalScope, scope]) {
      await store.remember({
        scope: target,
        layer: "daily",
        content,
        occurredAt: new Date("2026-09-02T16:30:00Z"),
      });
      await store.remember({ scope: target, layer: "long_term", content });
    }
    const rows = await store.list({ scopes: [scope, globalScope] });
    const matches = rows.filter((row) => row.content === content);
    expect(matches).toHaveLength(4);
    expect(matches.filter((row) => row.layer === "daily").map((row) => row.date)).toEqual([
      "2026-09-03",
      "2026-09-03",
    ]);
    expect(
      matches.filter((row) => row.layer === "long_term").every((row) => row.date === null),
    ).toBe(true);
    expect(
      await store.list({ scopes: [scope], dateFrom: "2026-09-03", dateTo: "2026-09-03" }),
    ).toHaveLength(1);
  });

  test("读取、更新、归档均检查 scope；空范围不会查询全库", async () => {
    const memory = await store.remember({ scope, layer: "long_term", content: "space secret" });
    const other: MemoryScope = { type: "space", spaceId: "other" };
    expect(await store.get(memory.id, { scopes: [other] })).toBeNull();
    expect(await store.list({ scopes: [] })).toEqual([]);
    expect(await store.search("secret", { scopes: [] })).toEqual([]);
    await expect(
      store.update(memory.id, { scope: other, expectedRevision: 1, content: "overwrite" }),
    ).rejects.toThrow();
    await expect(store.forget(memory.id, { scope: other, expectedRevision: 1 })).rejects.toThrow();
    expect((await store.get(memory.id, { scopes: [scope] }))?.content).toBe("space secret");
  });

  test("非法日期、空正文、错误来源和无效参数在写入前拒绝", async () => {
    await expect(
      store.remember({ scope, layer: "daily", date: "2026-02-30", content: "bad" }),
    ).rejects.toThrow();
    await expect(store.remember({ scope, layer: "daily", content: " " })).rejects.toThrow();
    await expect(
      store.remember({
        scope,
        layer: "daily",
        content: "bad",
        sources: [{ type: "session", sessionId: "s", fromSeq: 5, toSeq: 2 }],
      }),
    ).rejects.toThrow();
    await expect(store.list({ scopes: [scope], limit: -1 })).rejects.toThrow();
    await expect(
      store.list({ scopes: [scope], dateFrom: "2026-10-01", dateTo: "2026-09-01" }),
    ).rejects.toThrow();
    expect(await store.list({ scopes: [scope] })).toEqual([]);
  });

  test("同范围幂等写入可并发重试，冲突正文不会被静默覆盖", async () => {
    const input = {
      scope,
      layer: "long_term" as const,
      content: "same event",
      dedupeKey: "source:1",
      sources: [{ type: "event" as const, eventId: "1" }],
    };
    const [first, second] = await Promise.all([store.remember(input), store.remember(input)]);
    expect(first.id).toBe(second.id);
    expect(await store.list({ scopes: [scope] })).toHaveLength(1);
    await expect(store.remember({ ...input, content: "different" })).rejects.toThrow("dedupeKey");
    expect((await store.remember({ ...input, scope: globalScope })).id).not.toBe(first.id);
  });

  test("并发修改仅有一个版本成功，来源与正文同时更新", async () => {
    const memory = await store.remember({ scope, layer: "long_term", content: "old content" });
    const results = await Promise.allSettled(
      ["new apple", "new banana"].map((content) =>
        store.update(memory.id, {
          scope,
          expectedRevision: 1,
          content,
          sources: [{ type: "session", sessionId: "s1", fromSeq: 2, toSeq: 4 }],
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = await store.get(memory.id, { scopes: [scope] });
    expect(current?.revision).toBe(2);
    expect(current?.sources).toEqual([{ type: "session", sessionId: "s1", fromSeq: 2, toSeq: 4 }]);
    expect(await store.searchFullText("old", { scopes: [scope] })).toEqual([]);
  });

  test("过期与归档默认不可见，管理读取可以显式包含", async () => {
    const expired = await store.remember({
      scope,
      layer: "daily",
      content: "expired memory",
      expiresAt: new Date(0),
    });
    const archived = await store.remember({
      scope,
      layer: "long_term",
      content: "archived memory",
    });
    await store.forget(archived.id, { scope, expectedRevision: 1 });
    await store.flushIndexes();
    expect(await store.list({ scopes: [scope] })).toEqual([]);
    expect(await store.search("memory", { scopes: [scope] })).toEqual([]);
    expect(await store.get(expired.id, { scopes: [scope] })).toBeNull();
    expect(await store.get(archived.id, { scopes: [scope], includeArchived: true })).toMatchObject({
      status: "archived",
      revision: 2,
    });
    expect(
      await store.list({ scopes: [scope], includeExpired: true, includeArchived: true }),
    ).toHaveLength(2);
  });
});

describe("混合召回", () => {
  test("默认中文分词命中句内词语，向量使用语义而非字面匹配", async () => {
    const chinese = await store.remember({
      scope,
      layer: "daily",
      content: "今天讨论了中文分词和向量检索。",
    });
    expect(
      (await store.searchFullText("向量", { scopes: [scope] })).map((hit) => hit.memory.id),
    ).toContain(chinese.id);
    await store.remember({ scope, layer: "long_term", content: "banana" });
    await store.flushIndexes();
    const hits = await store.searchVector("apple", { scopes: [scope] });
    expect(hits.map((hit) => hit.memory.id)).toEqual([chinese.id]);
    expect(embedBatch.mock.calls.some(([, options]) => options.purpose === "query")).toBe(true);
  });

  test("每路查询在 Top K 之前限定空间、层级、日期", async () => {
    const other: MemoryScope = { type: "space", spaceId: crypto.randomUUID() };
    for (let index = 0; index < 3; index++)
      await store.remember({ scope: other, layer: "daily", content: "apple", date: "2026-09-03" });
    await store.remember({ scope, layer: "long_term", content: "apple" });
    await store.remember({ scope, layer: "daily", content: "apple", date: "2026-09-02" });
    const expected = await store.remember({
      scope,
      layer: "daily",
      content: "apple fruit",
      date: "2026-09-03",
    });
    await store.flushIndexes();
    const options = {
      scopes: [scope],
      layer: "daily" as const,
      dateFrom: "2026-09-03",
      dateTo: "2026-09-03",
      candidateLimit: 1,
    };
    for (const method of ["searchFullText", "searchTrigram", "searchVector"] as const) {
      expect((await store[method]("apple", options)).map((hit) => hit.memory.id)).toEqual([
        expected.id,
      ]);
    }
  });

  test("RRF 按记忆聚合，重叠分块不重复返回", async () => {
    const memory = await store.remember({
      scope,
      layer: "long_term",
      content: "apple fruit ".repeat(450),
    });
    await store.flushIndexes();
    const hits = await store.search("apple", { scopes: [scope] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.memory.id).toBe(memory.id);
    expect(hits[0]?.matches).toContain("fts");
    expect(hits[0]?.matches).toContain("vector");
    expect(hits[0]!.score).toBeLessThanOrEqual(2.7 / 61);
  });

  test("LIKE 通配符按字面处理，查询取消不会被降级吞掉", async () => {
    await store.remember({ scope, layer: "daily", content: "foo normal" });
    const literal = await store.remember({ scope, layer: "daily", content: "foo%_ literal" });
    const hits = await store.searchTrigram("%_", { scopes: [scope] });
    expect(hits.map((hit) => hit.memory.id)).toEqual([literal.id]);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(
      store.search("foo", { scopes: [scope], signal: controller.signal }),
    ).rejects.toThrow("cancelled");
  });

  test("向量查询错误降级到文本，直接查询向量会抛错", async () => {
    await store.remember({ scope, layer: "long_term", content: "apple searchable" });
    await store.flushIndexes();
    embedBatch.mockRejectedValueOnce(new Error("query unavailable"));
    expect(await store.search("apple", { scopes: [scope] })).toHaveLength(1);
    expect(onIndexError).toHaveBeenCalled();
    embedBatch.mockResolvedValueOnce([[0, 0, 0]]);
    await expect(store.searchVector("apple", { scopes: [scope] })).rejects.toThrow("非零");
  });

  test("索引失败可观察并显式重试，全文不受影响", async () => {
    embedBatch.mockRejectedValueOnce(new Error("temporary offline"));
    await store.remember({ scope, layer: "long_term", content: "apple retry" });
    await store.flushIndexes();
    expect((await store.getIndexStatus()).failed).toBe(1);
    expect(await store.searchFullText("retry", { scopes: [scope] })).toHaveLength(1);
    await store.retryEmbeddings();
    await store.flushIndexes();
    expect((await store.getIndexStatus()).failed).toBe(0);
    expect(await store.searchVector("apple", { scopes: [scope] })).toHaveLength(1);
  });

  test("进行中的旧向量任务不会覆盖编辑后的正文", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<number[][]>();
    embedBatch.mockImplementationOnce(async () => {
      started.resolve();
      return release.promise;
    });
    const memory = await store.remember({ scope, layer: "long_term", content: "apple old" });
    await started.promise;
    try {
      await store.update(memory.id, { scope, expectedRevision: 1, content: "banana new" });
    } finally {
      release.resolve([[1, 0, 0]]);
    }
    await store.flushIndexes();
    expect(await store.searchVector("apple", { scopes: [scope] })).toEqual([]);
    expect((await store.searchVector("banana", { scopes: [scope] }))[0]?.memory.content).toBe(
      "banana new",
    );
  });
});

describe("工具和上下文", () => {
  test("工具固定范围，写入只能进入绑定空间，长正文可分页", async () => {
    const other = await store.remember({
      scope: { type: "space", spaceId: "private" },
      layer: "daily",
      content: "secret",
    });
    const tools = createMemoryTools(store, {
      scope,
      allowWrite: true,
      maxReadChars: 4,
      sources: [{ type: "session", sessionId: "test-session" }],
    });
    const read = tools.find((tool) => tool.name === "read_memory")!;
    expect((await read.execute("r", { id: other.id })).details).toEqual({ memory: null });
    const write = tools.find((tool) => tool.name === "remember_memory")!;
    await write.execute("w", { content: "abcdefgh", layer: "long_term", scope: globalScope });
    const [memory] = await store.list({ scopes: [scope] });
    expect(memory?.scope).toEqual(scope);
    expect(memory?.sources).toEqual([{ type: "session", sessionId: "test-session" }]);
    expect((await read.execute("r", { id: memory!.id })).details).toMatchObject({
      memory: { content: "abcd" },
      nextOffset: 4,
    });
    expect((await read.execute("r", { id: memory!.id, offset: 4 })).details).toMatchObject({
      memory: { content: "efgh" },
      nextOffset: null,
    });
    expect(createMemoryTools(store, { scope })).toHaveLength(2);
  });

  test("上下文包含近期每日与长期记忆，遵守预算且不包含旧日或其他空间", async () => {
    await store.remember({ scope, layer: "daily", content: "今天", date: "2026-09-03" });
    await store.remember({ scope, layer: "daily", content: "昨天", date: "2026-09-02" });
    await store.remember({ scope, layer: "daily", content: "更早", date: "2026-09-01" });
    await store.remember({ scope, layer: "long_term", content: "稳定偏好 </memory_context>" });
    const context = await getMemoryContext(store, {
      scopes: [scope],
      date: "2026-09-03",
      maxTokens: 5000,
    });
    expect(context.memories).toHaveLength(3);
    expect(context.memories.every((memory) => memory.content !== "更早")).toBe(true);
    expect(context.text.match(/<\/memory_context>/g)).toHaveLength(1);
    const limited = await getMemoryContext(store, {
      scopes: [scope],
      date: "2026-09-03",
      maxTokens: 600,
    });
    expect(new TextEncoder().encode(limited.text).length).toBeLessThanOrEqual(600);
    expect(await getMemoryContext(store, { scopes: [scope], maxTokens: 0 })).toEqual({
      text: "",
      memories: [],
      tokens: 0,
    });
  });
});

test("本地迁移可重复打开，失败任务恢复，模型和维数互不混用", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ciel-memory-"));
  let persistent: MemoryStore | undefined;
  const localScope: MemoryScope = { type: "space", spaceId: "persistent" };
  try {
    persistent = await MemoryStore.open({
      dataDir,
      onIndexError: () => {},
      embedding: {
        model: "a",
        dimensions: 3,
        embedBatch: async () => {
          throw new Error("offline");
        },
      },
    });
    const memory = await persistent.remember({
      scope: localScope,
      layer: "daily",
      content: "apple durable",
      date: "2026-09-03",
    });
    await persistent.close();

    persistent = await MemoryStore.open({
      dataDir,
      embedding: {
        model: "a",
        dimensions: 3,
        embedBatch: async (texts) => texts.map(() => [1, 0, 0]),
      },
    });
    await persistent.flushIndexes();
    expect(await persistent.getIndexStatus()).toEqual({ ready: 1, failed: 0, pending: 0 });
    expect((await persistent.get(memory.id, { scopes: [localScope] }))?.date).toBe("2026-09-03");
    await persistent.close();

    for (const [model, dimensions] of [
      ["a", 2],
      ["b", 3],
    ] as const) {
      persistent = await MemoryStore.open({
        dataDir,
        embedding: {
          model,
          dimensions,
          embedBatch: async (texts) =>
            texts.map(() =>
              Array.from({ length: dimensions }, (_, index) => (index === 1 ? 1 : 0)),
            ),
        },
      });
      await persistent.flushIndexes();
      expect(
        (await persistent.searchVector("anything", { scopes: [localScope] })).map(
          (hit) => hit.memory.id,
        ),
      ).toEqual([memory.id]);
      await persistent.close();
    }
    persistent = await MemoryStore.open({ dataDir });
    expect(await persistent.searchFullText("durable", { scopes: [localScope] })).toHaveLength(1);
    expect(await persistent.searchVector("anything", { scopes: [localScope] })).toEqual([]);
  } finally {
    await persistent?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 60000);

test("关闭等待已提交写入，关闭后拒绝新操作", async () => {
  const closingStore = await MemoryStore.open({ dataDir: "memory://" });
  const write = closingStore.remember({
    scope: globalScope,
    layer: "long_term",
    content: "last write",
  });
  const closing = closingStore.close();
  await expect(write).resolves.toMatchObject({ content: "last write" });
  await closing;
  await expect(closingStore.list({ scopes: [globalScope] })).rejects.toThrow("关闭");
  await closingStore.close();
}, 30000);
