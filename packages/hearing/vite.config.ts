import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: 'vp pack',
      test: {
        command: 'vp test',
        env: ['CIEL_NODE_EXECUTABLE'],
        output: [],
        input: [{ auto: true }, '!dist/**', '!**/*.tsbuildinfo'],
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
  pack: {
    dts: {},
    entry: {
      index: './src/index.ts',
      worker: './src/worker.ts',
      ciel: './src/cli/index.ts',
    },
    exports: true,
  },
});
