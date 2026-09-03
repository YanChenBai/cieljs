import { eq, sql } from "drizzle-orm";

import type { Database } from "./database.ts";
import { retrievalChunks, retrievalEmbeddings } from "./schema.ts";
import type { EmbeddingProvider, SessionStoreOptions } from "./types.ts";

export function validateEmbeddingProvider(provider: EmbeddingProvider | undefined): void {
  if (!provider) {
    return;
  }

  const { model, dimensions, batchSize = 32 } = provider;
  if (!model.trim() || !Number.isSafeInteger(dimensions) || dimensions < 1 || dimensions > 16000) {
    throw new TypeError("Embedding 模型名不能为空，维数必须是 1 到 16000 的整数");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new TypeError("Embedding batchSize 必须是正整数");
  }
}

export class EmbeddingIndex {
  private readonly db: Database;
  private readonly embedding: EmbeddingProvider | undefined;
  private readonly onIndexError: ((error: unknown) => void) | undefined;

  /** 向量是派生索引；队列保证顺序，并允许关闭数据库前等待索引完成。 */
  private indexingQueue: Promise<void> = Promise.resolve();

  constructor(db: Database, options: Pick<SessionStoreOptions, "embedding" | "onIndexError">) {
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
    const embeddings = await provider.embedBatch([query], { purpose: "query", signal });
    signal?.throwIfAborted();

    if (embeddings.length !== 1) {
      throw new Error("查询向量数量必须为 1");
    }
    const embedding = embeddings[0]!;
    this.assertEmbedding(embedding);

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

  /** 等待已排队的向量索引任务结束。 */
  async flush(): Promise<void> {
    await this.indexingQueue;
  }

  enqueue(chunks: Array<{ id: string; content: string }>): void {
    if (!this.embedding || !chunks.length) {
      return;
    }

    this.indexingQueue = this.indexingQueue
      .then(() => this.indexChunks(chunks))
      .catch((error) => this.reportIndexError(error));
  }

  private async indexChunks(chunks: Array<{ id: string; content: string }>): Promise<void> {
    const provider = this.embedding;
    if (!provider) {
      return;
    }

    const batchSize = provider.batchSize ?? 32;
    for (let offset = 0; offset < chunks.length; offset += batchSize) {
      const batch = chunks.slice(offset, offset + batchSize);
      const texts = batch.map((chunk) => chunk.content);
      const options = { purpose: "document" as const };
      const embeddings = await provider.embedBatch(texts, options);

      if (embeddings.length !== batch.length) {
        throw new Error("批量向量数量与输入文本数量不一致");
      }
      for (const embedding of embeddings) {
        this.assertEmbedding(embedding);
      }

      await this.db
        .insert(retrievalEmbeddings)
        .values(
          batch.map((chunk, index) => ({
            chunkId: chunk.id,
            model: provider.model,
            dimensions: provider.dimensions,
            embedding: embeddings[index]!,
          })),
        )
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

  private assertEmbedding(embedding: number[]): void {
    if (
      embedding.length !== this.embedding?.dimensions ||
      !embedding.every(Number.isFinite) ||
      !embedding.some((value) => value !== 0)
    ) {
      throw new Error("向量必须匹配模型维数、仅包含有限数值且不能为零向量");
    }
  }
}
