import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  electron: {
    main: {
      filterConsole: (line) => line.includes("Failed to resolve address"),
    },
    preload: {
      build: {
        externalizeDeps: false,
        rollupOptions: { output: { format: "es", entryFileNames: "index.mjs" } },
      },
    },
    renderer: {
      resolve: {
        alias: [
          {
            find: "@cieljs/devtools/style.css",
            replacement: fileURLToPath(
              new URL("../../packages/devtools/src/ui/style.css", import.meta.url),
            ),
          },
          {
            find: /^@cieljs\/devtools$/,
            replacement: fileURLToPath(
              new URL("../../packages/devtools/src/ui/index.ts", import.meta.url),
            ),
          },
        ],
      },
      plugins: [
        vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "webview" } } }),
        tailwindcss(),
      ],
    },
  },
});
