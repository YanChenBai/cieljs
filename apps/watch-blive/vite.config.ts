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
        rollupOptions: {
          output: {
            format: "es",
            entryFileNames: "index.mjs",
          },
        },
      },
    },
    renderer: {
      plugins: [
        tailwindcss(),
        vue({
          template: {
            compilerOptions: {
              isCustomElement: (tag) => tag === "webview",
            },
          },
        }),
      ],
    },
  },
});
