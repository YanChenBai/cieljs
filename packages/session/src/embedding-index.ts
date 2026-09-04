import { eq, sql } from "drizzle-orm";
import { assertEmbeddingVectors, type ResolvedEmbeddingProvider } from "@cieljs/agent-kit";

import type { Database } from "./database.ts";
import { retrievalChunks, retrievalEmbeddings } from "./schema.ts";
import type { Chunk } from "./types.ts";

export class EmbeddingIndex {
  private readonly db: Database;
  private readonly embedding: ResolvedEmbeddingProvider | undefined;
  private readonly onIndexError: ((error: unknown) => void) | undefined;

  /** 向量是派生索引；队列保证顺序，并允许关闭数据库前等待索引完成 */
  private indexingQueue: Promise<void> = Promise.resolve();

  constructor(
    db: Database,
    options: {
      embedding?: ResolvedEmbeddingProvider;
      onIndexError?: (error: unknown) => void;
    },
  ) {
    this.db = db;
    this.embedding = options.embedding;
    this.onIndexError = options.onIndexError;
  }

  async embedQuery(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ model: string; dimensions: number; embedding: number[] } | null> {
    const provider = this.embedding;
    if (!provider) {
      return null;
    }

    signal?.throwIfAborted();
    const embedding = await provider.embed(query, { purpose: "query", signal });
    signal?.throwIfAborted();

    return { model: provider.model, dimensions: provider.dimensions, embedding };
  }

  async rebuild(sessionId?: string): Promise<void> {
    await this.flush();
    if (!this.embedding) {
      return;
    }

    const chunks = await this.db
      .select({ id: retrievalChunks.id, content: retrievalChunks.content })
      .from(retrievalChunks)
      .where(sessionId ? eq(retrievalChunks.sessionId, sessionId) : undefined);

    const operation = this.indexingQueue.then(() => this.indexChunks(chunks));
    this.indexingQueue = operation.then(
      () => {},
      () => {},
    );
    await operation;
  }

  enqueue(chunks: Chunk[]): void {
    if (!this.embedding || !chunks.length) {
      return;
    }

    this.indexingQueue = this.indexingQueue
      .then(() => this.indexChunks(chunks))
      .catch((error) => this.reportIndexError(error));
  }

  /** 等待已排队的向量索引任务结束 */
  async flush(): Promise<void> {
    await this.indexingQueue;
  }

  private async indexChunks(chunks: Chunk[]): Promise<void> {
    const provider = this.embedding;
    if (!provider) {
      return;
    }

    const batchSize = provider.batchSize ?? 32;

    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      const texts = batch.map((chunk) => chunk.content);
      const options = { purpose: "document" } as const;
      const embeddings = await provider.embedBatch(texts, options);

      assertEmbeddingVectors(embeddings, batch.length, provider.dimensions);

      const values = batch.map((chunk, index) => ({
        chunkId: chunk.id,
        model: provider.model,
        dimensions: provider.dimensions,
        embedding: embeddings[index]!,
      }));

      await this.db
        .insert(retrievalEmbeddings)
        .values(values)
        .onConflictDoUpdate({
          target: [
            retrievalEmbeddings.chunkId,
            retrievalEmbeddings.model,
            retrievalEmbeddings.dimensions,
          ],
          set: {
            embedding: sql`excluded.embedding`,
            createdAt: new Date(),
          },
        });
    }
  }

  reportIndexError(error: unknown): void {
    if (!this.onIndexError) {
      console.warn("[session] 向量检索或索引失败，全文检索仍可用", error);
      return;
    }

    try {
      this.onIndexError(error);
    } catch (callbackError) {
      console.warn("[session] 索引错误回调执行失败", callbackError, error);
    }
  }
}
