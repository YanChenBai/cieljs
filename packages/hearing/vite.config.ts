import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  pack: {
    dts: {},
    entry: {
      index: "./src/index.ts",
      worker: "./src/worker.ts",
      ciel: "./src/cli/index.ts",
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
