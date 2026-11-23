/**
 * CLV padronizado. O clvJusto do motor mistura duas medidas (com os outros lados informados tira
 * a margem; sem eles compara contra a odd COM margem). Aqui elas ficam separadas:
 *
 *  principal  odd × p_fechamento_sem_margem − 1   (só com o mercado de fechamento completo)
 *  log        ln(odd × p_fechamento_sem_margem)    (simétrico: para média e variância)
 *  bruto      odd ÷ odd_fechamento − 1             (contra a odd com margem; relatado à parte)
 *
 * A margem sai com a mesma função do motor (removerMargem; Shin com 3 lados, como clvJusto).
 * O fechamento não tem horário registrado: toda medida sai com janela "nao-verificada".
 * Só cálculo por registro: nenhuma agregação nem conclusão aqui.
 */
import { removerMargem } from '@pe/engine';

/** δ de CLV pré-registrado (decisão de 23/11/2026): 2%, ou ln(1,02) na escala logarítmica. */
export const DELTA_CLV = 0.02;
export const DELTA_CLV_LOG = Math.log(1.02);

export interface ClvPadronizado {
  principal: number | null;
  log: number | null;
  bruto: number | null;
  /** probabilidade justa do lado no fechamento (null sem os outros lados) */
  pFechamentoSemMargem: number | null;
  metodoMargem: string | null;
  /** o fechamento não tem horário: a janela não pode ser conferida */
  janela: 'nao-verificada';
  /** por que o principal não saiu, quando não saiu */
  motivo?: string;
}

const oddValida = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 1;

export function clvPadronizado(
  odd: number | null | undefined,
  fechamentoLado: number | null | undefined,
  fechamentoOutros: (number | null | undefined)[] | null | undefined,
): ClvPadronizado {
  const vazio = (motivo: string): ClvPadronizado => ({
    principal: null,
    log: null,
    bruto: null,
    pFechamentoSemMargem: null,
    metodoMargem: null,
    janela: 'nao-verificada',
    motivo,
  });
  if (!oddValida(odd)) return vazio('odd da entrada inválida ou ausente');
  if (!oddValida(fechamentoLado)) return vazio('sem odd de fechamento');
  const bruto = odd / fechamentoLado - 1;
  const outros = fechamentoOutros ?? [];
  if (!outros.length)
    return { ...vazio('fechamento sem os outros lados: só o CLV bruto (com margem)'), bruto };
  if (!outros.every(oddValida))
    return { ...vazio('fechamento com lado inválido: só o CLV bruto (com margem)'), bruto };
  const odds = [fechamentoLado, ...(outros as number[])];
  const r = removerMargem(odds, odds.length === 3 ? 'shin' : undefined);
  const p = r.probs[0];
  return {
    principal: odd * p - 1,
    log: Math.log(odd * p),
    bruto,
    pFechamentoSemMargem: p,
    metodoMargem: r.metodo,
    janela: 'nao-verificada',
  };
}
