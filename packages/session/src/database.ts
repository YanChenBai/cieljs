import { PGlite } from '@electric-sql/pglite';
import { vector as pgvector } from '@electric-sql/pglite-pgvector';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';

export function createDatabase(dataDir: string) {
  /**
   * PGlite 必须在启动时加载 WASM extension。
   */
  const client = new PGlite(dataDir, {
    extensions: {
      vector: pgvector,
      pg_trgm,
    },
  });

  const db = drizzle({
    client,
  });

  return {
    client,
    db,
  };
}

export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
