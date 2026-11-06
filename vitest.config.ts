import { defineConfig } from 'vitest/config';

// 단위 시험만. e2e/는 Playwright 몫(npm run test:e2e).
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'electron/**/*.test.ts', 'core/**/*.test.ts', 'modules/**/*.test.ts'],
  },
});
