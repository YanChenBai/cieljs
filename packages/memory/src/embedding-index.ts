import { assertEmbeddingVectors, type ResolvedEmbeddingProvider } from '@cieljs/model-kit';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Database, Transaction } from './database.ts';
import { memoryChunks, memoryEmbeddings } from './schema.ts';
import type { MemoryIndexStatus } from './types.ts';

export class MemoryEmbeddingIndex {
  private indexing: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly provider: ResolvedEmbeddingProvider | undefined,
    private readonly onIndexError: ((error: unknown) => void) | undefined,
  ) {}

  async prepare(reset = false): Promise<void> {
    if (!this.provider) {
      return;
    }

    await this.db.transaction(async transaction => {
      const rows = await transaction.select({ id: memoryChunks.id }).from(memoryChunks);

      for (let start = 0; start < rows.length; start += 500) {
        const ids = rows.slice(start, start + 500).map(row => row.id);

        await this.addPending(transaction, ids);
        await transaction
          .update(memoryEmbeddings)
          .set({ status: 'pending', embedding: null, error: null })
          .where(
            and(
              this.modelCondition(),
              inArray(memoryEmbeddings.chunkId, ids),
              reset ? undefined : eq(memoryEmbeddings.status, 'failed'),
            ),
          );
      }
    });
  }

  async addPending(transaction: Transaction, chunkIds: string[]): Promise<void> {
    const provider = this.provider;

    if (!provider || !chunkIds.length) {
      return;
    }

    await transaction
      .insert(memoryEmbeddings)
      .values(
        chunkIds.map(chunkId => ({
          chunkId,
          model: provider.model,
          dimensions: provider.dimensions,
        })),
      )
      .onConflictDoNothing();
  }

  enqueue(): void {
    if (!this.provider) {
      return;
    }

    this.indexing = this.indexing
      .then(() => this.indexPending())
      .catch((error: unknown) => this.reportError(error));
  }

  async rebuild(): Promise<void> {
    await this.prepare(true);
    this.enqueue();
  }

  async retry(): Promise<void> {
    await this.prepare();
    this.enqueue();
  }

  async status(): Promise<MemoryIndexStatus> {
    const result: MemoryIndexStatus = { pending: 0, ready: 0, failed: 0 };

    if (!this.provider) {
      return result;
    }

    const rows = await this.db
      .select({ status: memoryEmbeddings.status, count: sql<number>`count(*)::integer` })
      .from(memoryEmbeddings)
      .where(this.modelCondition())
      .groupBy(memoryEmbeddings.status);

    for (const row of rows) {
      result[row.status] = row.count;
    }

    return result;
  }

  async embedQuery(query: string, signal?: AbortSignal): Promise<number[] | null> {
    if (!this.provider) {
      return null;
    }

    const vector = await this.provider.embed(query, { purpose: 'query', signal });
    signal?.throwIfAborted();

    return vector;
  }

  get model() {
    return this.provider
      ? { model: this.provider.model, dimensions: this.provider.dimensions }
      : undefined;
  }

  async flush(): Promise<void> {
    let current: Promise<void>;

    do {
      current = this.indexing;
      await current;
    } while (current !== this.indexing);
  }

  reportError(error: unknown): void {
    try {
      if (this.onIndexError) {
        this.onIndexError(error);
      } else {
        console.warn('[memory] 向量索引或检索失败', error);
      }
    } catch (callbackError) {
      console.warn('[memory] 索引错误回调失败', callbackError);
    }
  }

  private modelCondition() {
    const provider = this.provider!;

    return and(
      eq(memoryEmbeddings.model, provider.model),
      eq(memoryEmbeddings.dimensions, provider.dimensions),
    )!;
  }

  private async indexPending(): Promise<void> {
    const provider = this.provider!;

    while (true) {
      const rows = await this.db
        .select({ id: memoryChunks.id, content: memoryChunks.content })
        .from(memoryEmbeddings)
        .innerJoin(memoryChunks, eq(memoryChunks.id, memoryEmbeddings.chunkId))
        .where(and(this.modelCondition(), eq(memoryEmbeddings.status, 'pending')))
        .orderBy(asc(memoryChunks.id))
        .limit(provider.batchSize);

      if (!rows.length) {
        return;
      }

      try {
        const vectors = await provider.embedBatch(
          rows.map(row => row.content),
          { purpose: 'document' },
        );
        assertEmbeddingVectors(vectors, rows.length, provider.dimensions);

        await this.db.transaction(async transaction => {
          for (const [index, row] of rows.entries()) {
            await transaction
              .update(memoryEmbeddings)
              .set({ embedding: vectors[index]!, status: 'ready', error: null })
              .where(
                and(
                  this.modelCondition(),
                  eq(memoryEmbeddings.chunkId, row.id),
                  eq(memoryEmbeddings.status, 'pending'),
                ),
              );
          }
        });
      } catch (error) {
        await this.db
          .update(memoryEmbeddings)
          .set({
            status: 'failed',
            embedding: null,
            error: error instanceof Error ? error.message : String(error),
          })
          .where(
            and(
              this.modelCondition(),
              inArray(
                memoryEmbeddings.chunkId,
                rows.map(row => row.id),
              ),
              eq(memoryEmbeddings.status, 'pending'),
            ),
          );
        this.reportError(error);
      }
    }
  }
}
