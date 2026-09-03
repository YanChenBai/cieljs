import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector as pgvector } from "@electric-sql/pglite-pgvector";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { and, asc, between, cosineDistance, desc, eq, gt, sql } from "drizzle-orm";

import { drizzle } from "drizzle-orm/pglite";

import { migrate } from "drizzle-orm/pglite/migrator";

import {
  EMBEDDING_DIMENSIONS,
  retrievalChunks,
  retrievalEmbeddings,
  sessionCompactions,
  sessionMessages,
  sessions,
} from "./schema.ts";

import { chunkSearchText, messageToSearchText, normalizeSearchText } from "./search.ts";

import type {
  AppendCompactionInput,
  EmbeddingProvider,
  RawSearchHit,
  SearchHit,
  SearchOptions,
  SessionContext,
  SessionStoreOptions,
} from "./types.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations/", import.meta.url));

function createDatabase(dataDir: string) {
  /**
   * PGlite 必须在启动时加载 WASM extension。
   */
  const client = new PGlite(dataDir, {
    extensions: {
      vector: pgvector,
      pg_trgm,
    },
  });

  const db = drizzle({
    client,
  });

  return {
    client,
    db,
  };
}

type Database = ReturnType<typeof createDatabase>["db"];

export class SessionStore {
  readonly db: Database;

  private readonly client: PGlite;

  private readonly embedding: EmbeddingProvider | undefined;

  private readonly onIndexError: ((error: unknown) => void) | undefined;

  /**
   * Embedding 是派生索引，
   * 用队列保证顺序并允许 close() flush。
   */
  private indexingQueue: Promise<void> = Promise.resolve();

  private constructor(client: PGlite, db: Database, options: SessionStoreOptions) {
    this.client = client;
    this.db = db;

    this.embedding = options.embedding;

    this.onIndexError = options.onIndexError;
  }

  static async open(options: SessionStoreOptions): Promise<SessionStore> {
    if (options.embedding && options.embedding.dimensions !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding dimensions mismatch: expected ${EMBEDDING_DIMENSIONS}, received ${options.embedding.dimensions}`,
      );
    }

    const { client, db } = createDatabase(options.dataDir);

    try {
      await client.waitReady;

      /**
       * Extension 模块必须在 PGlite 构造时加载；
       * CREATE EXTENSION 再真正启用 PostgreSQL extension。
       *
       * IF NOT EXISTS 可以安全重复执行。
       */
      await client.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
      `);

      await migrate(db, {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      return new SessionStore(client, db, options);
    } catch (error) {
      await client.close();

      throw error;
    }
  }

  async createSession(id: string = crypto.randomUUID()) {
    const [row] = await this.db
      .insert(sessions)
      .values({
        id,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create session");
    }

    return row;
  }

  async getSession(sessionId: string) {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);

    return row ?? null;
  }

  async getOrCreateSession(id: string) {
    const [session] = await this.db
      .insert(sessions)
      .values({
        id,
      })
      .onConflictDoNothing({
        target: sessions.id,
      })
      .returning();

    if (session) {
      return session;
    }

    const existing = await this.getSession(id);

    if (!existing) {
      throw new Error(`Failed to get or create session: ${id}`);
    }

    return existing;
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return (await this.getSession(sessionId)) !== null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /**
   * Message + lexical projection 原子写入。
   *
   * Embedding 在事务提交后生成。
   */
  async appendMessage(sessionId: string, message: AgentMessage) {
    const messageId = crypto.randomUUID();

    const searchableText = messageToSearchText(message);

    const projectedChunks = chunkSearchText(searchableText);

    const result = await this.db.transaction(async (tx) => {
      const [counter] = await tx
        .update(sessions)
        .set({
          nextMessageSeq: sql`
                    ${sessions.nextMessageSeq}
                    + 1
                  `,
        })
        .where(eq(sessions.id, sessionId))
        .returning({
          nextMessageSeq: sessions.nextMessageSeq,
        });

      if (!counter) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const seq = counter.nextMessageSeq - 1;

      const [messageRow] = await tx
        .insert(sessionMessages)
        .values({
          id: messageId,
          sessionId,
          seq,
          message,
        })
        .returning();

      if (!messageRow) {
        throw new Error("Failed to append message");
      }

      const chunkRows: Array<typeof retrievalChunks.$inferSelect> = [];

      if (projectedChunks.length) {
        const rows = await tx
          .insert(retrievalChunks)
          .values(
            projectedChunks.map((chunk, chunkIndex) => ({
              id: crypto.randomUUID(),

              sessionId,

              messageId,

              messageSeq: seq,

              chunkIndex,

              content: chunk.content,

              searchText: chunk.searchText,
            })),
          )
          .returning();

        chunkRows.push(...rows);
      }

      return {
        message: messageRow,

        chunks: chunkRows,
      };
    });

    /**
     * Vector indexing 不属于事实写入。
     */
    if (this.embedding && result.chunks.length) {
      this.enqueueEmbedding(
        result.chunks.map((chunk) => ({
          id: chunk.id,

          content: chunk.content,
        })),
      );
    }

    return result.message;
  }

  async getMessages(sessionId: string) {
    return this.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.seq));
  }

