import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { materializeMemoryEntries, type Database } from "./database.ts";
import type { MemoryEmbeddingIndex } from "./embedding-index.ts";
import { memories, memoryChunks, memoryEmbeddings } from "./schema.ts";
import { normalizeSearchText } from "./search.ts";
import type {
  MemoryScopeSelector,
  MemorySearchHit,
  MemorySearchOptions,
  SearchMethod,
} from "./types.ts";
import { filterCondition, integerOption } from "./validation.ts";

interface RawHit {
  id: string;
  revision: number;
  excerpt: string;
  score: number;
}

type ScopedSearchOptions = MemorySearchOptions & { scopes: MemoryScopeSelector };

export class MemoryRetrieval {
  constructor(
    private readonly db: Database,
    private readonly embeddingIndex: MemoryEmbeddingIndex,
    private readonly tokenize: (text: string) => string[],
  ) {}

  searchFullText(query: string, options: ScopedSearchOptions): Promise<MemorySearchHit[]> {
    return this.searchSingle("fts", query, options);
  }

  searchTrigram(query: string, options: ScopedSearchOptions): Promise<MemorySearchHit[]> {
    return this.searchSingle("trigram", query, options);
  }

  searchVector(query: string, options: ScopedSearchOptions): Promise<MemorySearchHit[]> {
    return this.searchSingle("vector", query, options);
  }

  async search(query: string, options: ScopedSearchOptions): Promise<MemorySearchHit[]> {
    const [fts, trigram, vector] = await Promise.all([
      this.searchRoute("fts", query, options),
      this.searchRoute("trigram", query, options),
      this.searchRoute("vector", query, options).catch((error: unknown) => {
        options.signal?.throwIfAborted();
        this.embeddingIndex.reportError(error);

        return [];
      }),
    ]);

    options.signal?.throwIfAborted();

    return this.mergeHits(
      [
        ["fts", fts],
        ["trigram", trigram],
        ["vector", vector],
      ],
      options,
    );
  }

  private async searchSingle(
    method: SearchMethod,
    query: string,
    options: ScopedSearchOptions,
  ): Promise<MemorySearchHit[]> {
    const hits = await this.searchRoute(method, query, options);

    return this.mergeHits([[method, hits]], options);
  }

  private async searchRoute(
    method: SearchMethod,
    query: string,
    options: ScopedSearchOptions,
  ): Promise<RawHit[]> {
    options.signal?.throwIfAborted();

    const filter = filterCondition(options);
    const limit = integerOption(options.candidateLimit ?? 50, "candidateLimit");
    const normalized = normalizeSearchText(query);

    const hasNoScopes = Array.isArray(options.scopes) && options.scopes.length === 0;

    if (!normalized || hasNoScopes) {
      return [];
    }

    if (method === "vector") {
      return this.searchVectorRoute(query, filter, limit, options);
    }

    let score;
    let match;

    if (method === "fts") {
      const tokens = this.tokenText(query);

      if (!tokens) {
        return [];
      }

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

  private async searchVectorRoute(
    query: string,
    filter: ReturnType<typeof filterCondition>,
    limit: number,
    options: ScopedSearchOptions,
  ): Promise<RawHit[]> {
    const model = this.embeddingIndex.model;

    if (!model) {
      return [];
    }

    const threshold = options.minVectorSimilarity ?? 0.35;

    if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) {
      throw new TypeError("相似度阈值必须在 -1 到 1 之间");
    }

    const vector = await this.embeddingIndex.embedQuery(query, options.signal);

    if (!vector) {
      return [];
    }

    // CASE 避免查询规划器在过滤其他维数之前先计算距离。
    const score = sql<number>`CASE WHEN ${memoryEmbeddings.model} = ${model.model}
      AND ${memoryEmbeddings.dimensions} = ${model.dimensions}
      AND ${memoryEmbeddings.status} = 'ready'
      THEN 1 - (${memoryEmbeddings.embedding} <=> ${JSON.stringify(vector)}::vector) ELSE NULL END`;

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
      .where(
        and(
          filter,
          eq(memoryEmbeddings.model, model.model),
          eq(memoryEmbeddings.dimensions, model.dimensions),
          sql`${score} >= ${threshold}`,
        ),
      )
      .orderBy(desc(score), asc(memoryChunks.id))
      .limit(limit);

    options.signal?.throwIfAborted();

    return rows;
  }

  private async mergeHits(
    routes: Array<[SearchMethod, RawHit[]]>,
    options: ScopedSearchOptions,
  ): Promise<MemorySearchHit[]> {
    const limit = integerOption(options.limit ?? 10, "limit");
    const hits = new Map<string, RawHit & { matches: SearchMethod[] }>();

    for (const [method, rows] of routes) {
      const seen = new Set<string>();

      for (const row of rows) {
        // 单路内一条记忆只计一次，避免长文本因分块多而获得额外权重。
        if (seen.has(row.id)) {
          continue;
        }

        seen.add(row.id);

        // 使用 k=60 的 RRF 融合排名，并降低 trigram 的权重以减少模糊匹配干扰。
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

    if (!hits.size) {
      return [];
    }

    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(memories)
        .where(and(inArray(memories.id, [...hits.keys()]), filterCondition(options)));
      const entries = await materializeMemoryEntries(transaction, rows);

      options.signal?.throwIfAborted();

      return entries
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

  private tokenText(text: string): string {
    return this.tokenize(normalizeSearchText(text))
      .map(normalizeSearchText)
      .filter(Boolean)
      .join(" ");
  }
}
