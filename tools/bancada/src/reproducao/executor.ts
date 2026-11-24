/**
 * Executor real: copia o harness para o build histórico e roda o vitest DAQUELE commit num
 * processo filho, um por revisão, com tempo limite, fuso e localidade fixados e rede desviada.
 * Entrada, saída e registro do processo ficam na pasta da execução (área isolada).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildPreparado } from './build';
import type { Subcausa } from './contrato';
import type { EntradaNucleo, SaidaNucleo } from './harness/zz-bancada-nucleo';
import { ambienteFilho, executarProcesso } from './processo';

export type SaidaExecucao =
  | { tipo: 'saida'; saida: SaidaNucleo }
  | {
      tipo: 'falha';
      subcausa: Extract<Subcausa, 'erro-execucao' | 'tempo-esgotado'>;
      mensagem: string;
      codigoSaida: number | null;
      /** caminho relativo à pasta da execução */
      registro: string | null;
    };

export interface ParametrosExecucao {
  pastaExecucao: string;
  /** nome estável do caso dentro da execução (ex.: "0003") */
  caso: string;
  tempoLimiteMs: number;
  fuso: string;
  localidade: string;
}

export interface Executor {
  executar(b: BuildPreparado, e: EntradaNucleo, p: ParametrosExecucao): Promise<SaidaExecucao>;
}

const HARNESS = fileURLToPath(new URL('./harness/zz-bancada-harness.ts', import.meta.url));
const NUCLEO = fileURLToPath(new URL('./harness/zz-bancada-nucleo.ts', import.meta.url));
export const ARQUIVO_HARNESS = 'apps/web/test/zz-bancada-harness.test.ts';

export class ExecutorProcesso implements Executor {
  async executar(
    b: BuildPreparado,
    e: EntradaNucleo,
    p: ParametrosExecucao,
  ): Promise<SaidaExecucao> {
    for (const d of ['entradas', 'saidas', 'registros'])
      mkdirSync(join(p.pastaExecucao, d), { recursive: true });
    const entrada = join(p.pastaExecucao, 'entradas', `${p.caso}.json`);
    const saida = join(p.pastaExecucao, 'saidas', `${p.caso}.json`);
    const registro = `registros/${p.caso}.log`;
    writeFileSync(entrada, JSON.stringify(e));

    const testes = join(b.fonte, 'apps', 'web', 'test');
    mkdirSync(testes, { recursive: true });
    copyFileSync(HARNESS, join(b.fonte, ARQUIVO_HARNESS));
    copyFileSync(NUCLEO, join(testes, 'zz-bancada-nucleo.ts'));

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
      [vitest, 'run', ARQUIVO_HARNESS, '--reporter=dot'],
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
      return { tipo: 'saida', saida: JSON.parse(readFileSync(saida, 'utf8')) as SaidaNucleo };
    return {
      tipo: 'falha',
      subcausa: 'erro-execucao',
      mensagem: `processo terminou com código ${String(r.codigo)} sem saída do harness`,
      codigoSaida: r.codigo,
      registro,
    };
  }
}
