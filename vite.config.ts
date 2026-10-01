import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.APP_BASE_PATH ?? '/',
  worker: { format: 'es' },
  test: { include: ['src/**/*.test.ts'] },
});
