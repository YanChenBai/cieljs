import { defineConfig } from 'vite-plus';

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: {
    singleQuote: true,
    sortImports: true,
    sortTailwindcss: true,
    sortPackageJson: true,
    arrowParens: 'avoid',
    embeddedLanguageFormatting: 'auto',
    ignorePatterns: [
      '**/node_modules/**',
      '**/dist/**',
      '**/drizzle/**',
      '**/out/**',
      '**/migrations/**',
    ],
  },
  lint: {
    jsPlugins: [
      {
        name: 'vite-plus',
        specifier: 'vite-plus/oxlint-plugin',
      },
    ],
    rules: {
      // Vite Plus
      'vite-plus/prefer-vite-plus-imports': 'error',

      // Typescript
      'typescript/no-floating-promises': 'off',
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
