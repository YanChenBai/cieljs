import { and, asc, desc, eq, sql } from "drizzle-orm";

import { getMemoryContext, getMemoryScopes } from "./context.ts";
import { materializeMemoryEntries, type Database, type Transaction } from "./database.ts";
import type { MemoryEmbeddingIndex } from "./embedding-index.ts";
import type { MemoryRetrieval } from "./retrieval.ts";
import { memories, memoryChunks, memorySources } from "./schema.ts";
import { chunkText, normalizeSearchText } from "./search.ts";
import type {
  MemoryAccess,
  MemoryContext,
  MemoryContextOptions,
  MemoryEntry,
  MemoryFilter,
  MemoryScope,
  MemorySearchHit,
  MemorySearchOptions,
  MemorySource,
  RememberInput,
  UpdateMemoryInput,
} from "./types.ts";
import {
  accessCondition,
  assertContent,
  assertDate,
  assertKind,
  assertSources,
  assertTimestamp,
  filterCondition,
  integerOption,
  scopeColumns,
  scopeCondition,
} from "./validation.ts";

export interface MemoryServices {
  db: Database;
  embeddingIndex: MemoryEmbeddingIndex;
  retrieval: MemoryRetrieval;
  timeZone: string;
  tokenize: (text: string) => string[];
  operate<T>(operation: () => Promise<T>): Promise<T>;
}

/** 固定读写范围的长期记忆。 */
export class Memory<Scope extends MemoryScope = MemoryScope> {
  readonly scope: Scope;
  private readonly scopes: MemoryScope[];

  private constructor(
    private readonly services: MemoryServices,
    scope: Scope,
  ) {
    this.scope = Object.freeze(structuredClone(scope));
    this.scopes = getMemoryScopes(this.scope).map((item) => Object.freeze(item));
    Object.freeze(this.scopes);
  }

  static create<Scope extends MemoryScope>(services: MemoryServices, scope: Scope): Memory<Scope> {
    return new Memory(services, scope);
  }

  getDate(at = new Date()): string {
    assertTimestamp(at);
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: this.services.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const part = (type: string) => parts.find((item) => item.type === type)!.value;

    return `${part("year")}-${part("month")}-${part("day")}`;
  }

  remember(input: RememberInput): Promise<MemoryEntry> {
    return this.services.operate(async () => {
      assertContent(input.content);
      const scope = scopeColumns(this.scope);
      const occurredAt = input.occurredAt ?? new Date();
      assertTimestamp(occurredAt);
      if (input.expiresAt) assertTimestamp(input.expiresAt);
      const isGlobalLayer = input.layer === "global.long_term";
      const isSpaceLayer = input.layer === "space.long_term" || input.layer === "space.daily";

      if (
        (this.scope.type === "global" && !isGlobalLayer) ||
        (this.scope.type === "space" && !isSpaceLayer)
      ) {
        throw new TypeError("记忆层级与归属不匹配");
      }

      if (input.layer !== "space.daily" && input.date !== undefined)
        throw new TypeError("长期记忆不能设置日期");
      const date = input.layer === "space.daily" ? (input.date ?? this.getDate(occurredAt)) : null;
      if (date !== null) assertDate(date);
      const kind = input.kind ?? (input.layer === "space.daily" ? "event" : "fact");
      assertKind(kind);
      const sources = input.sources ?? [];
      assertSources(sources);

      const result = await this.services.db.transaction(async (transaction) => {
        const [row] = await transaction
          .insert(memories)
          .values({
            id: crypto.randomUUID(),
            ...scope,
            layer: input.layer,
            date,
            kind,
            content: input.content,
            occurredAt,
            expiresAt: input.expiresAt,
            metadata: input.metadata,
          })
          .returning();

        await this.replaceSources(transaction, row!.id, sources);
        await this.replaceChunks(transaction, row!.id, input.content);

        return (await materializeMemoryEntries(transaction, [row!]))[0]!;
      });

      this.services.embeddingIndex.enqueue();

      return result;
    });
  }

