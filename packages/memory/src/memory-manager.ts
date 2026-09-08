import { fileURLToPath } from 'node:url';

import { resolveEmbeddingProvider, type ResolvedEmbeddingProvider } from '@cieljs/agent-kit';
import type { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

import { createDatabase, type Database } from './database.ts';
import { MemoryEmbeddingIndex } from './embedding-index.ts';
import { MemoryClosedError, MemoryValidationError } from './errors.ts';
import {
  createGlobalMemory,
  createSpaceMemory,
  type GlobalLongTermMemory,
  type MemoryStoreServices,
  type SpaceMemory,
} from './memory-store.ts';
import { MemoryRepository } from './repository.ts';
import { MemoryRetrieval } from './retrieval.ts';
import { tokenizeSearchText } from './search.ts';
import type {
  FindMemorySpacesOptions,
  MemoryEntry,
  MemoryIndexStatus,
  MemoryManagerOptions,
  MemoryReadOptions,
  MemorySearchHit,
  MemorySourceSearchHit,
  MemorySourceSearchOptions,
  MemorySpaceSourceHit,
  SearchAllMemoryOptions,
} from './types.ts';
import { integerOption } from './validation.ts';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url));
const ALL_LAYERS = ['global.long_term', 'space.long_term', 'space.daily'] as const;

type ResolvedMemoryManagerOptions = Omit<MemoryManagerOptions, 'embedding'> & {
  embedding?: ResolvedEmbeddingProvider;
};

export class MemoryManager implements AsyncDisposable {
  readonly timeZone: string;
  readonly global: GlobalLongTermMemory;

  private readonly embeddingIndex: MemoryEmbeddingIndex;
  private readonly repository: MemoryRepository;
  private readonly retrieval: MemoryRetrieval;
  private readonly services: MemoryStoreServices;
  private readonly operations = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly client: PGlite,
    db: Database,
    options: ResolvedMemoryManagerOptions,
  ) {
    this.timeZone = options.timeZone ?? 'Asia/Shanghai';
    const tokenize = options.tokenize ?? tokenizeSearchText;
    this.embeddingIndex = new MemoryEmbeddingIndex(db, options.embedding, options.onIndexError);
    this.repository = new MemoryRepository(db, this.embeddingIndex, this.timeZone, tokenize);
    this.retrieval = new MemoryRetrieval(db, this.embeddingIndex, tokenize);
    this.services = {
      repository: this.repository,
      retrieval: this.retrieval,
      operate: this.operate.bind(this),
    };
    this.global = createGlobalMemory(this.services);
  }

  static async open(options: MemoryManagerOptions): Promise<MemoryManager> {
    if (!options.dataDir?.trim()) {
      throw new MemoryValidationError('dataDir 不能为空');
    }

    const timeZone = options.timeZone ?? 'Asia/Shanghai';

    try {
      new Intl.DateTimeFormat('en', { timeZone });
    } catch (error) {
      throw new MemoryValidationError('timeZone 必须是有效的 IANA 时区', { cause: error });
    }

    const resolvedOptions: ResolvedMemoryManagerOptions = {
      ...options,
      timeZone,
      embedding: resolveEmbeddingProvider(options.embedding),
    };
    const { client, db } = createDatabase(options.dataDir);

    try {
      await client.waitReady;
      await client.exec(
        'CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;',
      );
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const manager = new MemoryManager(client, db, resolvedOptions);
      await manager.embeddingIndex.prepare();
      manager.embeddingIndex.enqueue();

      return manager;
    } catch (error) {
      await client.close();

      throw error;
    }
  }

  space(spaceId: string): SpaceMemory {
    this.assertOpen();

    if (!spaceId?.trim()) {
      throw new MemoryValidationError('spaceId 不能为空');
    }

    return createSpaceMemory(this.services, spaceId);
  }

  getAny(id: string, options?: MemoryReadOptions): Promise<MemoryEntry | null> {
    return this.operate(() => this.repository.get({ layers: [...ALL_LAYERS] }, id, options));
  }

  searchAll(query: string, options: SearchAllMemoryOptions = {}): Promise<MemorySearchHit[]> {
    const { layers = [...ALL_LAYERS], ...searchOptions } = options;

    return this.operate(() => this.retrieval.search({ layers }, query, searchOptions));
  }

  searchBySource(
    query: string,
    options: MemorySourceSearchOptions = {},
  ): Promise<MemorySourceSearchHit[]> {
    const { layers = [...ALL_LAYERS], ...searchOptions } = options;

    return this.operate(() => this.retrieval.searchBySource({ layers }, query, searchOptions));
  }

  async findSpacesBySource(
    query: string,
    options: FindMemorySpacesOptions = {},
  ): Promise<MemorySpaceSourceHit[]> {
    const limit = integerOption(options.limit ?? 10, 'limit');
    const hits = await this.searchBySource(query, {
      mode: options.mode,
      layers: options.layers ?? ['space.long_term', 'space.daily'],
      limit: 1000,
      signal: options.signal,
    });
    const spaces = new Map<string, MemorySpaceSourceHit>();

    for (const hit of hits) {
      if (!hit.spaceId) {
        continue;
      }

      const existing = spaces.get(hit.spaceId);

      if (existing) {
        existing.score = Math.max(existing.score, hit.score);
        existing.matchedSources = [...new Set([...existing.matchedSources, ...hit.matchedSources])];
        existing.memories.push({
          id: hit.memoryId,
          revision: hit.revision,
          layer: hit.layer as 'space.long_term' | 'space.daily',
          excerpt: hit.excerpt,
        });
      } else {
        spaces.set(hit.spaceId, {
          spaceId: hit.spaceId,
          score: hit.score,
          matchedSources: [...hit.matchedSources],
          memories: [
            {
              id: hit.memoryId,
              revision: hit.revision,
              layer: hit.layer as 'space.long_term' | 'space.daily',
              excerpt: hit.excerpt,
            },
          ],
        });
      }
    }

    return [...spaces.values()]
      .sort((left, right) => right.score - left.score || left.spaceId.localeCompare(right.spaceId))
      .slice(0, limit);
  }

  getIndexStatus(): Promise<MemoryIndexStatus> {
    return this.operate(() => this.embeddingIndex.status());
  }

  flushIndexes(): Promise<void> {
    return this.operate(() => this.embeddingIndex.flush());
  }

  retryIndexes(): Promise<void> {
    return this.operate(() => this.embeddingIndex.retry());
  }

  rebuildIndexes(): Promise<void> {
    return this.operate(async () => {
      await this.repository.rebuildChunks();
      await this.embeddingIndex.rebuild();
    });
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.allSettled(this.operations);
      await this.embeddingIndex.flush();
      await this.client.close();
    })();

    return this.closing;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  private assertOpen(): void {
    if (this.closing) {
      throw new MemoryClosedError();
    }
  }

  private operate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) {
      return Promise.reject(new MemoryClosedError());
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
