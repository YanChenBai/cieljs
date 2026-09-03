import { fileURLToPath } from "node:url";

import type { PGlite } from "@electric-sql/pglite";

import { and, asc, between, desc, eq, gt, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { retrievalChunks, sessionCompactions, sessionMessages, sessions } from "./schema.ts";

import { chunkSearchText, messageToSearchText } from "./search.ts";
import { getCompactionBoundary } from "./compaction.ts";
import { createDatabase, type Database } from "./database.ts";
import { EmbeddingIndex, validateEmbeddingProvider } from "./embedding-index.ts";
import { SessionRetrieval } from "./retrieval.ts";

import type {
  AppendCompactionInput,
  CompactionOptions,
  RawSearchHit,
  SearchHit,
  SearchOptions,
  SessionContext,
  SessionStoreOptions,
} from "./types.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations/", import.meta.url));

export class SessionStore {
  readonly db: Database;

  private readonly client: PGlite;

  private readonly embeddingIndex: EmbeddingIndex;

  private readonly retrieval: SessionRetrieval;

  private readonly compactions = new Map<string, Promise<void>>();

  private constructor(client: PGlite, db: Database, options: SessionStoreOptions) {
    this.client = client;
    this.db = db;

    this.embeddingIndex = new EmbeddingIndex(db, options);
    this.retrieval = new SessionRetrieval(db, this.embeddingIndex);
  }

  static async open(options: SessionStoreOptions): Promise<SessionStore> {
    validateEmbeddingProvider(options.embedding);

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
    await this.flushIndexes();
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
    if (result.chunks.length) {
      this.embeddingIndex.enqueue(
        result.chunks.map((chunk) => ({
          id: chunk.id,

          content: chunk.content,
        })),
      );
    }

    return result.message;
  }

  async getMessages(sessionId: string) {
    return this.getMessagesAfter(sessionId, 0);
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
    if (!input.summary.trim()) {
      throw new TypeError("压缩摘要不能为空");
    }
    if (!Number.isSafeInteger(input.throughSeq) || input.throughSeq < 1) {
      throw new TypeError(`Invalid throughSeq: ${input.throughSeq}`);
    }

    return this.db.transaction(async (tx) => {
      // 锁住会话行，使边界校验与摘要写入保持原子性。
      const [session] = await tx
        .update(sessions)
        .set({ nextMessageSeq: sql`${sessions.nextMessageSeq}` })
        .where(eq(sessions.id, sessionId))
        .returning({ nextMessageSeq: sessions.nextMessageSeq });

      if (!session || session.nextMessageSeq === 1) {
        throw new Error("Cannot compact an empty session");
      }

      if (input.throughSeq >= session.nextMessageSeq) {
        throw new Error(
          `throughSeq ${input.throughSeq} exceeds last message seq ${session.nextMessageSeq - 1}`,
        );
      }

      const [latest] = await tx
        .select()
        .from(sessionCompactions)
        .where(eq(sessionCompactions.sessionId, sessionId))
        .orderBy(desc(sessionCompactions.throughSeq))
        .limit(1);

      if (
        input.expectedThroughSeq !== undefined &&
        input.expectedThroughSeq !== (latest?.throughSeq ?? 0)
      ) {
        throw new Error("压缩期间摘要已更新，请基于最新摘要重试");
      }

      if (latest && input.throughSeq <= latest.throughSeq) {
        throw new Error(
          `Compaction must advance throughSeq: previous=${latest.throughSeq}, next=${input.throughSeq}`,
        );
      }

      const [row] = await tx
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
    });
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

  /** 返回尚未压缩的消息行，供需要消息序号的历史检查工具使用。 */
  async getActiveMessageRows(sessionId: string) {
    const compaction = await this.getLatestCompaction(sessionId);

    return compaction
      ? this.getMessagesAfter(sessionId, compaction.throughSeq)
      : this.getMessages(sessionId);
  }

  /** 压缩旧消息并保存累计摘要；原始消息与检索索引保持完整。 */
  async compactSession(sessionId: string, options: CompactionOptions) {
    const previous = this.compactions.get(sessionId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      options.signal?.throwIfAborted();
      const latest = await this.getLatestCompaction(sessionId);
      const rows = await this.getMessagesAfter(sessionId, latest?.throughSeq ?? 0);
      // 保留的旧消息可能携带压缩前的用量，只信任摘要写入后产生的用量。
      const usageStartIndex = latest
        ? rows.findIndex((row) => row.createdAt.getTime() > latest.createdAt.getTime())
        : 0;
      const boundary = getCompactionBoundary(
        { summary: latest?.summary ?? null, messages: rows.map((row) => row.message) },
        options,
        usageStartIndex < 0 ? rows.length : usageStartIndex,
      );

      if (!boundary) {
        return null;
      }

      const summary = await options.summarize({
        sessionId,
        summary: latest?.summary ?? null,
        messages: rows.slice(0, boundary).map((row) => row.message),
        signal: options.signal,
      });

      options.signal?.throwIfAborted();

      return this.appendCompaction(sessionId, {
        summary: summary.trim(),
        throughSeq: rows[boundary - 1]!.seq,
        expectedThroughSeq: latest?.throughSeq ?? 0,
      });
    });

    // 后续请求继续串行执行；本次错误仍由调用方收到。
    const settled = operation.then(
      () => {},
      () => {},
    );
    this.compactions.set(sessionId, settled);
    try {
      return await operation;
    } finally {
      if (this.compactions.get(sessionId) === settled) {
        this.compactions.delete(sessionId);
      }
    }
  }

  async searchFullText(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
    return this.retrieval.searchFullText(query, options);
  }

  async searchTrigram(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
    return this.retrieval.searchTrigram(query, options);
  }

  async searchVector(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
    return this.retrieval.searchVector(query, options);
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    return this.retrieval.search(query, options);
  }

  /**
   * 重建某个 Session 的全文 + Vector 索引。
   *
   * embedding 换模型时可以直接跑。
   */
  async rebuildIndex(sessionId: string): Promise<void> {
    await this.flushIndexes();
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

    await this.rebuildEmbeddings(sessionId);
  }

  async rebuildEmbeddings(sessionId?: string): Promise<void> {
    await this.embeddingIndex.rebuild(sessionId);
  }

  /** 等待已排队的向量索引任务结束。 */
  async flushIndexes(): Promise<void> {
    await this.embeddingIndex.flush();
  }

  async close(): Promise<void> {
    await Promise.all(this.compactions.values());
    await this.flushIndexes();
    await this.client.close();
  }
}