  async getMessagesAfter(sessionId: string, afterSeq: number) {
    return this.db
      .select()
      .from(sessionMessages)
      .where(and(eq(sessionMessages.sessionId, sessionId), gt(sessionMessages.seq, afterSeq)))
      .orderBy(asc(sessionMessages.seq));
  }

  async getMessagesRange(sessionId: string, fromSeq: number, toSeq: number) {
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 1) {
      throw new TypeError(`Invalid fromSeq: ${fromSeq}`);
    }

    if (!Number.isSafeInteger(toSeq) || toSeq < fromSeq) {
      throw new TypeError(`Invalid toSeq: ${toSeq}`);
    }

    return this.db
      .select()
      .from(sessionMessages)
      .where(
        and(eq(sessionMessages.sessionId, sessionId), between(sessionMessages.seq, fromSeq, toSeq)),
      )
      .orderBy(asc(sessionMessages.seq));
  }

  async appendCompaction(sessionId: string, input: AppendCompactionInput) {
    if (!Number.isSafeInteger(input.throughSeq) || input.throughSeq < 1) {
      throw new TypeError(`Invalid throughSeq: ${input.throughSeq}`);
    }

    const lastMessage = await this.getLastMessage(sessionId);

    if (!lastMessage) {
      throw new Error("Cannot compact an empty session");
    }

    if (input.throughSeq > lastMessage.seq) {
      throw new Error(`throughSeq ${input.throughSeq} exceeds last message seq ${lastMessage.seq}`);
    }

    const latest = await this.getLatestCompaction(sessionId);

    if (latest && input.throughSeq <= latest.throughSeq) {
      throw new Error(
        `Compaction must advance throughSeq: previous=${latest.throughSeq}, next=${input.throughSeq}`,
      );
    }

    const [row] = await this.db
      .insert(sessionCompactions)
      .values({
        id: crypto.randomUUID(),

        sessionId,

        throughSeq: input.throughSeq,

        summary: input.summary,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to append compaction");
    }

    return row;
  }

  async getLatestCompaction(sessionId: string) {
    const [row] = await this.db
      .select()
      .from(sessionCompactions)
      .where(eq(sessionCompactions.sessionId, sessionId))
      .orderBy(desc(sessionCompactions.throughSeq))
      .limit(1);

    return row ?? null;
  }

  async getLastMessage(sessionId: string) {
    const [row] = await this.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(desc(sessionMessages.seq))
      .limit(1);

    return row ?? null;
  }

  /**
   * 返回完整的当前 Active Context。
   */
  async getContext(sessionId: string): Promise<SessionContext> {
    const compaction = await this.getLatestCompaction(sessionId);

    const rows = compaction
      ? await this.getMessagesAfter(sessionId, compaction.throughSeq)
      : await this.getMessages(sessionId);

    return {
      summary: compaction?.summary ?? null,

      messages: rows.map((row) => row.message),
    };
  }

  /**
   * Compactor 用这个。
   *
   * 和 getContext() 不同：
   * 这里保留 seq。
   */
  async getActiveMessageRows(sessionId: string) {
    const compaction = await this.getLatestCompaction(sessionId);

    return compaction
      ? this.getMessagesAfter(sessionId, compaction.throughSeq)
      : this.getMessages(sessionId);
  }

  async searchFullText(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
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

  async searchTrigram(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
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

  async searchVector(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
    if (!this.embedding) {
      return [];
    }

    const normalized = normalizeSearchText(query);

    if (!normalized) {
      return [];
    }

    const queryEmbedding = await this.embedding.embed(normalized);

    this.assertEmbedding(queryEmbedding);

    const similarity = sql<number>`
        1 - (
          ${cosineDistance(retrievalEmbeddings.embedding, queryEmbedding)}
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
          eq(retrievalEmbeddings.model, this.embedding.model),

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
  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const [fts, trigram, vector] = await Promise.all([
      this.searchFullText(query, options),

      this.searchTrigram(query, options),

      this.searchVector(query, options),
    ]);

    const hits = new Map<string, SearchHit>();

    const add = (rows: RawSearchHit[], source: "fts" | "trigram" | "vector", weight: number) => {
      rows.forEach((row, index) => {
        /**
         * Reciprocal Rank Fusion。
         */
        const score = weight * (1 / (60 + index + 1));

        const existing = hits.get(row.chunkId);

        if (existing) {
          existing.score += score;

          if (!existing.sources.includes(source)) {
            existing.sources.push(source);
          }

          return;
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
      });
    };

    add(fts, "fts", 1);

    add(trigram, "trigram", 0.7);

    add(vector, "vector", 1);

    return [...hits.values()].sort((a, b) => b.score - a.score).slice(0, options.limit ?? 10);
  }

  /**
   * 重建某个 Session 的全文 + Vector 索引。
   *
   * embedding 换模型时可以直接跑。
   */
  async rebuildIndex(sessionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(retrievalChunks).where(eq(retrievalChunks.sessionId, sessionId));

      const messages = await tx
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, sessionId))
        .orderBy(asc(sessionMessages.seq));

      for (const row of messages) {
        const text = messageToSearchText(row.message);

        const chunks = chunkSearchText(text);

        if (!chunks.length) {
          continue;
        }

        await tx.insert(retrievalChunks).values(
          chunks.map((chunk, chunkIndex) => ({
            id: crypto.randomUUID(),

            sessionId,

            messageId: row.id,

            messageSeq: row.seq,

            chunkIndex,

            content: chunk.content,

            searchText: chunk.searchText,
          })),
        );
      }
    });

    if (this.embedding) {
      await this.rebuildEmbeddings(sessionId);
    }
  }

  async rebuildEmbeddings(sessionId?: string): Promise<void> {
    if (!this.embedding) {
      return;
    }

    const chunks = await this.db
      .select()
      .from(retrievalChunks)
      .where(sessionId ? eq(retrievalChunks.sessionId, sessionId) : undefined);

    for (const chunk of chunks) {
      const embedding = await this.embedding.embed(chunk.content);

      this.assertEmbedding(embedding);

      await this.db
        .insert(retrievalEmbeddings)
        .values({
          chunkId: chunk.id,

          model: this.embedding.model,

          embedding,
        })
        .onConflictDoUpdate({
          target: [retrievalEmbeddings.chunkId, retrievalEmbeddings.model],

          set: {
            embedding,

            createdAt: new Date(),
          },
        });
    }
  }

  /**
   * 等待 pending embedding 完成。
   */
  async flushIndexes() {
    await this.indexingQueue;
  }

  async close() {
    await this.flushIndexes();

    await this.client.close();
  }

  private enqueueEmbedding(
    chunks: Array<{
      id: string;
      content: string;
    }>,
  ) {
    if (!this.embedding) {
      return;
    }

    this.indexingQueue = this.indexingQueue
      .then(async () => {
        for (const chunk of chunks) {
          const embedding = await this.embedding!.embed(chunk.content);

          this.assertEmbedding(embedding);

          await this.db
            .insert(retrievalEmbeddings)
            .values({
              chunkId: chunk.id,

              model: this.embedding!.model,

              embedding,
            })
            .onConflictDoUpdate({
              target: [retrievalEmbeddings.chunkId, retrievalEmbeddings.model],

              set: {
                embedding,

                createdAt: new Date(),
              },
            });
        }
      })
      .catch((error) => {
        this.onIndexError?.(error);
      });
  }

  private assertEmbedding(embedding: number[]) {
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Invalid embedding dimensions: expected ${EMBEDDING_DIMENSIONS}, received ${embedding.length}`,
      );
    }
  }
}
