import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: 'vp pack',
      test: {
        command: 'vp test',
        output: [],
        input: [{ auto: true }, '!dist/**', '!**/*.tsbuildinfo'],
      },
    },
  },
  pack: {
    plugins: [vue()],
    entry: {
      index: 'src/index.ts',
      style: 'src/style.css',
    },
    dts: true,
    exports: false,
  },
});
