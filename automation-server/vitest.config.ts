import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    server: {
      deps: {
        external: ['node:sqlite', 'better-sqlite3']
      }
    }
  }
});
