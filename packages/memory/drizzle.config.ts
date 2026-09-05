import { defineConfig } from "drizzle-kit";
import { resolve } from "node:path";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  driver: "pglite",
  dbCredentials: {
    url: resolve("../core/.ciel/memory"),
  },
});
