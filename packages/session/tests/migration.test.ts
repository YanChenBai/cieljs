import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test, vi } from "vite-plus/test";

import { SessionStore } from "../src/index.ts";
import { retrievalEmbeddings } from "../src/schema.ts";

test("旧版 1024 维索引升级后保留原始数据，通过批量接口建立新模型索引", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ciel-session-migration-"));
  const dataDir = join(directory, "database");
  const migrationsFolder = join(directory, "migrations");
  const oldMigration = "20260903085811_faithful_forgotten_one";
  const client = new PGlite(dataDir, { extensions: { vector, pg_trgm } });
  let store: SessionStore | undefined;

  try {
    await cp(
      fileURLToPath(new URL(`../migrations/${oldMigration}`, import.meta.url)),
      join(migrationsFolder, oldMigration),
      { recursive: true },
    );
    await client.exec("CREATE EXTENSION vector; CREATE EXTENSION pg_trgm;");
    await migrate(drizzle({ client }), { migrationsFolder });
    await client.query("INSERT INTO sessions (id, next_message_seq) VALUES ($1, 2)", ["legacy"]);
    await client.query(
      "INSERT INTO session_messages (id, session_id, seq, message) VALUES ($1, $2, 1, $3)",
      [
        "message",
        "legacy",
        JSON.stringify({ role: "user", content: "legacy history", timestamp: 1 }),
      ],
    );
    await client.query(
      "INSERT INTO retrieval_chunks (id, session_id, message_id, message_seq, content, search_text) VALUES ($1, $2, $3, 1, $4, $4)",
      ["chunk", "legacy", "message", "legacy history"],
    );
    const embedding = [1, ...Array.from({ length: 1023 }, () => 0)];
    await client.query(
      "INSERT INTO retrieval_embeddings (chunk_id, model, embedding) VALUES ($1, $2, $3)",
      ["chunk", "legacy-model", JSON.stringify(embedding)],
    );
    await client.close();

    const embedBatch = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    store = await SessionStore.open({
      dataDir,
      embedding: { model: "new-model", dimensions: 2, embedBatch },
    });
    const [legacy] = await store.db.select().from(retrievalEmbeddings);
    expect(legacy).toMatchObject({ dimensions: 1024, embedding });
    expect(await store.getMessages("legacy")).toHaveLength(1);
    await store.rebuildEmbeddings("legacy");
    expect(embedBatch).toHaveBeenCalledWith(["legacy history"], { purpose: "document" });
    expect(await store.searchVector("legacy", { sessionId: "legacy" })).toHaveLength(1);
    await store.close();
    store = await SessionStore.open({ dataDir });
    expect(await store.searchFullText("legacy", { sessionId: "legacy" })).toHaveLength(1);
  } finally {
    if (store) await store.close();
    if (!client.closed) await client.close();
    // 仅清理本测试通过 mkdtemp 创建的独立临时目录。
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
