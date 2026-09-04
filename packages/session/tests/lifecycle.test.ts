import { expect, test, vi } from "vite-plus/test";

import { SessionManager, type Session } from "../src/index.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("关闭时先等待压缩，再等待尚未完成的向量索引", async () => {
  const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0]));
  const store = await SessionManager.open({
    dataDir: "memory://",
    embedding: { model: "test/lifecycle", dimensions: 3, embedBatch },
  });
  const summaryStarted = deferred<void>();
  const summaryReady = deferred<string>();
  const indexingStarted = deferred<void>();
  const vectorsReady = deferred<number[][]>();
  let closing: Promise<void> | undefined;
  let compacting: ReturnType<Session["compact"]> | undefined;

  try {
    const session = await store.session();
    for (let index = 0; index < 3; index++) {
      await session.appendMessage({
        role: "user",
        content: `message ${index}`,
        timestamp: index,
      });
    }
    await store.flushIndexes();

    embedBatch.mockImplementationOnce(() => {
      indexingStarted.resolve();
      return vectorsReady.promise;
    });
    await session.appendMessage({ role: "user", content: "pending", timestamp: 3 });
    await indexingStarted.promise;

    compacting = session.compact({
      contextWindow: 32000,
      keepRecentMessages: 1,
      force: true,
      summarize: () => {
        summaryStarted.resolve();
        return summaryReady.promise;
      },
    });
    await summaryStarted.promise;

    let isClosed = false;
    closing = store.close().then(() => {
      isClosed = true;
    });
    expect(await session.exists()).toBe(true);
    expect(isClosed).toBe(false);

    summaryReady.resolve("summary");
    expect(await compacting).toMatchObject({ summary: "summary", throughSeq: 3 });
    expect(await session.getLatestCompaction()).toMatchObject({ summary: "summary" });
    expect(isClosed).toBe(false);

    vectorsReady.resolve([[1, 0, 0]]);
    await closing;
    expect(isClosed).toBe(true);
  } finally {
    summaryReady.resolve("summary");
    vectorsReady.resolve([[1, 0, 0]]);
    await compacting?.catch(() => {});
    await (closing ?? store.close());
  }
}, 30_000);

test("未配置向量提供方时仍支持检索、重建和关闭", async () => {
  const store = await SessionManager.open({ dataDir: "memory://" });
  try {
    const session = await store.session();
    await session.appendMessage({ role: "user", content: "lexical", timestamp: 1 });

    await session.rebuildIndex();
    await store.rebuildEmbeddings();
    await store.flushIndexes();

    expect(await session.searchVector("lexical")).toEqual([]);
    const hits = await session.search("lexical");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.sources).toEqual(["fts", "trigram"]);
  } finally {
    await store.close();
  }
}, 30_000);
