import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8' },
  },
  resolve: {
    alias: {
      'n8n-workflow': new URL('./tests/__mocks__/n8n-workflow.ts', import.meta.url).pathname,
    },
  },
});