  get(id: string, options: MemoryAccess = {}): Promise<MemoryEntry | null> {
    return this.services.operate(() =>
      this.services.db.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(memories)
          .where(and(eq(memories.id, id), accessCondition(this.access(options))));

        return (await materializeMemoryEntries(transaction, rows))[0] ?? null;
      }),
    );
  }

  list(options: MemoryFilter = {}): Promise<MemoryEntry[]> {
    return this.services.operate(() =>
      this.services.db.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(memories)
          .where(filterCondition(this.filter(options)))
          .orderBy(desc(memories.occurredAt), asc(memories.id))
          .limit(integerOption(options.limit ?? 50, "limit"))
          .offset(integerOption(options.offset ?? 0, "offset", 0, Number.MAX_SAFE_INTEGER));

        return materializeMemoryEntries(transaction, rows);
      }),
    );
  }

  update(id: string, input: UpdateMemoryInput): Promise<MemoryEntry> {
    return this.services.operate(async () => {
      integerOption(input.expectedRevision, "expectedRevision", 1, 2147483646);
      if (
        input.content === undefined &&
        input.kind === undefined &&
        input.sources === undefined &&
        input.expiresAt === undefined &&
        input.metadata === undefined
      ) {
        throw new TypeError("至少提供一个要更新的字段");
      }
      if (input.content !== undefined) assertContent(input.content);
      if (input.kind !== undefined) assertKind(input.kind);
      if (input.sources !== undefined) assertSources(input.sources);
      if (input.expiresAt) assertTimestamp(input.expiresAt);

      const memory = await this.services.db.transaction(async (transaction) => {
        const [row] = await transaction
          .update(memories)
          .set({
            content: input.content,
            kind: input.kind,
            expiresAt: input.expiresAt,
            metadata: input.metadata,
            revision: sql`${memories.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(memories.id, id),
              scopeCondition(this.scope),
              eq(memories.status, "active"),
              eq(memories.revision, input.expectedRevision),
            ),
          )
          .returning();

        if (!row) {
          throw new Error("记忆不存在、不可访问或版本已变化");
        }

        if (input.sources !== undefined) {
          await this.replaceSources(transaction, id, input.sources);
        }

        if (input.content !== undefined) {
          await this.replaceChunks(transaction, id, row.content);
        }

        return (await materializeMemoryEntries(transaction, [row]))[0]!;
      });

      this.services.embeddingIndex.enqueue();

      return memory;
    });
  }

  /** 归档后默认读取和检索不再返回；保留正文与来源供管理端查阅。 */
  forget(id: string, options: { expectedRevision: number }): Promise<void> {
    return this.services.operate(async () => {
      integerOption(options.expectedRevision, "expectedRevision", 1, 2147483646);

      await this.services.db.transaction(async (transaction) => {
        const rows = await transaction
          .update(memories)
          .set({
            status: "archived",
            revision: sql`${memories.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(memories.id, id),
              scopeCondition(this.scope),
              eq(memories.revision, options.expectedRevision),
              eq(memories.status, "active"),
            ),
          )
          .returning();

        if (!rows.length) {
          throw new Error("记忆不存在、不可访问或版本已变化");
        }

        await transaction.delete(memoryChunks).where(eq(memoryChunks.memoryId, id));
      });
    });
  }

  searchFullText(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchHit[]> {
    return this.services.operate(() =>
      this.services.retrieval.searchFullText(query, this.searchOptions(options)),
    );
  }

  searchTrigram(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchHit[]> {
    return this.services.operate(() =>
      this.services.retrieval.searchTrigram(query, this.searchOptions(options)),
    );
  }

  searchVector(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchHit[]> {
    return this.services.operate(() =>
      this.services.retrieval.searchVector(query, this.searchOptions(options)),
    );
  }

  search(query: string, options: MemorySearchOptions = {}): Promise<MemorySearchHit[]> {
    return this.services.operate(() =>
      this.services.retrieval.search(query, this.searchOptions(options)),
    );
  }

  context(options: MemoryContextOptions = {}): Promise<MemoryContext> {
    return getMemoryContext(this, options);
  }

  rebuildIndex(): Promise<void> {
    return this.services.operate(async () => {
      await this.services.db.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(memories)
          .where(accessCondition(this.access()));

        for (const row of rows) {
          if (row.status === "active") {
            await this.replaceChunks(transaction, row.id, row.content);
          }
        }
      });

      this.services.embeddingIndex.enqueue();
    });
  }

  rebuildEmbeddings(): Promise<void> {
    return this.services.operate(() =>
      this.services.embeddingIndex.rebuild({ scopes: this.scopes }),
    );
  }

  private access(options: MemoryAccess = {}) {
    return { ...options, scopes: this.scopes };
  }

  private filter(options: MemoryFilter) {
    return { ...options, scopes: this.scopes };
  }

  private searchOptions(options: MemorySearchOptions) {
    return { ...options, scopes: this.scopes };
  }

  private async replaceSources(
    transaction: Transaction,
    id: string,
    sources: MemorySource[],
  ): Promise<void> {
    await transaction.delete(memorySources).where(eq(memorySources.memoryId, id));

    if (sources.length) {
      await transaction
        .insert(memorySources)
        .values(sources.map((source, position) => ({ memoryId: id, position, source })));
    }
  }

  private async replaceChunks(
    transaction: Transaction,
    id: string,
    content: string,
  ): Promise<void> {
    // 每次正文修改都换 chunk ID，旧异步任务无法重新写入已经删除的版本。
    await transaction.delete(memoryChunks).where(eq(memoryChunks.memoryId, id));

    const chunks = chunkText(content).map((chunk, position) => ({
      id: crypto.randomUUID(),
      memoryId: id,
      position,
      content: chunk,
      searchText: normalizeSearchText(chunk),
      tokenText: this.tokenText(chunk),
    }));

    await transaction.insert(memoryChunks).values(chunks);
    await this.services.embeddingIndex.addPending(
      transaction,
      chunks.map((chunk) => chunk.id),
    );
  }

  private tokenText(text: string): string {
    return this.services
      .tokenize(normalizeSearchText(text))
      .map(normalizeSearchText)
      .filter(Boolean)
      .join(" ");
  }
}
