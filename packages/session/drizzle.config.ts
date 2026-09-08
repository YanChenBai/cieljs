import { resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    url: resolve('../core/.ciel/sessions'),
  },
});
