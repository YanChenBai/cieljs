import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { memories, memoryChunks, memoryEmbeddings, memorySources } from "./schema.ts";
import { chunkText, normalizeSearchText, tokenizeSearchText } from "./search.ts";
import {
  accessCondition,
  assertContent,
  assertDate,
  assertKind,
  assertProvider,
  assertSources,
  assertTimestamp,
  assertVectors,
  filterCondition,
  integerOption,
  scopeColumns,
  scopeCondition,
} from "./validation.ts";
import type {
  Memory,
  MemoryAccess,
  MemoryFilter,
  MemoryScope,
  MemorySearchHit,
  MemorySearchOptions,
  MemorySource,
  MemoryStoreOptions,
  RememberInput,
  SearchMethod,
  UpdateMemoryInput,
} from "./types.ts";

const migrationsFolder = fileURLToPath(new URL("../migrations/", import.meta.url));
type Database = ReturnType<typeof drizzle>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type MemoryRow = typeof memories.$inferSelect;
interface RawHit {
  id: string;
  revision: number;
  excerpt: string;
  score: number;
}

export class MemoryStore {
  readonly timeZone: string;
  private readonly db: Database;
  private readonly tokenize: (text: string) => string[];
  private indexing: Promise<void> = Promise.resolve();
  private readonly operations = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly client: PGlite,
    private readonly options: MemoryStoreOptions,
  ) {
    this.db = drizzle({ client });
    this.timeZone = options.timeZone ?? "Asia/Shanghai";
    this.tokenize = options.tokenize ?? tokenizeSearchText;
  }

  static async open(options: MemoryStoreOptions): Promise<MemoryStore> {
    if (options.embedding) assertProvider(options.embedding);
    new Intl.DateTimeFormat("en", { timeZone: options.timeZone ?? "Asia/Shanghai" });
    const client = new PGlite(options.dataDir, { extensions: { vector, pg_trgm } });

    try {
      await client.waitReady;
      await client.exec(
        "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;",
      );
      const store = new MemoryStore(client, options);
      await migrate(store.db, { migrationsFolder });
      // 任务和正文一起持久化；换模型或上次进程退出后补齐当前模型的任务。
      await store.prepareEmbeddings();
      store.enqueueIndexing();
      return store;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  getDate(at = new Date()): string {
    assertTimestamp(at);
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: this.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const part = (type: string) => parts.find((item) => item.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  remember(input: RememberInput): Promise<Memory> {
    return this.operate(async () => {
      assertContent(input.content);
      const scope = scopeColumns(input.scope);
      const occurredAt = input.occurredAt ?? new Date();
      assertTimestamp(occurredAt);
      if (input.expiresAt) assertTimestamp(input.expiresAt);
      if (!["daily", "long_term"].includes(input.layer)) throw new TypeError("无效的记忆层级");
      if (input.layer === "long_term" && input.date !== undefined)
        throw new TypeError("长期记忆不能设置日期");
      const date = input.layer === "daily" ? (input.date ?? this.getDate(occurredAt)) : null;
      if (date !== null) assertDate(date);
      const kind = input.kind ?? (input.layer === "daily" ? "event" : "fact");
      assertKind(kind);
      const sources = input.sources ?? [];
      assertSources(sources);
      if (input.dedupeKey !== undefined && !input.dedupeKey.trim())
        throw new TypeError("dedupeKey 不能为空");

      const result = await this.db.transaction(async (tx) => {
        if (input.dedupeKey) {
          const [existing] = await tx
            .select()
            .from(memories)
            .where(and(scopeCondition(input.scope), eq(memories.dedupeKey, input.dedupeKey)));
          if (existing) {
            const [memory] = await this.materialize(tx, [existing]);
            if (
              existing.content !== input.content ||
              existing.layer !== input.layer ||
              existing.date !== date ||
              existing.kind !== kind ||
              !isDeepStrictEqual(memory!.sources, sources) ||
              !isDeepStrictEqual(existing.metadata, input.metadata ?? {}) ||
              existing.expiresAt?.getTime() !== input.expiresAt?.getTime() ||
              (input.occurredAt && existing.occurredAt.getTime() !== input.occurredAt.getTime())
            ) {
              throw new Error("dedupeKey 已用于不同的记忆内容");
            }
            return memory!;
          }
        }

        const [row] = await tx
          .insert(memories)
          .values({
            id: crypto.randomUUID(),
            ...scope,
            layer: input.layer,
            date,
            kind,
            content: input.content,
            occurredAt,
            expiresAt: input.expiresAt,
            dedupeKey: input.dedupeKey,
            metadata: input.metadata,
          })
          .returning();
        await this.replaceSources(tx, row!.id, sources);
        await this.replaceChunks(tx, row!.id, input.content);
        return (await this.materialize(tx, [row!]))[0]!;
      });

      this.enqueueIndexing();
      return result;
    });
  }

  get(id: string, options: MemoryAccess): Promise<Memory | null> {
    return this.operate(() =>
      this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), accessCondition(options)));
        return (await this.materialize(tx, rows))[0] ?? null;
      }),
    );
  }

  list(options: MemoryFilter): Promise<Memory[]> {
    return this.operate(() =>
      this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(memories)
          .where(filterCondition(options))
          .orderBy(desc(memories.occurredAt), asc(memories.id))
          .limit(integerOption(options.limit ?? 50, "limit"))
          .offset(integerOption(options.offset ?? 0, "offset", 0, Number.MAX_SAFE_INTEGER));
        return this.materialize(tx, rows);
      }),
    );
  }

  update(id: string, input: UpdateMemoryInput): Promise<Memory> {
    return this.operate(async () => {
      integerOption(input.expectedRevision, "expectedRevision", 1, 2147483646);
      if (input.content !== undefined) assertContent(input.content);
      if (input.kind !== undefined) assertKind(input.kind);
      if (input.sources !== undefined) assertSources(input.sources);
      if (input.expiresAt) assertTimestamp(input.expiresAt);

      const memory = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .update(memories)
          .set({
            content: input.content,
            kind: input.kind,
            expiresAt: input.expiresAt,
            metadata: input.metadata,
            revision: sql`${memories.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(memories.id, id),
              scopeCondition(input.scope),
              eq(memories.status, "active"),
              eq(memories.revision, input.expectedRevision),
            ),
          )
          .returning();
        if (!row) throw new Error("记忆不存在、不可访问或版本已变化");
        if (input.sources !== undefined) await this.replaceSources(tx, id, input.sources);
        if (input.content !== undefined) await this.replaceChunks(tx, id, row.content);
        return (await this.materialize(tx, [row]))[0]!;
      });

      this.enqueueIndexing();
      return memory;
    });
  }

  /** 归档后默认读取和检索不再返回；保留正文与来源供管理端查阅。 */
  forget(id: string, options: { scope: MemoryScope; expectedRevision: number }): Promise<void> {
    return this.operate(async () => {
      integerOption(options.expectedRevision, "expectedRevision", 1, 2147483646);
      await this.db.transaction(async (tx) => {
        const rows = await tx
          .update(memories)
          .set({
            status: "archived",
            revision: sql`${memories.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(memories.id, id),
              scopeCondition(options.scope),
              eq(memories.revision, options.expectedRevision),
              eq(memories.status, "active"),
            ),
          )
          .returning();
        if (!rows.length) throw new Error("记忆不存在、不可访问或版本已变化");
        await tx.delete(memoryChunks).where(eq(memoryChunks.memoryId, id));
      });
    });
  }

  searchFullText(query: string, options: MemorySearchOptions): Promise<MemorySearchHit[]> {
    return this.searchSingle("fts", query, options);
  }

  searchTrigram(query: string, options: MemorySearchOptions): Promise<MemorySearchHit[]> {
    return this.searchSingle("trigram", query, options);
  }

  searchVector(query: string, options: MemorySearchOptions): Promise<MemorySearchHit[]> {
    return this.searchSingle("vector", query, options);
  }

  search(query: string, options: MemorySearchOptions): Promise<MemorySearchHit[]> {
    return this.operate(async () => {
      const [fts, trigram, vectorHits] = await Promise.all([
        this.searchRoute("fts", query, options),
        this.searchRoute("trigram", query, options),
        this.searchRoute("vector", query, options).catch((error: unknown) => {
          options.signal?.throwIfAborted();
          this.reportIndexError(error);
          return [];
        }),
      ]);
      options.signal?.throwIfAborted();
      return this.mergeHits(
        [
          ["fts", fts],
          ["trigram", trigram],
          ["vector", vectorHits],
        ],
        options,
      );
    });
  }

  rebuildIndex(options: MemoryAccess): Promise<void> {
    return this.operate(async () => {
      await this.db.transaction(async (tx) => {
        const rows = await tx.select().from(memories).where(accessCondition(options));
        for (const row of rows) {
          if (row.status === "active") await this.replaceChunks(tx, row.id, row.content);
        }
      });
      this.enqueueIndexing();
    });
  }

  rebuildEmbeddings(options: MemoryAccess): Promise<void> {
    return this.operate(async () => {
      await this.prepareEmbeddings(options, true);
      this.enqueueIndexing();
    });
  }

  retryEmbeddings(): Promise<void> {
    return this.operate(async () => {
      await this.prepareEmbeddings();
      this.enqueueIndexing();
    });
  }

  getIndexStatus(): Promise<{ pending: number; ready: number; failed: number }> {
    return this.operate(async () => {
      const result = { pending: 0, ready: 0, failed: 0 };
      if (!this.options.embedding) return result;
      const rows = await this.db
        .select({ status: memoryEmbeddings.status, count: sql<number>`count(*)::integer` })
        .from(memoryEmbeddings)
        .where(this.modelCondition())
        .groupBy(memoryEmbeddings.status);
      for (const row of rows) result[row.status] = row.count;
      return result;
    });
  }

  flushIndexes(): Promise<void> {
    return this.operate(async () => {
      let current: Promise<void>;
      do {
        current = this.indexing;
        await current;
      } while (current !== this.indexing);
    });
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      // 已提交的写操作可能继续排入索引，必须先等业务操作再等索引。
      await Promise.allSettled(this.operations);
      await this.indexing;
      await this.client.close();
    })();
    return this.closing;
  }

  private operate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error("MemoryStore 已关闭或正在关闭"));
    const result = Promise.resolve().then(operation);
    this.operations.add(result);
    void result.then(
      () => this.operations.delete(result),
      () => this.operations.delete(result),
    );
    return result;
  }

  private async materialize(tx: Transaction, rows: MemoryRow[]): Promise<Memory[]> {
    if (!rows.length) return [];
    const sources = await tx
      .select()
      .from(memorySources)
      .where(
        inArray(
          memorySources.memoryId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(memorySources.position));
    return rows.map((row) => ({
      id: row.id,
      scope:
        row.scopeType === "global" ? { type: "global" } : { type: "space", spaceId: row.scopeId },
      layer: row.layer,
      date: row.date,
      kind: row.kind,
      content: row.content,
      status: row.status,
      revision: row.revision,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
      metadata: row.metadata,
      sources: sources
        .filter((source) => source.memoryId === row.id)
        .map((source) => source.source),
    }));
  }

  private async replaceSources(
    tx: Transaction,
    id: string,
    sources: MemorySource[],
  ): Promise<void> {
    await tx.delete(memorySources).where(eq(memorySources.memoryId, id));
    if (sources.length) {
      await tx
        .insert(memorySources)
        .values(sources.map((source, position) => ({ memoryId: id, position, source })));
    }
  }

  private async replaceChunks(tx: Transaction, id: string, content: string): Promise<void> {
    // 每次正文修改都换 chunk ID，旧异步任务无法重新写入已经删除的版本。
    await tx.delete(memoryChunks).where(eq(memoryChunks.memoryId, id));
    const chunks = chunkText(content).map((chunk, position) => ({
      id: crypto.randomUUID(),
      memoryId: id,
      position,
      content: chunk,
      searchText: normalizeSearchText(chunk),
      tokenText: this.tokenText(chunk),
    }));
    await tx.insert(memoryChunks).values(chunks);
    const provider = this.options.embedding;
    if (provider) {
      await tx.insert(memoryEmbeddings).values(
        chunks.map((chunk) => ({
          chunkId: chunk.id,
          model: provider.model,
          dimensions: provider.dimensions,
        })),
      );
    }
  }

  private tokenText(text: string): string {
    return this.tokenize(normalizeSearchText(text))
      .map(normalizeSearchText)
      .filter(Boolean)
      .join(" ");
  }

  private modelCondition() {
    const provider = this.options.embedding!;
    return and(
      eq(memoryEmbeddings.model, provider.model),
      eq(memoryEmbeddings.dimensions, provider.dimensions),
    )!;
  }

  private async prepareEmbeddings(options?: MemoryAccess, reset = false): Promise<void> {
    const provider = this.options.embedding;
    if (!provider) return;
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: memoryChunks.id })
        .from(memoryChunks)
        .innerJoin(memories, eq(memories.id, memoryChunks.memoryId))
        .where(and(eq(memories.status, "active"), options ? accessCondition(options) : undefined));
      // 分批避免大库重启时超出 PostgreSQL 参数数量限制。
      for (let start = 0; start < rows.length; start += 500) {
        const ids = rows.slice(start, start + 500).map((row) => row.id);
        await tx
          .insert(memoryEmbeddings)
          .values(
            ids.map((id) => ({
              chunkId: id,
              model: provider.model,
              dimensions: provider.dimensions,
            })),
          )
          .onConflictDoNothing();
        await tx
          .update(memoryEmbeddings)
          .set({ status: "pending", embedding: null, error: null })
          .where(
            and(
              this.modelCondition(),
              inArray(memoryEmbeddings.chunkId, ids),
              reset ? undefined : eq(memoryEmbeddings.status, "failed"),
            ),
          );
      }
    });
  }

  private enqueueIndexing(): void {
    if (!this.options.embedding) return;
    this.indexing = this.indexing
      .then(() => this.indexPending())
      .catch((error: unknown) => this.reportIndexError(error));
  }

  private async indexPending(): Promise<void> {
    const provider = this.options.embedding!;
    while (true) {
      const rows = await this.db
        .select({ id: memoryChunks.id, content: memoryChunks.content })
        .from(memoryEmbeddings)
        .innerJoin(memoryChunks, eq(memoryChunks.id, memoryEmbeddings.chunkId))
        .where(and(this.modelCondition(), eq(memoryEmbeddings.status, "pending")))
        .orderBy(asc(memoryChunks.id))
        .limit(provider.batchSize ?? 32);
      if (!rows.length) return;

      try {
        const vectors = await provider.embedBatch(
          rows.map((row) => row.content),
          { purpose: "document" },
        );
        assertVectors(vectors, rows.length, provider.dimensions);
        await this.db.transaction(async (tx) => {
          for (const [index, row] of rows.entries()) {
            await tx
              .update(memoryEmbeddings)
              .set({ embedding: vectors[index]!, status: "ready", error: null })
              .where(
                and(
                  this.modelCondition(),
                  eq(memoryEmbeddings.chunkId, row.id),
                  eq(memoryEmbeddings.status, "pending"),
                ),
              );
          }
        });
      } catch (error) {
        await this.db
          .update(memoryEmbeddings)
          .set({
            status: "failed",
            embedding: null,
            error: error instanceof Error ? error.message : String(error),
          })
          .where(
            and(
              this.modelCondition(),
              inArray(
                memoryEmbeddings.chunkId,
                rows.map((row) => row.id),
              ),
              eq(memoryEmbeddings.status, "pending"),
            ),
          );
        this.reportIndexError(error);
      }
    }
  }

  private reportIndexError(error: unknown): void {
    try {
      if (this.options.onIndexError) this.options.onIndexError(error);
      else console.warn("[memory] 向量索引或检索失败", error);
    } catch (callbackError) {
      console.warn("[memory] 索引错误回调失败", callbackError);
    }
  }

  private searchSingle(
    method: SearchMethod,
    query: string,
    options: MemorySearchOptions,
  ): Promise<MemorySearchHit[]> {
    return this.operate(async () =>
      this.mergeHits([[method, await this.searchRoute(method, query, options)]], options),
    );
  }

  private async searchRoute(
    method: SearchMethod,
    query: string,
    options: MemorySearchOptions,
  ): Promise<RawHit[]> {
    options.signal?.throwIfAborted();
    const filter = filterCondition(options);
    const limit = integerOption(options.candidateLimit ?? 50, "candidateLimit");
    const normalized = normalizeSearchText(query);
    if (!normalized || !options.scopes.length) return [];
    let score;
    let match;

    if (method === "vector") {
      const provider = this.options.embedding;
      if (!provider) return [];
      const threshold = options.minVectorSimilarity ?? 0.35;
      if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1)
        throw new TypeError("相似度阈值必须在 -1 到 1 之间");
      const vectors = await provider.embedBatch([query], {
        purpose: "query",
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
      assertVectors(vectors, 1, provider.dimensions);
      // CASE 避免查询规划器在过滤其他维数之前先计算距离。
      score = sql<number>`CASE WHEN ${this.modelCondition()} AND ${memoryEmbeddings.status} = 'ready'
        THEN 1 - (${memoryEmbeddings.embedding} <=> ${JSON.stringify(vectors[0])}::vector) ELSE NULL END`;
      const rows = await this.db
        .select({
          id: memories.id,
          revision: memories.revision,
          excerpt: memoryChunks.content,
          score,
        })
        .from(memoryChunks)
        .innerJoin(memories, eq(memories.id, memoryChunks.memoryId))
        .innerJoin(memoryEmbeddings, eq(memoryEmbeddings.chunkId, memoryChunks.id))
        .where(and(filter, this.modelCondition(), sql`${score} >= ${threshold}`))
        .orderBy(desc(score), asc(memoryChunks.id))
        .limit(limit);
      options.signal?.throwIfAborted();
      return rows;
    }

    if (method === "fts") {
      const tokens = this.tokenText(query);
      if (!tokens) return [];
      const document = sql`to_tsvector('simple', ${memoryChunks.tokenText})`;
      const tsQuery = sql`plainto_tsquery('simple', ${tokens})`;
      score = sql<number>`ts_rank_cd(${document}, ${tsQuery})`;
      match = sql`${document} @@ ${tsQuery}`;
    } else {
      score = sql<number>`similarity(${memoryChunks.searchText}, ${normalized})`;
      // 显式转义 LIKE 通配符，短中文词也可按字面子串命中。
      const pattern = `%${normalized.replace(/[\\%_]/g, "\\$&")}%`;
      match = sql`(${memoryChunks.searchText} % ${normalized} OR ${memoryChunks.searchText} LIKE ${pattern})`;
    }

    const rows = await this.db
      .select({
        id: memories.id,
        revision: memories.revision,
        excerpt: memoryChunks.content,
        score,
      })
      .from(memoryChunks)
      .innerJoin(memories, eq(memories.id, memoryChunks.memoryId))
      .where(and(filter, match))
      .orderBy(desc(score), asc(memoryChunks.id))
      .limit(limit);
    options.signal?.throwIfAborted();
    return rows;
  }

  private async mergeHits(
    routes: Array<[SearchMethod, RawHit[]]>,
    options: MemorySearchOptions,
  ): Promise<MemorySearchHit[]> {
    const limit = integerOption(options.limit ?? 10, "limit");
    const hits = new Map<string, RawHit & { matches: SearchMethod[] }>();
    for (const [method, rows] of routes) {
      const seen = new Set<string>();
      for (const row of rows) {
        // 单路内一条记忆只计一次，避免长文本因分块多而获得额外权重。
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        const score = (method === "trigram" ? 0.7 : 1) / (60 + seen.size);
        const existing = hits.get(row.id);
        if (existing) {
          existing.score += score;
          existing.matches.push(method);
        } else {
          hits.set(row.id, { ...row, score, matches: [method] });
        }
      }
    }
    if (!hits.size) return [];

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(memories)
        .where(and(inArray(memories.id, [...hits.keys()]), filterCondition(options)));
      const values = await this.materialize(tx, rows);
      options.signal?.throwIfAborted();
      return values
        .flatMap((memory) => {
          const hit = hits.get(memory.id)!;
          // 检索期间发生更新或归档时，不返回旧正文的命中片段。
          return memory.revision === hit.revision
            ? [{ memory, excerpt: hit.excerpt, score: hit.score, matches: hit.matches }]
            : [];
        })
        .sort(
          (left, right) =>
            right.score - left.score || left.memory.id.localeCompare(right.memory.id),
        )
        .slice(0, limit);
    });
  }
}
