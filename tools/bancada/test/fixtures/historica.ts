/**
 * Fixtures da F1.2b (reprocessamento): junção montada à mão a partir de entradas e evidências
 * reais (geradas pelas funções do site), e um executor do reprocessamento no próprio processo,
 * com ganchos para simular divergência, relógio ambíguo e falha de uma ponta.
 */
import { vi } from 'vitest';
import { derivar } from '../../../../apps/web/src/dados';
import type { Evidencia } from '../../../../apps/web/src/evidencias';
import { resumir, type EntradaHistorico } from '../../../../apps/web/src/historico';
import type { CriterioCanonica, Juncao } from '../../src/leitura/juntarBackups';
import type { BuildPreparado } from '../../src/reproducao/build';
import type {
  ExecutorHistorico,
  SaidaExecucaoHistorico,
} from '../../src/reproducao/executorHistorico';
import type { ParametrosExecucao } from '../../src/reproducao/executor';
import {
  executarReprocessamentoHistorico,
  type EntradaReprocessamento,
} from '../../src/reproducao/harness/zz-bancada-nucleo-reprocessamento';

const zero = { fisicos: 0, canonicos: 0, duplicatas: 0, substituidos: 0, excluidos: 0 };

export function juncao(
  entradas: { e: EntradaHistorico; criterio?: CriterioCanonica }[],
  evidencias: Evidencia[] = [],
): Juncao {
  return {
    fontes: [],
    entradas: entradas.map(({ e, criterio }) => ({
      entrada: e,
      fontes: ['teste.json'],
      versoes: criterio === 'desempate-por-conteudo' ? 2 : 1,
      criterio: criterio ?? 'unica',
      alerta: criterio === 'desempate-por-conteudo' ? 'data inválida (teste)' : null,
    })),
    evidencias,
    fontesDaEvidencia: new Map(),
    substituidas: [],
    exclusoes: [],
    conservacao: { historico: zero, evidencias: zero, arquivos: { lidos: 1, recusados: 0 } },
  };
}

export interface GanchosHistorico {
  /** altera o resumo reprocessado conforme a ponta (0 ou 1) */
  alterar?: (resumo: Record<string, unknown>, ponta: number) => void;
  /** força falha de processo numa ponta */
  falhar?: (ponta: number) => 'erro-execucao' | 'tempo-esgotado' | null;
  /** força um status do harness numa ponta */
  status?: (ponta: number) => 'ambiente-invalido' | 'api-ausente' | null;
}

/** Executor do reprocessamento no próprio processo, com os módulos atuais do site. */
export class ExecutorHistoricoEmProcesso implements ExecutorHistorico {
  chamadas: string[] = [];
  constructor(private readonly g: GanchosHistorico = {}) {}
  async executar(
    _b: BuildPreparado,
    e: EntradaReprocessamento,
    p: ParametrosExecucao,
  ): Promise<SaidaExecucaoHistorico> {
    this.chamadas.push(`${p.caso}@${e.relogio}`);
    const ponta = Number(p.caso.split('-').at(-1));
    const f = this.g.falhar?.(ponta);
    if (f)
      return {
        tipo: 'falha',
        subcausa: f,
        mensagem: `falha simulada (${f})`,
        codigoSaida: f === 'erro-execucao' ? 1 : null,
        registro: `registros/${p.caso}.log`,
      };
    const st = this.g.status?.(ponta);
    if (st)
      return {
        tipo: 'saida',
        saida: { status: st, motivo: `status simulado (${st})`, ambiente: null },
      };
    const s = await executarReprocessamentoHistorico(e, {
      carregar: async () => ({ derivar, resumir }),
      fixarRelogio: (ms) => vi.useFakeTimers({ now: ms, toFake: ['Date'] }),
      liberarRelogio: () => vi.useRealTimers(),
    });
    if (s.status !== 'ok' || !this.g.alterar) return { tipo: 'saida', saida: s };
    const r = JSON.parse(s.resumoJson) as Record<string, unknown>;
    this.g.alterar(r, ponta);
    return { tipo: 'saida', saida: { ...s, resumoJson: JSON.stringify(r) } };
  }
}
