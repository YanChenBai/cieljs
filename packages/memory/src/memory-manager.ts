import { fileURLToPath } from "node:url";

import type { PGlite } from "@electric-sql/pglite";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolveEmbeddingProvider, type ResolvedEmbeddingProvider } from "@cieljs/agent-kit";

import { createDatabase, materializeMemoryEntries, type Database } from "./database.ts";
import { MemoryEmbeddingIndex } from "./embedding-index.ts";
import { Memory, type MemoryOptions, type MemoryServices } from "./memory.ts";
import { MemoryRetrieval } from "./retrieval.ts";
import { memories } from "./schema.ts";
import { tokenizeSearchText } from "./search.ts";
import type {
  CrossScopeMemoryAccess,
  CrossScopeMemorySearchOptions,
  MemoryEntry,
  MemoryManagerOptions,
  MemoryScope,
  MemorySearchHit,
} from "./types.ts";
import { accessCondition } from "./validation.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations/", import.meta.url));

type ResolvedMemoryManagerOptions = Omit<MemoryManagerOptions, "embedding"> & {
  embedding?: ResolvedEmbeddingProvider;
};

export class MemoryManager {
  readonly timeZone: string;

  private readonly embeddingIndex: MemoryEmbeddingIndex;
  private readonly memoryServices: MemoryServices;
  private readonly operations = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly client: PGlite,
    db: Database,
    options: ResolvedMemoryManagerOptions,
  ) {
    this.timeZone = options.timeZone ?? "Asia/Shanghai";
    const tokenize = options.tokenize ?? tokenizeSearchText;
    this.embeddingIndex = new MemoryEmbeddingIndex(db, options.embedding, options.onIndexError);
    const retrieval = new MemoryRetrieval(db, this.embeddingIndex, tokenize);
    this.memoryServices = {
      db,
      embeddingIndex: this.embeddingIndex,
      retrieval,
      timeZone: this.timeZone,
      tokenize,
      operate: this.operate.bind(this),
    };
  }

  static async open(options: MemoryManagerOptions): Promise<MemoryManager> {
    const resolvedOptions: ResolvedMemoryManagerOptions = {
      ...options,
      embedding: resolveEmbeddingProvider(options.embedding),
    };

    new Intl.DateTimeFormat("en", { timeZone: options.timeZone ?? "Asia/Shanghai" });
    const { client, db } = createDatabase(options.dataDir);

    try {
      await client.waitReady;
      await client.exec(
        "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;",
      );
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const manager = new MemoryManager(client, db, resolvedOptions);
      // 任务和正文一起持久化；换模型或上次进程退出后补齐当前模型的任务。
      await manager.embeddingIndex.prepare();
      manager.embeddingIndex.enqueue();

      return manager;
    } catch (error) {
      await client.close();

      throw error;
    }
  }

  memory(scope: MemoryScope, options: MemoryOptions = {}): Memory {
    return Memory.create(this.memoryServices, scope, options);
  }

  get(id: string, options: CrossScopeMemoryAccess): Promise<MemoryEntry | null> {
    return this.operate(() =>
      this.memoryServices.db.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), accessCondition(options)));

        return (await materializeMemoryEntries(transaction, rows))[0] ?? null;
      }),
    );
  }

  searchFullText(
    query: string,
    options: CrossScopeMemorySearchOptions,
  ): Promise<MemorySearchHit[]> {
    return this.operate(() => this.memoryServices.retrieval.searchFullText(query, options));
  }

  searchTrigram(query: string, options: CrossScopeMemorySearchOptions): Promise<MemorySearchHit[]> {
    return this.operate(() => this.memoryServices.retrieval.searchTrigram(query, options));
  }

  searchVector(query: string, options: CrossScopeMemorySearchOptions): Promise<MemorySearchHit[]> {
    return this.operate(() => this.memoryServices.retrieval.searchVector(query, options));
  }

  search(query: string, options: CrossScopeMemorySearchOptions): Promise<MemorySearchHit[]> {
    return this.operate(() => this.memoryServices.retrieval.search(query, options));
  }

  retryEmbeddings(): Promise<void> {
    return this.operate(() => this.embeddingIndex.retry());
  }

  getIndexStatus(): Promise<{ pending: number; ready: number; failed: number }> {
    return this.operate(() => this.embeddingIndex.status());
  }

  flushIndexes(): Promise<void> {
    return this.operate(() => this.embeddingIndex.flush());
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      // 已提交的写操作可能继续排入索引，必须先等业务操作再等索引。
      await Promise.allSettled(this.operations);
      await this.embeddingIndex.flush();
      await this.client.close();
    })();

    return this.closing;
  }

  private operate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(new Error("MemoryManager 已关闭或正在关闭"));
    }

    const result = Promise.resolve().then(operation);
    this.operations.add(result);
    void result.then(
      () => this.operations.delete(result),
      () => this.operations.delete(result),
    );

    return result;
  }
}
