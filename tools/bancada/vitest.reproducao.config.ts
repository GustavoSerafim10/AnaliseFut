import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// F1.2a — suíte lenta: prepara builds reais (git archive + npm ci) na área isolada
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test-reproducao/**/*.test.ts'],
    testTimeout: 30 * 60_000,
    hookTimeout: 30 * 60_000,
    fileParallelism: false,
    env: { TZ: 'America/Sao_Paulo' },
  },
});
