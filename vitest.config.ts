import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared'), '@main': resolve('src/main') },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/main/services/**', 'src/shared/**'] },
  },
});
