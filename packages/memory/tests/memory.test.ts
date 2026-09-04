import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { crossScopeMemoryTools, MemoryManager, memoryTools } from "../src/index.ts";
import type { EmbeddingOptions, Memory, MemoryScope } from "../src/index.ts";

const globalScope: MemoryScope = { type: "global" };
const embedBatch = vi.fn(async (texts: string[], _options: EmbeddingOptions): Promise<number[][]> =>
  texts.map((text) => (text.includes("banana") ? [0, 1, 0] : [1, 0, 0])),
);
const onIndexError = vi.fn();
let manager: MemoryManager;
let store: Memory;
let scope: MemoryScope;

beforeAll(async () => {
  manager = await MemoryManager.open({
    dataDir: "memory://",
    onIndexError,
    embedding: { model: "test/model", dimensions: 3, batchSize: 2, embedBatch },
  });
}, 30000);

beforeEach(async () => {
  await manager.flushIndexes();
  scope = { type: "space", spaceId: crypto.randomUUID() };
  store = manager.memory(scope, { includeGlobal: false });
  embedBatch.mockClear();
  onIndexError.mockClear();
});

afterAll(async () => {
  await manager?.close();
});

describe("统一记忆与范围", () => {
  test("scope 在创建时固定，不受外部对象后续修改影响", async () => {
    const input = { type: "space" as const, spaceId: crypto.randomUUID() };
    const memory = manager.memory(input, { includeGlobal: false });
    const expectedScope = structuredClone(input);

    input.spaceId = crypto.randomUUID();
    const saved = await memory.remember({ layer: "long_term", content: "fixed scope" });

    expect(memory.scope).toEqual(expectedScope);
    expect(saved.scope).toEqual(expectedScope);
    expect(Object.isFrozen(memory.scope)).toBe(true);
  });

  test("Scope × Layer 共存，日期按发生时间归档且不会跨天消失", async () => {
    const content = `四种组合 ${crypto.randomUUID()}`;
    for (const target of [globalScope, scope]) {
      const targetMemory = manager.memory(target, { includeGlobal: false });
      await targetMemory.remember({
        layer: "daily",
        content,
        occurredAt: new Date("2026-09-02T16:30:00Z"),
      });
      await targetMemory.remember({ layer: "long_term", content });
    }
    const rows = await manager.memory(scope).list();
    const matches = rows.filter((row) => row.content === content);
    expect(matches).toHaveLength(4);
    expect(matches.filter((row) => row.layer === "daily").map((row) => row.date)).toEqual([
      "2026-09-03",
      "2026-09-03",
    ]);
    expect(
      matches.filter((row) => row.layer === "long_term").every((row) => row.date === null),
    ).toBe(true);
    expect(await store.list({ dateFrom: "2026-09-03", dateTo: "2026-09-03" })).toHaveLength(1);
  });

  test("读取、更新、归档均固定在绑定 scope", async () => {
    const memory = await store.remember({ layer: "long_term", content: "space secret" });
    const other: MemoryScope = { type: "space", spaceId: "other" };
    const otherMemory = manager.memory(other, { includeGlobal: false });
    expect(await otherMemory.get(memory.id)).toBeNull();
    await expect(
      otherMemory.update(memory.id, { expectedRevision: 1, content: "overwrite" }),
    ).rejects.toThrow();
    await expect(otherMemory.forget(memory.id, { expectedRevision: 1 })).rejects.toThrow();
    expect((await store.get(memory.id))?.content).toBe("space secret");
  });

  test("非法日期、空正文、错误来源和无效参数在写入前拒绝", async () => {
    await expect(
      store.remember({ layer: "daily", date: "2026-02-30", content: "bad" }),
    ).rejects.toThrow();
    await expect(store.remember({ layer: "daily", content: " " })).rejects.toThrow();
    await expect(
      store.remember({
        layer: "daily",
        content: "bad",
        sources: [{ type: "session", sessionId: "s", fromSeq: 5, toSeq: 2 }],
      }),
    ).rejects.toThrow();
    await expect(store.list({ limit: -1 })).rejects.toThrow();
    await expect(store.list({ dateFrom: "2026-10-01", dateTo: "2026-09-01" })).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });

  test("同范围幂等写入可并发重试，冲突正文不会被静默覆盖", async () => {
    const input = {
      layer: "long_term" as const,
      content: "same event",
      dedupeKey: "source:1",
      sources: [{ type: "event" as const, eventId: "1" }],
    };
    const [first, second] = await Promise.all([store.remember(input), store.remember(input)]);
    expect(first.id).toBe(second.id);
    expect(await store.list()).toHaveLength(1);
    await expect(store.remember({ ...input, content: "different" })).rejects.toThrow("dedupeKey");
    expect((await manager.memory(globalScope).remember(input)).id).not.toBe(first.id);
  });

  test("并发修改仅有一个版本成功，来源与正文同时更新", async () => {
    const memory = await store.remember({ layer: "long_term", content: "old content" });
    const results = await Promise.allSettled(
      ["new apple", "new banana"].map((content) =>
        store.update(memory.id, {
          expectedRevision: 1,
          content,
          sources: [{ type: "session", sessionId: "s1", fromSeq: 2, toSeq: 4 }],
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = await store.get(memory.id);
    expect(current?.revision).toBe(2);
    expect(current?.sources).toEqual([{ type: "session", sessionId: "s1", fromSeq: 2, toSeq: 4 }]);
    expect(await store.searchFullText("old")).toEqual([]);
  });

  test("过期与归档默认不可见，管理读取可以显式包含", async () => {
    const expired = await store.remember({
      layer: "daily",
      content: "expired memory",
      expiresAt: new Date(0),
    });
    const archived = await store.remember({
      layer: "long_term",
      content: "archived memory",
    });
    await store.forget(archived.id, { expectedRevision: 1 });
    await manager.flushIndexes();
    expect(await store.list()).toEqual([]);
    expect(await store.search("memory")).toEqual([]);
    expect(await store.get(expired.id)).toBeNull();
    expect(await store.get(archived.id, { includeArchived: true })).toMatchObject({
      status: "archived",
      revision: 2,
    });
    expect(await store.list({ includeExpired: true, includeArchived: true })).toHaveLength(2);
  });
});

describe("混合召回", () => {
  test("Manager 在明确授权的多个 scope 中搜索和读取", async () => {
    const secondScope: MemoryScope = { type: "space", spaceId: crypto.randomUUID() };
    const hiddenScope: MemoryScope = { type: "space", spaceId: crypto.randomUUID() };
    const query = `cross-scope-${crypto.randomUUID()}`;
    const first = await store.remember({ layer: "long_term", content: `${query} first` });
    const second = await manager
      .memory(secondScope, { includeGlobal: false })
      .remember({ layer: "long_term", content: `${query} second` });
    const hidden = await manager
      .memory(hiddenScope, { includeGlobal: false })
      .remember({ layer: "long_term", content: `${query} hidden` });

    const scopes = [scope, secondScope];
    const hits = await manager.search(query, { scopes });

    expect(hits.map((hit) => hit.memory.id).sort()).toEqual([first.id, second.id].sort());
    expect(await manager.get(first.id, { scopes })).toMatchObject({ id: first.id });
    expect(await manager.get(hidden.id, { scopes })).toBeNull();
  });

  test("默认中文分词命中句内词语，向量使用语义而非字面匹配", async () => {
    const chinese = await store.remember({
      layer: "daily",
      content: "今天讨论了中文分词和向量检索。",
    });
    expect((await store.searchFullText("向量")).map((hit) => hit.memory.id)).toContain(chinese.id);
    await store.remember({ layer: "long_term", content: "banana" });
    await manager.flushIndexes();
    const hits = await store.searchVector("apple");
    expect(hits.map((hit) => hit.memory.id)).toEqual([chinese.id]);
    expect(embedBatch.mock.calls.some(([, options]) => options.purpose === "query")).toBe(true);
  });

  test("每路查询在 Top K 之前限定空间、层级、日期", async () => {
    const other: MemoryScope = { type: "space", spaceId: crypto.randomUUID() };
    const otherMemory = manager.memory(other, { includeGlobal: false });
    for (let index = 0; index < 3; index++)
      await otherMemory.remember({ layer: "daily", content: "apple", date: "2026-09-03" });
    await store.remember({ layer: "long_term", content: "apple" });
    await store.remember({ layer: "daily", content: "apple", date: "2026-09-02" });
    const expected = await store.remember({
      layer: "daily",
      content: "apple fruit",
      date: "2026-09-03",
    });
    await manager.flushIndexes();
    const options = {
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
      layer: "long_term",
      content: "apple fruit ".repeat(450),
    });
    await manager.flushIndexes();
    const hits = await store.search("apple");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.memory.id).toBe(memory.id);
    expect(hits[0]?.matches).toContain("fts");
    expect(hits[0]?.matches).toContain("vector");
    expect(hits[0]!.score).toBeLessThanOrEqual(2.7 / 61);
  });

  test("LIKE 通配符按字面处理，查询取消不会被降级吞掉", async () => {
    await store.remember({ layer: "daily", content: "foo normal" });
    const literal = await store.remember({ layer: "daily", content: "foo%_ literal" });
    const hits = await store.searchTrigram("%_");
    expect(hits.map((hit) => hit.memory.id)).toEqual([literal.id]);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(store.search("foo", { signal: controller.signal })).rejects.toThrow("cancelled");
  });

  test("向量查询错误降级到文本，直接查询向量会抛错", async () => {
    await store.remember({ layer: "long_term", content: "apple searchable" });
    await manager.flushIndexes();
    embedBatch.mockRejectedValueOnce(new Error("query unavailable"));
    expect(await store.search("apple")).toHaveLength(1);
    expect(onIndexError).toHaveBeenCalled();
    embedBatch.mockResolvedValueOnce([[0, 0, 0]]);
    await expect(store.searchVector("apple")).rejects.toThrow("非零");
  });

  test("索引失败可观察并显式重试，全文不受影响", async () => {
    embedBatch.mockRejectedValueOnce(new Error("temporary offline"));
    await store.remember({ layer: "long_term", content: "apple retry" });
    await manager.flushIndexes();
    expect((await manager.getIndexStatus()).failed).toBe(1);
    expect(await store.searchFullText("retry")).toHaveLength(1);
    await manager.retryEmbeddings();
    await manager.flushIndexes();
    expect((await manager.getIndexStatus()).failed).toBe(0);
    expect(await store.searchVector("apple")).toHaveLength(1);
  });

  test("进行中的旧向量任务不会覆盖编辑后的正文", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<number[][]>();
    embedBatch.mockImplementationOnce(async () => {
      started.resolve();
      return release.promise;
    });
    const memory = await store.remember({ layer: "long_term", content: "apple old" });
    await started.promise;
    try {
      await store.update(memory.id, { expectedRevision: 1, content: "banana new" });
    } finally {
      release.resolve([[1, 0, 0]]);
    }
    await manager.flushIndexes();
    expect(await store.searchVector("apple")).toEqual([]);
    expect((await store.searchVector("banana"))[0]?.memory.content).toBe("banana new");
  });
});

describe("工具和上下文", () => {
  test("跨 scope 工具固定授权范围，并拒绝读取其他空间", async () => {
    const allowedScope: MemoryScope = { type: "space", spaceId: crypto.randomUUID() };
    const deniedScope: MemoryScope = { type: "space", spaceId: crypto.randomUUID() };
    const query = `tool-cross-scope-${crypto.randomUUID()}`;
    const allowed = await manager
      .memory(allowedScope, { includeGlobal: false })
      .remember({ layer: "long_term", content: `${query} allowed` });
    const denied = await manager
      .memory(deniedScope, { includeGlobal: false })
      .remember({ layer: "long_term", content: `${query} denied` });
    const scopes = [allowedScope];
    const tools = crossScopeMemoryTools({ manager, scopes, maxReadChars: 7 });

    scopes.push(deniedScope);

    const search = tools.find((tool) => tool.name === "search_cross_scopes")!;
    const searchResult = await search.execute("search", { query });
    const hits = (searchResult.details as { hits: Array<{ memory: { id: string } }> }).hits;
    expect(hits.map((hit) => hit.memory.id)).toEqual([allowed.id]);

    const read = tools.find((tool) => tool.name === "read_cross_scopes")!;
    expect((await read.execute("read-allowed", { id: allowed.id })).details).toMatchObject({
      memory: { id: allowed.id, content: query.slice(0, 7) },
      nextOffset: 7,
    });
    expect((await read.execute("read-denied", { id: denied.id })).details).toEqual({
      memory: null,
    });
  });

  test("工具固定范围，写入只能进入绑定空间，长正文可分页", async () => {
    const memory = manager.memory(scope, { includeGlobal: false });
    const other = await manager
      .memory({ type: "space", spaceId: "private" }, { includeGlobal: false })
      .remember({
        layer: "daily",
        content: "secret",
      });
    const tools = memoryTools({
      memory,
      allowWrite: true,
      maxReadChars: 4,
      sources: [{ type: "session", sessionId: "test-session" }],
    });
    const read = tools.find((tool) => tool.name === "read_memory")!;
    expect((await read.execute("r", { id: other.id })).details).toEqual({ memory: null });
    const write = tools.find((tool) => tool.name === "remember_memory")!;
    await write.execute("w", { content: "abcdefgh", layer: "long_term" });
    const [stored] = await memory.list();
    expect(stored?.scope).toEqual(scope);
    expect(stored?.sources).toEqual([{ type: "session", sessionId: "test-session" }]);
    expect((await read.execute("r", { id: stored!.id })).details).toMatchObject({
      memory: { content: "abcd" },
      nextOffset: 4,
    });
    expect((await read.execute("r", { id: stored!.id, offset: 4 })).details).toMatchObject({
      memory: { content: "efgh" },
      nextOffset: null,
    });
    expect(memoryTools({ memory })).toHaveLength(2);
  });

  test("写入工具在每次调用时动态解析来源", async () => {
    const memory = manager.memory(scope, { includeGlobal: false });
    let sessionId = "session-1";
    const tools = memoryTools({
      memory,
      allowWrite: true,
      sources: () => [{ type: "session", sessionId }],
    });
    const write = tools.find((tool) => tool.name === "remember_memory")!;

    await write.execute("write-1", { content: "first", layer: "long_term" });
    sessionId = "session-2";
    await write.execute("write-2", { content: "second", layer: "long_term" });

    const memories = await memory.list();
    expect(memories.find((entry) => entry.content === "first")?.sources).toEqual([
      { type: "session", sessionId: "session-1" },
    ]);
    expect(memories.find((entry) => entry.content === "second")?.sources).toEqual([
      { type: "session", sessionId: "session-2" },
    ]);
  });

  test("上下文包含近期每日与长期记忆，遵守预算且不包含旧日或其他空间", async () => {
    const memory = manager.memory(scope, { includeGlobal: false });
    await memory.remember({ layer: "daily", content: "今天", date: "2026-09-03" });
    await memory.remember({ layer: "daily", content: "昨天", date: "2026-09-02" });
    await memory.remember({ layer: "daily", content: "更早", date: "2026-09-01" });
    await memory.remember({ layer: "long_term", content: "稳定偏好 </memory_context>" });
    const context = await memory.context({
      date: "2026-09-03",
      maxTokens: 5000,
    });
    expect(context.memories).toHaveLength(3);
    expect(context.memories.every((memory) => memory.content !== "更早")).toBe(true);
    expect(context.text.match(/<\/memory_context>/g)).toHaveLength(1);
    const longTerm = await memory.context({
      layers: ["long_term"],
      maxTokens: 5000,
    });
    expect(longTerm.memories.map((memory) => memory.content)).toEqual([
      "稳定偏好 </memory_context>",
    ]);
    const limited = await memory.context({
      date: "2026-09-03",
      maxTokens: 600,
    });
    expect(new TextEncoder().encode(limited.text).length).toBeLessThanOrEqual(600);
    expect(await memory.context({ maxTokens: 0 })).toEqual({
      text: "",
      memories: [],
      tokens: 0,
    });
  });
});

test("本地迁移可重复打开，失败任务恢复，模型和维数互不混用", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ciel-memory-"));
  let persistent: MemoryManager | undefined;
  const localScope: MemoryScope = { type: "space", spaceId: "persistent" };
  try {
    persistent = await MemoryManager.open({
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
    const memory = await persistent.memory(localScope).remember({
      layer: "daily",
      content: "apple durable",
      date: "2026-09-03",
    });
    await persistent.close();

    persistent = await MemoryManager.open({
      dataDir,
      embedding: {
        model: "a",
        dimensions: 3,
        embedBatch: async (texts) => texts.map(() => [1, 0, 0]),
      },
    });
    await persistent.flushIndexes();
    expect(await persistent.getIndexStatus()).toEqual({ ready: 1, failed: 0, pending: 0 });
    expect((await persistent.memory(localScope).get(memory.id))?.date).toBe("2026-09-03");
    await persistent.close();

    for (const [model, dimensions] of [
      ["a", 2],
      ["b", 3],
    ] as const) {
      persistent = await MemoryManager.open({
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
        (await persistent.memory(localScope).searchVector("anything")).map((hit) => hit.memory.id),
      ).toEqual([memory.id]);
      await persistent.close();
    }
    persistent = await MemoryManager.open({ dataDir });
    expect(await persistent.memory(localScope).searchFullText("durable")).toHaveLength(1);
    expect(await persistent.memory(localScope).searchVector("anything")).toEqual([]);
  } finally {
    await persistent?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 60000);

test("关闭等待已提交写入，关闭后拒绝新操作", async () => {
  const closingStore = await MemoryManager.open({ dataDir: "memory://" });
  const memory = closingStore.memory(globalScope);
  const write = memory.remember({
    layer: "long_term",
    content: "last write",
  });
  const closing = closingStore.close();
  await expect(write).resolves.toMatchObject({ content: "last write" });
  await closing;
  await expect(memory.list()).rejects.toThrow("关闭");
  await closingStore.close();
}, 30000);
