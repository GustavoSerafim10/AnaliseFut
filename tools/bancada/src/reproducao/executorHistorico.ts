/**
 * Executor do reprocessamento de entradas do histórico: copia o harness (e os dois núcleos)
 * para o build de referência e roda o vitest DAQUELE commit num processo filho, um por ponta do
 * minuto, com tempo limite, fuso e localidade fixados e rede desviada — o mesmo padrão do
 * executor da F1.2a, que não muda.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildPreparado } from './build';
import type { ParametrosExecucao } from './executor';
import type {
  EntradaReprocessamento,
  SaidaReprocessamento,
} from './harness/zz-bancada-nucleo-reprocessamento';
import { ambienteFilho, executarProcesso } from './processo';

export type SaidaExecucaoHistorico =
  | { tipo: 'saida'; saida: SaidaReprocessamento }
  | {
      tipo: 'falha';
      subcausa: 'erro-execucao' | 'tempo-esgotado';
      mensagem: string;
      codigoSaida: number | null;
      registro: string | null;
    };

export interface ExecutorHistorico {
  executar(
    b: BuildPreparado,
    e: EntradaReprocessamento,
    p: ParametrosExecucao,
  ): Promise<SaidaExecucaoHistorico>;
}

const arquivo = (n: string) => fileURLToPath(new URL(`./harness/${n}`, import.meta.url));
export const ARQUIVO_HARNESS_REPROCESSAMENTO = 'apps/web/test/zz-bancada-reprocessamento.test.ts';

export class ExecutorHistoricoProcesso implements ExecutorHistorico {
  async executar(
    b: BuildPreparado,
    e: EntradaReprocessamento,
    p: ParametrosExecucao,
  ): Promise<SaidaExecucaoHistorico> {
    for (const d of ['entradas', 'saidas', 'registros'])
      mkdirSync(join(p.pastaExecucao, d), { recursive: true });
    const entrada = join(p.pastaExecucao, 'entradas', `${p.caso}.json`);
    const saida = join(p.pastaExecucao, 'saidas', `${p.caso}.json`);
    const registro = `registros/${p.caso}.log`;
    writeFileSync(entrada, JSON.stringify(e));

    const testes = join(b.fonte, 'apps', 'web', 'test');
    mkdirSync(testes, { recursive: true });
    copyFileSync(
      arquivo('zz-bancada-reprocessamento.ts'),
      join(b.fonte, ARQUIVO_HARNESS_REPROCESSAMENTO),
    );
    copyFileSync(arquivo('zz-bancada-nucleo.ts'), join(testes, 'zz-bancada-nucleo.ts'));
    copyFileSync(
      arquivo('zz-bancada-nucleo-reprocessamento.ts'),
      join(testes, 'zz-bancada-nucleo-reprocessamento.ts'),
    );

    const vitest = join(b.fonte, 'node_modules', 'vitest', 'vitest.mjs');
    if (!existsSync(vitest))
      return {
        tipo: 'falha',
        subcausa: 'erro-execucao',
        mensagem: 'vitest do build não encontrado (dependências incompletas)',
        codigoSaida: null,
        registro: null,
      };
    const r = await executarProcesso(
      process.execPath,
      [vitest, 'run', ARQUIVO_HARNESS_REPROCESSAMENTO, '--reporter=dot'],
      {
        cwd: b.fonte,
        tempoLimiteMs: p.tempoLimiteMs,
        env: ambienteFilho({
          TZ: p.fuso,
          LANG: `${p.localidade.replace('-', '_')}.UTF-8`,
          LC_ALL: `${p.localidade.replace('-', '_')}.UTF-8`,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          PE_BANCADA_ENTRADA: entrada,
          PE_BANCADA_SAIDA: saida,
        }),
      },
    );
    writeFileSync(join(p.pastaExecucao, registro), `${r.saida}\n--- stderr ---\n${r.erro}`);
    if (r.tempoEsgotado)
      return {
        tipo: 'falha',
        subcausa: 'tempo-esgotado',
        mensagem: `passou do tempo limite de ${p.tempoLimiteMs} ms; árvore de processos encerrada`,
        codigoSaida: r.codigo,
        registro,
      };
    if (existsSync(saida))
      return {
        tipo: 'saida',
        saida: JSON.parse(readFileSync(saida, 'utf8')) as SaidaReprocessamento,
      };
    return {
      tipo: 'falha',
      subcausa: 'erro-execucao',
      mensagem: `processo terminou com código ${String(r.codigo)} sem saída do harness`,
      codigoSaida: r.codigo,
      registro,
    };
  }
}
