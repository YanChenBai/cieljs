import { assertEmbeddingVectors, type ResolvedEmbeddingProvider } from '@cieljs/model-kit';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Database, Transaction } from './database.ts';
import { retrievalChunks, retrievalEmbeddings } from './schema.ts';
import type { SessionIndexStatus } from './types.ts';

export class EmbeddingIndex {
  private indexing: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly provider: ResolvedEmbeddingProvider | undefined,
    private readonly onIndexError: ((error: unknown) => void) | undefined,
  ) {}

  async prepare(reset = false, sessionId?: string): Promise<void> {
    if (!this.provider) {
      return;
    }

    await this.db.transaction(async transaction => {
      const rows = await transaction
        .select({ id: retrievalChunks.id })
        .from(retrievalChunks)
        .where(sessionId ? eq(retrievalChunks.sessionId, sessionId) : undefined);

      for (let start = 0; start < rows.length; start += 500) {
        const ids = rows.slice(start, start + 500).map(row => row.id);

        await this.addPending(transaction, ids);
        await transaction
          .update(retrievalEmbeddings)
          .set({ status: 'pending', embedding: null, error: null })
          .where(
            and(
              this.modelCondition(),
              inArray(retrievalEmbeddings.chunkId, ids),
              reset ? undefined : eq(retrievalEmbeddings.status, 'failed'),
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
      .insert(retrievalEmbeddings)
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

  async rebuild(sessionId?: string): Promise<void> {
    await this.prepare(true, sessionId);
    this.enqueue();
  }

  async retry(): Promise<void> {
    await this.prepare();
    this.enqueue();
  }

  async status(): Promise<SessionIndexStatus> {
    const result: SessionIndexStatus = { pending: 0, ready: 0, failed: 0 };

    if (!this.provider) {
      return result;
    }

    const rows = await this.db
      .select({ status: retrievalEmbeddings.status, count: sql<number>`count(*)::integer` })
      .from(retrievalEmbeddings)
      .where(this.modelCondition())
      .groupBy(retrievalEmbeddings.status);

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
        console.warn('[session] 向量索引或检索失败', error);
      }
    } catch (callbackError) {
      console.warn('[session] 索引错误回调失败', callbackError);
    }
  }

  private modelCondition() {
    const provider = this.provider!;

    return and(
      eq(retrievalEmbeddings.model, provider.model),
      eq(retrievalEmbeddings.dimensions, provider.dimensions),
    )!;
  }

  private async indexPending(): Promise<void> {
    const provider = this.provider!;

    while (true) {
      const rows = await this.db
        .select({ id: retrievalChunks.id, content: retrievalChunks.content })
        .from(retrievalEmbeddings)
        .innerJoin(retrievalChunks, eq(retrievalChunks.id, retrievalEmbeddings.chunkId))
        .where(and(this.modelCondition(), eq(retrievalEmbeddings.status, 'pending')))
        .orderBy(asc(retrievalChunks.id))
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
              .update(retrievalEmbeddings)
              .set({ embedding: vectors[index]!, status: 'ready', error: null })
              .where(
                and(
                  this.modelCondition(),
                  eq(retrievalEmbeddings.chunkId, row.id),
                  eq(retrievalEmbeddings.status, 'pending'),
                ),
              );
          }
        });
      } catch (error) {
        await this.db
          .update(retrievalEmbeddings)
          .set({
            status: 'failed',
            embedding: null,
            error: error instanceof Error ? error.message : String(error),
          })
          .where(
            and(
              this.modelCondition(),
              inArray(
                retrievalEmbeddings.chunkId,
                rows.map(row => row.id),
              ),
              eq(retrievalEmbeddings.status, 'pending'),
            ),
          );
        this.reportError(error);
      }
    }
  }
}
