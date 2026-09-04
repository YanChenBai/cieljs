import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { and, asc, between, desc, eq, gt, sql } from "drizzle-orm";

import { findCompactionBoundary } from "./compaction.ts";
import type { Database } from "./database.ts";
import type { EmbeddingIndex } from "./embedding-index.ts";
import type { SessionRetrieval } from "./retrieval.ts";
import { retrievalChunks, sessionCompactions, sessionMessages, sessions } from "./schema.ts";
import { chunkSearchText, messageToSearchText } from "./search.ts";

import type {
  AppendCompactionInput,
  CompactionOptions,
  RawSearchHit,
  SearchHit,
  SearchOptions,
} from "./types.ts";

export interface SessionServices {
  db: Database;
  embeddingIndex: EmbeddingIndex;
  retrieval: SessionRetrieval;
  compactions: Map<string, Promise<void>>;
}

export class Session {
  private constructor(
    private readonly services: SessionServices,
    readonly id: string,
  ) {}

  static async open(services: SessionServices, id: string): Promise<Session> {
    await services.db.insert(sessions).values({ id }).onConflictDoNothing({ target: sessions.id });

    return new Session(services, id);
  }

  async exists(): Promise<boolean> {
    const [row] = await this.services.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, this.id))
      .limit(1);

    return row !== undefined;
  }

  async delete(): Promise<void> {
    await this.services.embeddingIndex.flush();
    await this.services.db.delete(sessions).where(eq(sessions.id, this.id));
  }

  async appendMessage(message: AgentMessage) {
    const messageId = crypto.randomUUID();
    const searchableText = messageToSearchText(message);
    const projectedChunks = chunkSearchText(searchableText);

    const result = await this.services.db.transaction(async (transaction) => {
      const [counter] = await transaction
        .update(sessions)
        .set({ nextMessageSeq: sql`${sessions.nextMessageSeq} + 1` })
        .where(eq(sessions.id, this.id))
        .returning({ nextMessageSeq: sessions.nextMessageSeq });

      if (!counter) {
        throw new Error(`Session not found: ${this.id}`);
      }

      const seq = counter.nextMessageSeq - 1;
      const [messageRow] = await transaction
        .insert(sessionMessages)
        .values({ id: messageId, sessionId: this.id, seq, message })
        .returning();

      if (!messageRow) {
        throw new Error("Failed to append message");
      }

      if (!projectedChunks.length) {
        return { message: messageRow, chunks: [] };
      }

      const chunks = await transaction
        .insert(retrievalChunks)
        .values(
          projectedChunks.map((chunk, chunkIndex) => ({
            id: crypto.randomUUID(),
            sessionId: this.id,
            messageId,
            messageSeq: seq,
            chunkIndex,
            content: chunk.content,
            searchText: chunk.searchText,
          })),
        )
        .returning();

      return { message: messageRow, chunks };
    });

    // 向量索引是可重建的派生数据，不参与消息与文本投影的事实写入事务。
    if (result.chunks.length) {
      this.services.embeddingIndex.enqueue(
        result.chunks.map((chunk) => ({ id: chunk.id, content: chunk.content })),
      );
    }

    return result.message;
  }

  async getMessages() {
    return this.getMessagesAfter(0);
  }

  async getMessagesAfter(afterSeq: number) {
    return this.services.db
      .select()
      .from(sessionMessages)
      .where(and(eq(sessionMessages.sessionId, this.id), gt(sessionMessages.seq, afterSeq)))
      .orderBy(asc(sessionMessages.seq));
  }

  async getMessagesRange(fromSeq: number, toSeq: number) {
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 1) {
      throw new TypeError(`Invalid fromSeq: ${fromSeq}`);
    }

    if (!Number.isSafeInteger(toSeq) || toSeq < fromSeq) {
      throw new TypeError(`Invalid toSeq: ${toSeq}`);
    }

    return this.services.db
      .select()
      .from(sessionMessages)
      .where(
        and(eq(sessionMessages.sessionId, this.id), between(sessionMessages.seq, fromSeq, toSeq)),
      )
      .orderBy(asc(sessionMessages.seq));
  }

  async getMessage(messageId: string) {
    const [row] = await this.services.db
      .select()
      .from(sessionMessages)
      .where(and(eq(sessionMessages.id, messageId), eq(sessionMessages.sessionId, this.id)))
      .limit(1);

    return row ?? null;
  }

  async appendCompaction(input: AppendCompactionInput) {
    if (!input.summary.trim()) {
      throw new TypeError("压缩摘要不能为空");
    }

    if (!Number.isSafeInteger(input.throughSeq) || input.throughSeq < 1) {
      throw new TypeError(`Invalid throughSeq: ${input.throughSeq}`);
    }

    return this.services.db.transaction(async (transaction) => {
      // 锁住会话行，使边界校验与摘要写入保持原子性。
      const [session] = await transaction
        .update(sessions)
        .set({ nextMessageSeq: sql`${sessions.nextMessageSeq}` })
        .where(eq(sessions.id, this.id))
        .returning({ nextMessageSeq: sessions.nextMessageSeq });

      if (!session || session.nextMessageSeq === 1) {
        throw new Error("Cannot compact an empty session");
      }

      if (input.throughSeq >= session.nextMessageSeq) {
        throw new Error(
          `throughSeq ${input.throughSeq} exceeds last message seq ${session.nextMessageSeq - 1}`,
        );
      }

      const [latest] = await transaction
        .select()
        .from(sessionCompactions)
        .where(eq(sessionCompactions.sessionId, this.id))
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

      const [row] = await transaction
        .insert(sessionCompactions)
        .values({
          id: crypto.randomUUID(),
          sessionId: this.id,
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

  async getLatestCompaction() {
    const [row] = await this.services.db
      .select()
      .from(sessionCompactions)
      .where(eq(sessionCompactions.sessionId, this.id))
      .orderBy(desc(sessionCompactions.throughSeq))
      .limit(1);

    return row ?? null;
  }

  async getLastMessage() {
    const [row] = await this.services.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, this.id))
      .orderBy(desc(sessionMessages.seq))
      .limit(1);

    return row ?? null;
  }

  async context(): Promise<AgentMessage[]> {
    const compaction = await this.getLatestCompaction();
    const rows = compaction
      ? await this.getMessagesAfter(compaction.throughSeq)
      : await this.getMessages();
    const messages = rows.map((row) => row.message);

    if (!compaction) {
      return messages;
    }

    return [createSummaryMessage(compaction.summary, compaction.createdAt.getTime()), ...messages];
  }

  /** 返回尚未压缩的消息行，供需要消息序号的历史检查工具使用。 */
  async getActiveMessageRows() {
    const compaction = await this.getLatestCompaction();

    return compaction ? this.getMessagesAfter(compaction.throughSeq) : this.getMessages();
  }

  /** 压缩旧消息并保存累计摘要；原始消息与检索索引保持完整。 */
  async compact(options: CompactionOptions) {
    const previous = this.services.compactions.get(this.id) ?? Promise.resolve();
    const operation = previous.then(async () => {
      options.signal?.throwIfAborted();

      const latest = await this.getLatestCompaction();
      const rows = await this.getMessagesAfter(latest?.throughSeq ?? 0);
      // 保留的旧消息可能携带压缩前的用量，只信任摘要写入后产生的用量。
      const usageStartIndex = latest
        ? rows.findIndex((row) => row.createdAt.getTime() > latest.createdAt.getTime())
        : 0;
      const boundary = findCompactionBoundary(
        { summary: latest?.summary ?? null, messages: rows.map((row) => row.message) },
        options,
        usageStartIndex < 0 ? rows.length : usageStartIndex,
      );

      if (!boundary) {
        return null;
      }

      const summary = await options.summarize({
        sessionId: this.id,
        summary: latest?.summary ?? null,
        messages: rows.slice(0, boundary).map((row) => row.message),
        signal: options.signal,
      });

      options.signal?.throwIfAborted();

      return this.appendCompaction({
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
    this.services.compactions.set(this.id, settled);

    try {
      return await operation;
    } finally {
      if (this.services.compactions.get(this.id) === settled) {
        this.services.compactions.delete(this.id);
      }
    }
  }

  async searchFullText(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
    return this.services.retrieval.searchFullText(query, { ...options, sessionId: this.id });
  }

  async searchTrigram(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
    return this.services.retrieval.searchTrigram(query, { ...options, sessionId: this.id });
  }

  async searchVector(query: string, options: SearchOptions = {}): Promise<RawSearchHit[]> {
    return this.services.retrieval.searchVector(query, { ...options, sessionId: this.id });
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    return this.services.retrieval.search(query, { ...options, sessionId: this.id });
  }

  /** 重建当前 Session 的文本与向量索引。 */
  async rebuildIndex(): Promise<void> {
    await this.services.embeddingIndex.flush();
    await this.services.db.transaction(async (transaction) => {
      await transaction.delete(retrievalChunks).where(eq(retrievalChunks.sessionId, this.id));

      const messages = await transaction
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, this.id))
        .orderBy(asc(sessionMessages.seq));

      for (const row of messages) {
        const chunks = chunkSearchText(messageToSearchText(row.message));

        if (!chunks.length) {
          continue;
        }

        await transaction.insert(retrievalChunks).values(
          chunks.map((chunk, chunkIndex) => ({
            id: crypto.randomUUID(),
            sessionId: this.id,
            messageId: row.id,
            messageSeq: row.seq,
            chunkIndex,
            content: chunk.content,
            searchText: chunk.searchText,
          })),
        );
      }
    });

    await this.rebuildEmbeddings();
  }

  async rebuildEmbeddings(): Promise<void> {
    await this.services.embeddingIndex.rebuild(this.id);
  }
}

function createSummaryMessage(summary: string, timestamp: number): AgentMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: [
          "<session_summary>",
          "以下内容是此前会话历史的压缩摘要。",
          "它代表更早的对话历史，应作为已有上下文使用，而不是新的用户请求。",
          "",
          summary,
          "</session_summary>",
        ].join("\n"),
      },
    ],
    timestamp,
  };
}
