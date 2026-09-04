import { and, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";

import type { Database } from "./database.ts";
import type { EmbeddingIndex } from "./embedding-index.ts";
import { retrievalChunks, retrievalEmbeddings } from "./schema.ts";
import { normalizeSearchText } from "./search.ts";
import type { RawSearchHit, SearchHit, SearchOptions, SearchSource } from "./types.ts";

interface RetrievalSearchOptions extends SearchOptions {
  sessionId?: string;
}

export class SessionRetrieval {
  private readonly db: Database;
  private readonly embeddingIndex: EmbeddingIndex;

  constructor(db: Database, embeddingIndex: EmbeddingIndex) {
    this.db = db;
    this.embeddingIndex = embeddingIndex;
  }

  async searchFullText(
    query: string,
    options: RetrievalSearchOptions = {},
  ): Promise<RawSearchHit[]> {
    const limit = options.ftsLimit ?? options.limit ?? 20;

    const normalized = normalizeSearchText(query);

    if (!normalized) {
      return [];
    }

    const tsQuery = sql`
        websearch_to_tsquery(
          'simple',
          ${normalized}
        )
      `;

    const rank = sql<number>`
        ts_rank_cd(
          to_tsvector(
            'simple',
            ${retrievalChunks.searchText}
          ),
          ${tsQuery}
        )
      `;

    return this.db
      .select({
        chunkId: retrievalChunks.id,

        sessionId: retrievalChunks.sessionId,

        messageId: retrievalChunks.messageId,

        messageSeq: retrievalChunks.messageSeq,

        content: retrievalChunks.content,

        score: rank,
      })
      .from(retrievalChunks)
      .where(
        and(
          options.sessionId ? eq(retrievalChunks.sessionId, options.sessionId) : undefined,

          sql`
            to_tsvector(
              'simple',
              ${retrievalChunks.searchText}
            )
            @@
            ${tsQuery}
          `,
        ),
      )
      .orderBy(desc(rank))
      .limit(limit);
  }

  async searchTrigram(
    query: string,
    options: RetrievalSearchOptions = {},
  ): Promise<RawSearchHit[]> {
    const limit = options.trigramLimit ?? options.limit ?? 20;

    const normalized = normalizeSearchText(query);

    if (!normalized) {
      return [];
    }

    const similarity = sql<number>`
        similarity(
          ${retrievalChunks.searchText},
          ${normalized}
        )
      `;

    return this.db
      .select({
        chunkId: retrievalChunks.id,
        sessionId: retrievalChunks.sessionId,
        messageId: retrievalChunks.messageId,
        messageSeq: retrievalChunks.messageSeq,
        content: retrievalChunks.content,
        score: similarity,
      })
      .from(retrievalChunks)
      .where(
        and(
          options.sessionId ? eq(retrievalChunks.sessionId, options.sessionId) : undefined,

          /**
           * % 是 pg_trgm similarity operator，
           * 能利用 gin_trgm_ops。
           */
          sql`
            ${retrievalChunks.searchText}
            %
            ${normalized}
          `,
        ),
      )
      .orderBy(desc(similarity))
      .limit(limit);
  }

  async searchVector(query: string, options: RetrievalSearchOptions = {}): Promise<RawSearchHit[]> {
    if (!normalizeSearchText(query)) {
      return [];
    }

    const vector = await this.embeddingIndex.embedQuery(query, options.signal);
    if (!vector) {
      return [];
    }

    // 不能只依赖 WHERE 的执行顺序；CASE 保证不同维数的向量不会计算距离。
    const similarity = sql<number>`
        1 - (
          CASE WHEN ${retrievalEmbeddings.model} = ${vector.model}
            AND ${retrievalEmbeddings.dimensions} = ${vector.dimensions}
            THEN ${cosineDistance(retrievalEmbeddings.embedding, vector.embedding)}
            ELSE NULL END
        )
      `;

    const limit = options.vectorLimit ?? options.limit ?? 20;

    const threshold = options.minVectorSimilarity ?? 0.35;

    return this.db
      .select({
        chunkId: retrievalChunks.id,
        sessionId: retrievalChunks.sessionId,
        messageId: retrievalChunks.messageId,
        messageSeq: retrievalChunks.messageSeq,
        content: retrievalChunks.content,
        score: similarity,
      })
      .from(retrievalEmbeddings)
      .innerJoin(retrievalChunks, eq(retrievalChunks.id, retrievalEmbeddings.chunkId))
      .where(
        and(
          eq(retrievalEmbeddings.model, vector.model),
          eq(retrievalEmbeddings.dimensions, vector.dimensions),

          options.sessionId ? eq(retrievalChunks.sessionId, options.sessionId) : undefined,

          gt(similarity, threshold),
        ),
      )
      .orderBy(desc(similarity))
      .limit(limit);
  }

  /**
   * FTS + trigram + Vector
   *
   * 用 RRF 融合，不直接混合不同 score。
   */
  async search(query: string, options: RetrievalSearchOptions = {}): Promise<SearchHit[]> {
    options.signal?.throwIfAborted();

    const [fts, trigram, vector] = await Promise.all([
      this.searchFullText(query, options),

      this.searchTrigram(query, options),

      this.searchVector(query, options).catch((error) => {
        options.signal?.throwIfAborted();
        this.embeddingIndex.reportIndexError(error);
        return [];
      }),
    ]);

    options.signal?.throwIfAborted();

    const hits = new Map<string, SearchHit>();

    this.mergeRankedHits(hits, fts, "fts", 1);
    this.mergeRankedHits(hits, trigram, "trigram", 0.7);
    this.mergeRankedHits(hits, vector, "vector", 1);

    return this.rankHits(hits.values(), options.limit ?? 10);
  }

  private mergeRankedHits(
    hits: Map<string, SearchHit>,
    rows: RawSearchHit[],
    source: SearchSource,
    weight: number,
  ): void {
    for (const [index, row] of rows.entries()) {
      const score = weight / (60 + index + 1);

      const existing = hits.get(row.chunkId);

      /**
       * 同一 chunk 被多个检索源命中时
       * 累加各来源的 RRF 分数， 并记录命中的检索源
       */
      if (existing) {
        existing.score += score;

        if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }

        continue;
      }

      hits.set(row.chunkId, {
        chunkId: row.chunkId,
        sessionId: row.sessionId,
        messageId: row.messageId,
        messageSeq: row.messageSeq,
        content: row.content,
        score,
        sources: [source],
      });
    }
  }

  private rankHits(hits: Iterable<SearchHit>, limit: number): SearchHit[] {
    const results = [...hits];
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}
