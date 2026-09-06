import { fileURLToPath } from "node:url";
import { defineConfig, ResolveOptions } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import type {
  MainViteConfig,
  RendererViteConfig,
  PreloadViteConfig,
} from "@byc/electron-vite-plus";

// vite-plus
declare module "vite-plus" {
  interface UserConfig {
    /**
     * Shared resolve options for the electron main, preload and renderer processes.
     *
     * This includes Vite+ resolve extensions such as `resolve.tsconfigPaths` when
     * the project uses Vite+ as its Vite implementation.
     */
    resolve?: ResolveOptions;
    /**
     * Vite config options for electron main process
     *
     * @see https://vitejs.dev/config/
     */
    main?: MainViteConfig;
    /**
     * Vite config options for electron renderer process
     *
     * @see https://vitejs.dev/config/
     */
    renderer?: RendererViteConfig;
    /**
     * Vite config options for electron preload scripts
     *
     * @see https://vitejs.dev/config/
     */
    preload?: PreloadViteConfig;
  }
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  main: {},
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
    server: {
      port: 3000,
    },
  },
});
