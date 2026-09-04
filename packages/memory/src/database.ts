import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";

import { asc, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { memories, memorySources } from "./schema.ts";
import type { MemoryEntry } from "./types.ts";

export function createDatabase(dataDir: string) {
  const client = new PGlite(dataDir, { extensions: { vector, pg_trgm } });
  const db = drizzle({ client });

  return { client, db };
}

export type Database = ReturnType<typeof createDatabase>["db"];
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type MemoryRow = typeof memories.$inferSelect;

export async function materializeMemoryEntries(
  transaction: Transaction,
  rows: MemoryRow[],
): Promise<MemoryEntry[]> {
  if (!rows.length) {
    return [];
  }

  const sources = await transaction
    .select()
    .from(memorySources)
    .where(
      inArray(
        memorySources.memoryId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(memorySources.position));

  return rows.map((row) => ({
    id: row.id,
    scope:
      row.scopeType === "global" ? { type: "global" } : { type: "space", spaceId: row.scopeId },
    layer: row.layer,
    date: row.date,
    kind: row.kind,
    content: row.content,
    status: row.status,
    revision: row.revision,
    occurredAt: row.occurredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    metadata: row.metadata,
    sources: sources.filter((source) => source.memoryId === row.id).map((source) => source.source),
  }));
}
