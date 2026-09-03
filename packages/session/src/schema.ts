import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Session 本身。
 *
 * nextMessageSeq 只给 session_messages 使用。
 * Compaction 不参与 Message seq。
 */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),

  nextMessageSeq: bigint("next_message_seq", {
    mode: "number",
  })
    .notNull()
    .default(1),

  createdAt: timestamp("created_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
});

/**
 * Agent Message 是 Session 唯一真实时间线。
 */
export const sessionMessages = pgTable(
  "session_messages",
  {
    id: text("id").primaryKey(),

    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, {
        onDelete: "cascade",
      }),

    seq: bigint("seq", {
      mode: "number",
    }).notNull(),

    message: jsonb("message").$type<AgentMessage>().notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("session_messages_session_seq_unique").on(table.sessionId, table.seq)],
);

/**
 * Compaction 是对 Message Log 的 Snapshot。
 *
 * throughSeq = 10
 *
 * 表示 summary 已经包含 message 1 ~ 10。
 */
export const sessionCompactions = pgTable(
  "session_compactions",
  {
    id: text("id").primaryKey(),

    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, {
        onDelete: "cascade",
      }),

    throughSeq: bigint("through_seq", {
      mode: "number",
    }).notNull(),

    summary: text("summary").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("session_compactions_session_through_unique").on(table.sessionId, table.throughSeq),
  ],
);

/**
 * 可检索 Chunk。
 *
 * 当前来源只有 Session Message，
 * 以后 ASR / Percept / Memory 可以继续扩。
 */
export const retrievalChunks = pgTable(
  "retrieval_chunks",
  {
    id: text("id").primaryKey(),

    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, {
        onDelete: "cascade",
      }),

    messageId: text("message_id")
      .notNull()
      .references(() => sessionMessages.id, {
        onDelete: "cascade",
      }),

    messageSeq: bigint("message_seq", {
      mode: "number",
    }).notNull(),

    chunkIndex: integer("chunk_index").notNull().default(0),

    /**
     * 原始文本。
     */
    content: text("content").notNull(),

    /**
     * 给 FTS / trigram 使用的文本。
     *
     * 以后你想接中文 tokenizer，
     * 改生成这个字段的 normalizer 即可。
     */
    searchText: text("search_text").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("retrieval_chunks_message_chunk_unique").on(table.messageId, table.chunkIndex),

    index("retrieval_chunks_session_seq_idx").on(table.sessionId, table.messageSeq),

    /**
     * PostgreSQL FTS。
     */
    index("retrieval_chunks_fts_idx").using("gin", sql`to_tsvector('simple', ${table.searchText})`),

    /**
     * pg_trgm。
     *
     * 用于：
     * - 包名
     * - symbol
     * - typo
     * - 中文 substring
     */
    index("retrieval_chunks_trgm_idx").using("gin", sql`${table.searchText} gin_trgm_ops`),
  ],
);

/**
 * Embedding 独立存。
 *
 * Vector 是派生数据，可以随时重新生成。
 */
export const retrievalEmbeddings = pgTable(
  "retrieval_embeddings",
  {
    chunkId: text("chunk_id")
      .notNull()
      .references(() => retrievalChunks.id, {
        onDelete: "cascade",
      }),

    model: text("model").notNull(),

    embedding: vector("embedding", {
      dimensions: EMBEDDING_DIMENSIONS,
    }).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.chunkId, table.model],
    }),

    index("retrieval_embeddings_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);
