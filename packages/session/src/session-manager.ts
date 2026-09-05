import { fileURLToPath } from "node:url";

import type { PGlite } from "@electric-sql/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolveEmbeddingProvider, type ResolvedEmbeddingProvider } from "@cieljs/agent-kit";

import { createDatabase, type Database } from "./database.ts";
import { EmbeddingIndex } from "./embedding-index.ts";
import { SessionClosedError, SessionValidationError } from "./errors.ts";
import { SessionRepository } from "./repository.ts";
import { SessionRetrieval } from "./retrieval.ts";
import { tokenizeSearchText } from "./search.ts";
import { Session, type SessionServices } from "./session.ts";
import { createSessionSpace, type SessionSpace } from "./session-space.ts";
import type {
  FindSessionsBySourceOptions,
  SearchAllSessionsOptions,
  SessionIndexStatus,
  SessionInfo,
  SessionListOptions,
  SessionManagerOptions,
  SessionSearchHit,
  SessionSourceHit,
} from "./types.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations/", import.meta.url));

type ResolvedSessionManagerOptions = Omit<SessionManagerOptions, "embedding"> & {
  embedding?: ResolvedEmbeddingProvider;
};

export class SessionManager implements AsyncDisposable {
  private readonly embeddingIndex: EmbeddingIndex;
  private readonly repository: SessionRepository;
  private readonly retrieval: SessionRetrieval;
  private readonly services: SessionServices;
  private readonly compactions = new Map<string, Promise<void>>();
  private readonly operations = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  private constructor(
    private readonly client: PGlite,
    db: Database,
    options: ResolvedSessionManagerOptions,
  ) {
    const tokenize = options.tokenize ?? tokenizeSearchText;
    this.embeddingIndex = new EmbeddingIndex(db, options.embedding, options.onIndexError);
    this.repository = new SessionRepository(db, this.embeddingIndex, tokenize);
    this.retrieval = new SessionRetrieval(db, this.embeddingIndex, tokenize);
    this.services = {
      repository: this.repository,
      retrieval: this.retrieval,
      embeddingIndex: this.embeddingIndex,
      compactions: this.compactions,
      operate: this.operate.bind(this),
    };
  }

  static async open(options: SessionManagerOptions): Promise<SessionManager> {
    if (!options.dataDir?.trim()) {
      throw new SessionValidationError("dataDir 不能为空");
    }

    const resolvedOptions: ResolvedSessionManagerOptions = {
      ...options,
      embedding: resolveEmbeddingProvider(options.embedding),
    };
    const { client, db } = createDatabase(options.dataDir);

    try {
      await client.waitReady;
      await client.exec(
        "CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_trgm;",
      );
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      const manager = new SessionManager(client, db, resolvedOptions);
      await manager.embeddingIndex.prepare();
      manager.embeddingIndex.enqueue();

      return manager;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  space(spaceId: string): SessionSpace {
    this.assertOpen();

    if (!spaceId?.trim()) {
      throw new SessionValidationError("spaceId 不能为空");
    }

    return createSessionSpace(this.services, spaceId);
  }

  getAnySession(id: string): Promise<Session | null> {
    return this.operate(async () => {
      const info = await this.repository.getInfo({ sessionId: id });
      return info ? new Session(this.services, info.id, info.spaceId) : null;
    });
  }

  list(options: SessionListOptions = {}): Promise<SessionInfo[]> {
    return this.operate(() => this.repository.list({}, options));
  }

  searchAll(query: string, options: SearchAllSessionsOptions = {}): Promise<SessionSearchHit[]> {
    return this.operate(() => this.retrieval.search({}, query, options));
  }

  findSessionsBySource(
    query: string,
    options: FindSessionsBySourceOptions = {},
  ): Promise<SessionSourceHit[]> {
    return this.operate(() => this.retrieval.findBySource({}, query, options));
  }

  getIndexStatus(): Promise<SessionIndexStatus> {
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
      await this.embeddingIndex.flush();
      await this.repository.rebuildChunks();
      await this.embeddingIndex.flush();
    });
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.allSettled(this.operations);
      await Promise.allSettled(this.compactions.values());
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
      throw new SessionClosedError();
    }
  }

  private operate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new SessionClosedError());

    const result = Promise.resolve().then(operation);
    this.operations.add(result);
    void result.then(
      () => this.operations.delete(result),
      () => this.operations.delete(result),
    );
    return result;
  }
}
