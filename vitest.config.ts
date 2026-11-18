import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    // grades pesadas (Kelly 445 mil pedidos, cem abas do Ledger) passam de 5 s com a máquina
    // carregada e rodam em ~1 s isoladas: o limite padrão dava falha falsa
    testTimeout: 20_000,
  },
});
