/**
 * Harness do reprocessamento, copiado para <build>/apps/web/test/zz-bancada-reprocessamento.test.ts
 * e rodado pelo vitest do build de REFERÊNCIA. Lê a entrada e grava a saída nos caminhos dados
 * pelo orquestrador (sempre na área isolada).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { it, vi } from 'vitest';
import {
  executarReprocessamentoHistorico,
  type EntradaReprocessamento,
} from './zz-bancada-nucleo-reprocessamento';

const base = '../src/';

it('bancada: reprocessamento de uma entrada do histórico', async () => {
  const entrada = JSON.parse(
    readFileSync(process.env.PE_BANCADA_ENTRADA as string, 'utf8'),
  ) as EntradaReprocessamento;
  const saida = await executarReprocessamentoHistorico(entrada, {
    carregar: async () => {
      const dados = (await import(/* @vite-ignore */ `${base}dados`)) as Record<string, unknown>;
      const hist = (await import(/* @vite-ignore */ `${base}historico`)) as Record<string, unknown>;
      return { derivar: dados.derivar, resumir: hist.resumir };
    },
    fixarRelogio: (ms) => vi.useFakeTimers({ now: ms, toFake: ['Date'] }),
    liberarRelogio: () => vi.useRealTimers(),
  });
  writeFileSync(process.env.PE_BANCADA_SAIDA as string, JSON.stringify(saida));
});
