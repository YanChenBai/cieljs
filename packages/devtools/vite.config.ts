import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    plugins: [vue()],
    entry: {
      host: 'src/host/index.ts',
      client: 'src/client/index.ts',
      protocol: 'src/protocol/index.ts',
      index: 'src/ui/index.ts',
      style: 'src/ui/styles/main.css',
    },
    dts: true,
    exports: false,
  },
});
