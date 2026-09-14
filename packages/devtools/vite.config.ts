import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    fileParallelism: false,
    sequence: { groupOrder: 1 },
  },
  run: {
    tasks: {
      build: {
        command: 'vp pack',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
      },
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
