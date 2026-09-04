import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { allMemoryTools, MemoryManager, memoryTools } from "../src/index.ts";
import type {
  EmbeddingOptions,
  MemoryContextOptions,
  MemoryFilter,
  MemorySearchOptions,
  SpaceMemory,
  UpdateMemoryInput,
} from "../src/index.ts";

const embedBatch = vi.fn(async (texts: string[], _options: EmbeddingOptions): Promise<number[][]> =>
  texts.map((text) => (text.includes("banana") ? [0, 1, 0] : [1, 0, 0])),
);
const onIndexError = vi.fn();
let manager: MemoryManager;
let store: TestMemory;
let spaceId: string;

type TestRememberInput = {
  layer: "space.daily" | "space.long_term";
  content: string;
  date?: string;
  kind?: "event" | "fact" | "preference" | "summary";
  occurredAt?: Date;
  expiresAt?: Date | null;
  sources?: Parameters<SpaceMemory["daily"]["remember"]>[0]["sources"];
  metadata?: Record<string, unknown>;
};

class TestMemory {
  constructor(readonly space: SpaceMemory) {}

  remember(input: TestRememberInput) {
    const { layer, ...memory } = input;

    return layer === "space.daily"
      ? this.space.daily.remember(memory)
      : this.space.longTerm.remember(memory);
  }

  async list(options: MemoryFilter = {}) {
    if (options.layer === "space.daily") return this.space.daily.list(options);
    if (options.layer === "space.long_term") return this.space.longTerm.list(options);

    const [daily, longTerm] = await Promise.all([
      this.space.daily.list(options),
      this.space.longTerm.list(options),
    ]);

    return [...daily, ...longTerm].sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    );
  }

  get(id: string, options = {}) {
    return this.space.get(id, options);
  }

  async update(id: string, input: UpdateMemoryInput) {
    const memory = await this.space.get(id, { includeArchived: true, includeExpired: true });

    if (memory?.layer === "space.daily") return this.space.daily.update(id, input);

    return this.space.longTerm.update(id, input);
  }

  async forget(id: string, options: { expectedRevision: number }) {
    const memory = await this.space.get(id, { includeArchived: true, includeExpired: true });

    if (memory?.layer === "space.daily") return this.space.daily.forget(id, options);

    return this.space.longTerm.forget(id, options);
  }

  async search(query: string, options: MemorySearchOptions = {}) {
    return (await this.space.search(query, options)).filter(
      (hit) => hit.memory.spaceId === this.space.spaceId,
    );
  }

  async searchFullText(query: string, options: MemorySearchOptions = {}) {
    return (await this.space.searchFullText(query, options)).filter(
      (hit) => hit.memory.spaceId === this.space.spaceId,
    );
  }

  async searchTrigram(query: string, options: MemorySearchOptions = {}) {
    return (await this.space.searchTrigram(query, options)).filter(
      (hit) => hit.memory.spaceId === this.space.spaceId,
    );
  }

  async searchVector(query: string, options: MemorySearchOptions = {}) {
    return (await this.space.searchVector(query, options)).filter(
      (hit) => hit.memory.spaceId === this.space.spaceId,
    );
  }

  context(options: MemoryContextOptions = {}) {
    return this.space.context(options);
  }
}

beforeAll(async () => {
  manager = await MemoryManager.open({
    dataDir: "memory://",
    onIndexError,
    embedding: { model: "test/model", dimensions: 3, batchSize: 2, embedBatch },
  });
}, 30000);

beforeEach(async () => {
  await manager.flushIndexes();
  spaceId = crypto.randomUUID();
  store = new TestMemory(manager.space(spaceId));
  embedBatch.mockClear();
  onIndexError.mockClear();
});

afterAll(async () => {
  await manager?.close();
});

