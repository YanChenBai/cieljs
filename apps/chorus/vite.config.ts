import { defineConfig } from 'vite-plus';

export default defineConfig({
  run: {
    tasks: {
      build: 'vp pack',
      test: {
        command: 'vp test',
        env: ['XIAOMI_API_KEY'],
        output: [],
        input: [{ auto: true }, '!dist/**', '!**/*.tsbuildinfo'],
      },
    },
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
});
