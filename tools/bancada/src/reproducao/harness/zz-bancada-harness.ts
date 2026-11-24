/**
 * Harness copiado para <build>/apps/web/test/zz-bancada-harness.test.ts e rodado pelo vitest
 * DAQUELE commit. Lê a entrada e grava a saída nos caminhos dados pelo orquestrador (sempre na
 * área isolada). Os módulos do build entram por import dinâmico relativo à pasta de testes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { it, vi } from 'vitest';
import { executarNucleo, type EntradaNucleo } from './zz-bancada-nucleo';

const base = '../src/';

it('bancada: reprodução de uma revisão', async () => {
  const entrada = JSON.parse(
    readFileSync(process.env.PE_BANCADA_ENTRADA as string, 'utf8'),
  ) as EntradaNucleo;
  const saida = await executarNucleo(entrada, {
    carregar: async () => {
      const dados = (await import(/* @vite-ignore */ `${base}dados`)) as Record<string, unknown>;
      const ev = (await import(/* @vite-ignore */ `${base}evidencias`)) as Record<string, unknown>;
      return {
        derivar: dados.derivar,
        montarConteudo: ev.montarConteudo,
        canonico: ev.canonico,
        impressaoDigital: ev.impressaoDigital,
      };
    },
    fixarRelogio: (ms) => vi.useFakeTimers({ now: ms, toFake: ['Date'] }),
    liberarRelogio: () => vi.useRealTimers(),
  });
  writeFileSync(process.env.PE_BANCADA_SAIDA as string, JSON.stringify(saida));
});
