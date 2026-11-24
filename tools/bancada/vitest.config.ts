import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// testes da bancada: fora da lista da raiz (não entram no CI de deploy)
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // F1.2: fuso fixado explicitamente; o harness confere o EFETIVO, não só a variável
    env: { TZ: 'America/Sao_Paulo' },
  },
});
