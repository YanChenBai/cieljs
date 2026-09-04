import { fileURLToPath } from "node:url";

import type { PGlite } from "@electric-sql/pglite";

import { migrate } from "drizzle-orm/pglite/migrator";
import { resolveEmbeddingProvider, type ResolvedEmbeddingProvider } from "@cieljs/agent-kit";
import { eq } from "drizzle-orm";

import { createDatabase, type Database } from "./database.ts";
import { EmbeddingIndex } from "./embedding-index.ts";
import { SessionRetrieval } from "./retrieval.ts";
import { sessionMessages } from "./schema.ts";
import { Session, type SessionServices } from "./session.ts";

import type { RawSearchHit, SearchHit, SearchOptions, SessionManagerOptions } from "./types.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations/", import.meta.url));

type ResolvedSessionManagerOptions = Omit<SessionManagerOptions, "embedding"> & {
  embedding?: ResolvedEmbeddingProvider;
};

export class SessionManager {
  readonly db: Database;

  private readonly client: PGlite;
  private readonly embeddingIndex: EmbeddingIndex;
  private readonly retrieval: SessionRetrieval;
  private readonly compactions = new Map<string, Promise<void>>();
  private readonly sessionServices: SessionServices;

  private constructor(client: PGlite, db: Database, options: ResolvedSessionManagerOptions) {
    this.client = client;
    this.db = db;
    this.embeddingIndex = new EmbeddingIndex(db, options);
    this.retrieval = new SessionRetrieval(db, this.embeddingIndex);
    this.sessionServices = {
      db,
      embeddingIndex: this.embeddingIndex,
      retrieval: this.retrieval,
      compactions: this.compactions,
    };
  }

  static async open(options: SessionManagerOptions): Promise<SessionManager> {
    const resolvedOptions: ResolvedSessionManagerOptions = {
      ...options,
      embedding: resolveEmbeddingProvider(options.embedding),
    };
    const { client, db } = createDatabase(options.dataDir);

    try {
      await client.waitReady;

      // Extension 模块在 PGlite 构造时加载，这里启用对应的 PostgreSQL extension。
      await client.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE EXTENSION IF NOT EXISTS pg_trgm;
      `);

      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

      return new SessionManager(client, db, resolvedOptions);
    } catch (error) {
      await client.close();

      throw error;
    }
  }

  async session(id: string = crypto.randomUUID()): Promise<Session> {
    return Session.open(this.sessionServices, id);
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

  async getMessage(messageId: string) {
    const [row] = await this.db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.id, messageId))
      .limit(1);

    return row ?? null;
  }

  async rebuildEmbeddings(): Promise<void> {
    await this.embeddingIndex.rebuild();
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
