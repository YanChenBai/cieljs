import { sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { MemoryKind, MemoryLayer, MemorySource, MemoryStatus } from "./types.ts";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => JSON.parse(value) as number[],
});

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    layer: text("layer").$type<MemoryLayer>().notNull(),
    spaceId: text("space_id"),
    date: date("date"),
    kind: text("kind").$type<MemoryKind>().notNull(),
    content: text("content").notNull(),
    status: text("status").$type<MemoryStatus>().notNull().default("active"),
    revision: integer("revision").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    check(
      "memories_layer_space_check",
      sql`(${table.layer} = 'global.long_term' AND ${table.spaceId} IS NULL) OR (${table.layer} IN ('space.long_term', 'space.daily') AND length(trim(${table.spaceId})) > 0)`,
    ),
    check(
      "memories_layer_date_check",
      sql`(${table.layer} = 'space.daily' AND ${table.date} IS NOT NULL) OR (${table.layer} IN ('global.long_term', 'space.long_term') AND ${table.date} IS NULL)`,
    ),
    check("memories_kind_check", sql`${table.kind} IN ('event', 'fact', 'preference', 'summary')`),
    check("memories_status_check", sql`${table.status} IN ('active', 'archived')`),
    check("memories_content_check", sql`length(trim(${table.content})) > 0`),
    check("memories_revision_check", sql`${table.revision} > 0`),
    index("memories_space_layer_date_idx")
      .on(table.spaceId, table.layer, table.date)
      .where(sql`${table.layer} <> 'global.long_term'`),
  ],
);

export const memorySources = pgTable(
  "memory_sources",
  {
    memoryId: text("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    source: jsonb("source").$type<MemorySource>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.memoryId, table.position] })],
);

export const memoryChunks = pgTable(
  "memory_chunks",
  {
    id: text("id").primaryKey(),
    memoryId: text("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    content: text("content").notNull(),
    searchText: text("search_text").notNull(),
    tokenText: text("token_text").notNull(),
  },
  (table) => [
    uniqueIndex("memory_chunks_position_idx").on(table.memoryId, table.position),
    index("memory_chunks_fts_idx").using("gin", sql`to_tsvector('simple', ${table.tokenText})`),
    index("memory_chunks_trgm_idx").using("gin", sql`${table.searchText} gin_trgm_ops`),
  ],
);

// 空向量行也是持久化任务；重启可以继续未完成或失败的索引。
export const memoryEmbeddings = pgTable(
  "memory_embeddings",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => memoryChunks.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    embedding: vector("embedding"),
    status: text("status").$type<"pending" | "ready" | "failed">().notNull().default("pending"),
    error: text("error"),
  },
  (table) => [
    primaryKey({ columns: [table.chunkId, table.model, table.dimensions] }),
    index("memory_embeddings_jobs_idx").on(table.model, table.dimensions, table.status),
    check(
      "memory_embeddings_dimensions_check",
      sql`${table.dimensions} BETWEEN 1 AND 16000 AND (${table.embedding} IS NULL OR vector_dims(${table.embedding}) = ${table.dimensions})`,
    ),
    check(
      "memory_embeddings_status_check",
      sql`(${table.status} = 'ready' AND ${table.embedding} IS NOT NULL) OR (${table.status} IN ('pending', 'failed') AND ${table.embedding} IS NULL)`,
    ),
  ],
);
