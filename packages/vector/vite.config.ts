import { defineConfig } from 'vite-plus';
export default defineConfig({
  run: {
    tasks: {
      build: 'vp pack',
      test: {
        command: 'vp test --passWithNoTests',
        output: [],
        input: [{ auto: true }, '!dist/**', '!**/*.tsbuildinfo'],
      },
    },
  },
  pack: { entry: ['src/index.ts'], dts: { tsgo: true } },
  lint: { options: { typeAware: true, typeCheck: true } },
});
