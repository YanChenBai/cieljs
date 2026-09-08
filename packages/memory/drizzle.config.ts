import { resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  driver: 'pglite',
  dbCredentials: {
    url: resolve('../core/.ciel/memory'),
  },
});