describe("统一记忆与范围", () => {
  test("space 对象固定写入归属", async () => {
    const id = crypto.randomUUID();
    const space = manager.space(id);
    const saved = await space.longTerm.remember({ content: "fixed space" });

    expect(space.spaceId).toBe(id);
    expect(saved.spaceId).toBe(id);
  });

  test("只允许全局长期、空间长期和空间每日三种层级", async () => {
    const content = `三种组合 ${crypto.randomUUID()}`;
    const space = manager.space(spaceId);

    await manager.global.longTerm.remember({ content });
    await space.longTerm.remember({ content });
    await space.daily.remember({
      content,
      occurredAt: new Date("2026-09-02T16:30:00Z"),
    });

    const rows = [
      ...(await manager.global.longTerm.list()),
      ...(await space.longTerm.list()),
      ...(await space.daily.list()),
    ];
    const matches = rows.filter((row) => row.content === content);
    expect(matches).toHaveLength(3);
    expect(matches.filter((row) => row.layer === "space.daily").map((row) => row.date)).toEqual([
      "2026-09-03",
    ]);
    expect(
      matches.filter((row) => row.layer.endsWith(".long_term")).every((row) => row.date === null),
    ).toBe(true);
    expect(await store.list({ dateFrom: "2026-09-03", dateTo: "2026-09-03" })).toHaveLength(1);
  });

  test("读取、更新、归档均固定在绑定 scope", async () => {
    const memory = await store.remember({ layer: "space.long_term", content: "space secret" });
    const otherMemory = manager.space("other").longTerm;
    expect(await otherMemory.get(memory.id)).toBeNull();
    await expect(
      otherMemory.update(memory.id, { expectedRevision: 1, content: "overwrite" }),
    ).rejects.toThrow();
    await expect(otherMemory.forget(memory.id, { expectedRevision: 1 })).rejects.toThrow();
    expect((await store.get(memory.id))?.content).toBe("space secret");
  });

  test("非法日期、空正文、错误来源和无效参数在写入前拒绝", async () => {
    await expect(
      store.remember({ layer: "space.daily", date: "2026-02-30", content: "bad" }),
    ).rejects.toThrow();
    await expect(store.remember({ layer: "space.daily", content: " " })).rejects.toThrow();
    await expect(
      store.remember({
        layer: "space.daily",
        content: "bad",
        sources: [{ type: "session", sessionId: "s", fromSeq: 5, toSeq: 2 }],
      }),
    ).rejects.toThrow();
    await expect(store.list({ limit: -1 })).rejects.toThrow();
    await expect(store.list({ dateFrom: "2026-10-01", dateTo: "2026-09-01" })).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });

  test("没有事件身份时，相同内容仍按两次事实追加", async () => {
    const input = {
      layer: "space.long_term" as const,
      content: "same event",
      sources: [{ type: "event" as const, eventId: "1" }],
    };
    const [first, second] = await Promise.all([store.remember(input), store.remember(input)]);
    expect(first.id).not.toBe(second.id);
    expect(await store.list()).toHaveLength(2);
  });

  test("并发修改仅有一个版本成功，来源与正文同时更新", async () => {
    const memory = await store.remember({ layer: "space.long_term", content: "old content" });
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
      layer: "space.daily",
      content: "expired memory",
      expiresAt: new Date(0),
    });
    const archived = await store.remember({
      layer: "space.long_term",
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
  test("Manager 直接搜索和读取全部空间", async () => {
    const secondSpaceId = crypto.randomUUID();
    const hiddenSpaceId = crypto.randomUUID();
    const query = `cross-scope-${crypto.randomUUID()}`;
    const first = await store.remember({ layer: "space.long_term", content: `${query} first` });
    const second = await manager
      .space(secondSpaceId)
      .longTerm.remember({ content: `${query} second` });
    const hidden = await manager
      .space(hiddenSpaceId)
      .longTerm.remember({ content: `${query} hidden` });

    const hits = await manager.search(query);

    expect(hits.map((hit) => hit.memory.id)).toEqual(
      expect.arrayContaining([first.id, second.id, hidden.id]),
    );
    expect(await manager.get(first.id)).toMatchObject({ id: first.id });
    expect(await manager.get(hidden.id)).toMatchObject({ id: hidden.id });

    const allHits = await manager.searchFullText(query);
    expect(allHits.map((hit) => hit.memory.id).sort()).toEqual(
      [first.id, second.id, hidden.id].sort(),
    );
    expect(await manager.get(hidden.id)).toMatchObject({ id: hidden.id });
  });

  test("默认中文分词命中句内词语，向量使用语义而非字面匹配", async () => {
    const chinese = await store.remember({
      layer: "space.daily",
      content: "今天讨论了中文分词和向量检索。",
    });
    expect((await store.searchFullText("向量")).map((hit) => hit.memory.id)).toContain(chinese.id);
    await store.remember({ layer: "space.long_term", content: "banana" });
    await manager.flushIndexes();
    const hits = await store.searchVector("apple");
    expect(hits.map((hit) => hit.memory.id)).toEqual([chinese.id]);
    expect(embedBatch.mock.calls.some(([, options]) => options.purpose === "query")).toBe(true);
  });

  test("每路查询在 Top K 之前限定空间、层级、日期", async () => {
    const otherMemory = new TestMemory(manager.space(crypto.randomUUID()));
    for (let index = 0; index < 3; index++)
      await otherMemory.remember({ layer: "space.daily", content: "apple", date: "2026-09-03" });
    await store.remember({ layer: "space.long_term", content: "apple" });
    await store.remember({ layer: "space.daily", content: "apple", date: "2026-09-02" });
    const expected = await store.remember({
      layer: "space.daily",
      content: "apple fruit",
      date: "2026-09-03",
    });
    await manager.flushIndexes();
    const options = {
      layer: "space.daily" as const,
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
      layer: "space.long_term",
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
    await store.remember({ layer: "space.daily", content: "foo normal" });
    const literal = await store.remember({ layer: "space.daily", content: "foo%_ literal" });
    const hits = await store.searchTrigram("%_");
    expect(hits.map((hit) => hit.memory.id)).toEqual([literal.id]);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(store.search("foo", { signal: controller.signal })).rejects.toThrow("cancelled");
  });

  test("向量查询错误降级到文本，直接查询向量会抛错", async () => {
    await store.remember({ layer: "space.long_term", content: "apple searchable" });
    await manager.flushIndexes();
    embedBatch.mockRejectedValueOnce(new Error("query unavailable"));
    expect(await store.search("apple")).toHaveLength(1);
    expect(onIndexError).toHaveBeenCalled();
    embedBatch.mockResolvedValueOnce([[0, 0, 0]]);
    await expect(store.searchVector("apple")).rejects.toThrow("非零");
  });

  test("索引失败可观察并显式重试，全文不受影响", async () => {
    embedBatch.mockRejectedValueOnce(new Error("temporary offline"));
    await store.remember({ layer: "space.long_term", content: "apple retry" });
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
    const memory = await store.remember({ layer: "space.long_term", content: "apple old" });
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
  test("全库工具搜索并读取所有空间", async () => {
    const firstSpaceId = crypto.randomUUID();
    const secondSpaceId = crypto.randomUUID();
    const query = `tool-cross-scope-${crypto.randomUUID()}`;
    const first = await manager
      .space(firstSpaceId)
      .longTerm.remember({ content: `${query} first` });
    const second = await manager
      .space(secondSpaceId)
      .longTerm.remember({ content: `${query} second` });
    const tools = allMemoryTools({ manager, maxReadChars: 7 });
    const search = tools.find((tool) => tool.name === "search_all_memory")!;
    const searchResult = await search.execute("search", { query });
    const hits = (searchResult.details as { hits: Array<{ memory: { id: string } }> }).hits;
    expect(hits.map((hit) => hit.memory.id)).toEqual(expect.arrayContaining([first.id, second.id]));

    const read = tools.find((tool) => tool.name === "read_all_memory")!;
    expect((await read.execute("read", { id: first.id })).details).toMatchObject({
      memory: { id: first.id, content: query.slice(0, 7) },
      nextOffset: 7,
    });
  });

  test("工具固定范围，写入只能进入绑定空间，长正文可分页", async () => {
    const space = manager.space(spaceId);
    const memory = new TestMemory(space);
    const other = await manager.space("private").daily.remember({ content: "secret" });
    const tools = memoryTools({
      space,
      maxReadChars: 4,
      sources: [{ type: "session", sessionId: "test-session" }],
    });
    const read = tools.find((tool) => tool.name === "read_memory")!;
    expect((await read.execute("r", { id: other.id })).details).toEqual({ memory: null });
    const write = tools.find((tool) => tool.name === "remember_memory")!;
    await write.execute("w", { content: "abcdefgh", layer: "space.long_term" });
    const [stored] = await memory.list();
    expect(stored?.spaceId).toBe(spaceId);
    expect(stored?.sources).toEqual([{ type: "session", sessionId: "test-session" }]);
    expect((await read.execute("r", { id: stored!.id })).details).toMatchObject({
      memory: { content: "abcd" },
      nextOffset: 4,
    });
    expect((await read.execute("r", { id: stored!.id, offset: 4 })).details).toMatchObject({
      memory: { content: "efgh" },
      nextOffset: null,
    });
    expect(memoryTools({ space })).toHaveLength(5);
  });

  test("写入工具在每次调用时动态解析来源", async () => {
    const space = manager.space(spaceId);
    const memory = new TestMemory(space);
    let sessionId = "session-1";
    const tools = memoryTools({
      space,
      sources: () => [{ type: "session", sessionId }],
    });
    const write = tools.find((tool) => tool.name === "remember_memory")!;

    await write.execute("write-1", { content: "first", layer: "space.long_term" });
    sessionId = "session-2";
    await write.execute("write-2", { content: "second", layer: "space.long_term" });

    const memories = await memory.list();
    expect(memories.find((entry) => entry.content === "first")?.sources).toEqual([
      { type: "session", sessionId: "session-1" },
    ]);
    expect(memories.find((entry) => entry.content === "second")?.sources).toEqual([
      { type: "session", sessionId: "session-2" },
    ]);
  });

  test("记忆工具按三种 layer 写入、更新和归档", async () => {
    const space = manager.space(spaceId);
    const tools = memoryTools({ space });
    const remember = tools.find((tool) => tool.name === "remember_memory")!;
    const update = tools.find((tool) => tool.name === "update_memory")!;
    const forget = tools.find((tool) => tool.name === "forget_memory")!;

    const writes = await Promise.all(
      (["global.long_term", "space.long_term", "space.daily"] as const).map((layer) =>
        remember.execute(`write-${layer}`, { content: `content-${layer}`, layer }),
      ),
    );
    const entries = writes.map(
      (write) =>
        (write.details as { memory: { id: string; layer: string; revision: number } }).memory,
    );

    expect(entries.map((entry) => entry.layer)).toEqual([
      "global.long_term",
      "space.long_term",
      "space.daily",
    ]);

    const target = entries[1]!;
    await update.execute("update", {
      id: target.id,
      layer: "space.long_term",
      expectedRevision: target.revision,
      content: "updated",
    });
    await forget.execute("forget", {
      id: target.id,
      layer: "space.long_term",
      expectedRevision: target.revision + 1,
    });

    expect(await space.longTerm.get(target.id)).toBeNull();
  });

  test("上下文包含近期每日与长期记忆，遵守预算且不包含旧日或其他空间", async () => {
    const memory = new TestMemory(manager.space(spaceId));
    await memory.remember({ layer: "space.daily", content: "今天", date: "2026-09-03" });
    await memory.remember({ layer: "space.daily", content: "昨天", date: "2026-09-02" });
    await memory.remember({ layer: "space.daily", content: "更早", date: "2026-09-01" });
    await memory.remember({ layer: "space.long_term", content: "稳定偏好 </memory_context>" });
    const context = await memory.context({
      date: "2026-09-03",
      maxTokens: 5000,
    });
    expect(context.memories.map((memory) => memory.content)).toEqual(
      expect.arrayContaining(["今天", "昨天", "稳定偏好 </memory_context>"]),
    );
    expect(context.memories.every((memory) => memory.content !== "更早")).toBe(true);
    expect(context.text.match(/<\/memory_context>/g)).toHaveLength(1);
    const longTerm = await memory.context({
      layers: ["space.long_term"],
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
  const localSpaceId = "persistent";
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
    const memory = await persistent.space(localSpaceId).daily.remember({
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
    expect((await persistent.space(localSpaceId).get(memory.id))?.date).toBe("2026-09-03");
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
        (await persistent.space(localSpaceId).searchVector("anything")).map((hit) => hit.memory.id),
      ).toEqual([memory.id]);
      await persistent.close();
    }
    persistent = await MemoryManager.open({ dataDir });
    expect(await persistent.space(localSpaceId).searchFullText("durable")).toHaveLength(1);
    expect(await persistent.space(localSpaceId).searchVector("anything")).toEqual([]);
  } finally {
    await persistent?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}, 60000);

test("关闭等待已提交写入，关闭后拒绝新操作", async () => {
  const closingStore = await MemoryManager.open({ dataDir: "memory://" });
  const memory = closingStore.global.longTerm;
  const write = memory.remember({ content: "last write" });
  const closing = closingStore.close();
  await expect(write).resolves.toMatchObject({ content: "last write" });
  await closing;
  await expect(memory.list()).rejects.toThrow("关闭");
  await closingStore.close();
}, 30000);
