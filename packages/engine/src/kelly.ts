/**
 * Seção 21 — stake por Kelly fracionado, com os limites de banca embutidos.
 * Nunca aumenta a stake para recuperar perdas: a função nem recebe histórico de resultado.
 */
import { POLITICA_EXPOSICAO } from './politicaExposicao';
import type { ClasseSensibilidade } from './sensibilidade';
import type { DQ } from './tipos';

/** os limites vivem em politicaExposicao.ts: aqui só os nomes de sempre */
export const MAX_POR_APOSTA = POLITICA_EXPOSICAO.tetoGeralPorAposta;
export const MAX_POR_LOTE = POLITICA_EXPOSICAO.tetoPorLote;

/**
 * Tolerância do EV por unidade apostada (p × odd − 1). O ponto flutuante deixa ruído de ~1e-16
 * quando o EV é exatamente zero (ex.: p = 0,4 e odd = 2,5 dá 7e-17); abaixo de 1e-12 não é
 * vantagem, é erro de arredondamento, e a stake é zero. É 10 000 vezes menor que o menor EV
 * que o motor sabe distinguir (1e-8 = 0,000001%), então não elimina vantagem real.
 */
export const EV_TOLERANCIA = 1e-12;

/** Por que (p, odd) não podem dimensionar uma aposta; null se estão válidos. */
export function motivoEntradaInvalida(p: number, odd: number): string | null {
  if (typeof odd !== 'number' || !Number.isFinite(odd))
    return `odd inválida (${odd}): não é um número finito`;
  if (odd <= 1) return `odd inválida (${odd}): precisa ser maior que 1`;
  if (typeof p !== 'number' || !Number.isFinite(p))
    return `probabilidade inválida (${p}): não é um número finito`;
  if (p <= 0 || p >= 1) return `probabilidade fora do intervalo (0, 1): ${p}`;
  return null;
}

/**
 * f* = (b×p − q) / b, com b = odd − 1. Entrada inválida ou EV dentro da tolerância dá 0
 * (a stake nunca nasce de NaN, Infinity ou odd ≤ 1); EV negativo continua negativo.
 */
export function kellyCheio(p: number, odd: number): number {
  if (motivoEntradaInvalida(p, odd) !== null) return 0;
  if (Math.abs(p * odd - 1) <= EV_TOLERANCIA) return 0;
  const b = odd - 1;
  return (b * p - (1 - p)) / b;
}

/**
 * Valor em R$ autorizado: arredondado para BAIXO ao centavo, para nunca passar do teto
 * financeiro. Abaixo de R$ 0,01 vira 0,00 (a fração continua exata em `fracaoBanca`).
 */
export function valorEmReais(banca: number, fracaoBanca: number): number {
  if (!Number.isFinite(banca) || banca <= 0 || !Number.isFinite(fracaoBanca) || fracaoBanca <= 0)
    return 0;
  return Math.floor(banca * fracaoBanca * 100) / 100;
}

/** 1/4 com DQ A/B e ROBUSTA; 1/8 com DQ C, MODERADA ou escalação incerta. */
export function fracaoKelly(dq: DQ, classe: ClasseSensibilidade, escalacaoIncerta = false): number {
  return (dq === 'A' || dq === 'B') && classe === 'ROBUSTA' && !escalacaoIncerta
    ? POLITICA_EXPOSICAO.kellyForte
    : POLITICA_EXPOSICAO.kellyPadrao;
}

export interface Stake {
  kellyCheio: number;
  fracaoKelly: number;
  /** fração da banca já com o teto de 2% */
  fracaoBanca: number;
  limitadaPeloTeto: boolean;
  valor?: number;
}

/** Pedido de autorização de exposição: a ÚNICA porta de saída de stake do motor. */
export interface PedidoStake {
  /** probabilidade efetiva (sem contar devolução) e odd que entra na conta */
  p: number;
  odd: number;
  /** fração de Kelly já escolhida pela política do chamador (por DQ/robustez ou por nível) */
  fracaoKelly: number;
  /** multiplicadores extras (filtro do modelo, drawdown...): só reduzem, nunca passam de 1 */
  reducoes?: number[];
  /** qualidade dos dados: D e E nunca autorizam exposição */
  dq?: DQ;
  /** teto específico desta aposta; o teto geral de 2% vale sempre também */
  teto?: number;
  /** o que resta do teto diário (fração da banca) */
  folgaDia?: number;
  banca?: number;
}

export interface StakeAutorizada {
  autorizada: boolean;
  /** por que a exposição é zero, quando é */
  motivo?: string;
  kellyCheio: number;
  /** fração efetiva depois das reduções */
  fracaoKelly: number;
  fracaoBanca: number;
  /** o que cortou a stake, na ordem em que cortou */
  limites: ('teto' | 'dia')[];
  /** teto por aposta efetivamente aplicado (o mais restritivo entre o geral e o específico) */
  teto: number;
  valor?: number;
}

/**
 * Dimensiona e AUTORIZA a exposição. Regra mais restritiva vence: Kelly fracionado, teto geral
 * de 2%, teto específico e o que resta do dia. DQ D/E fica zerado aqui, na camada que autoriza.
 */
export function autorizarStake(p: PedidoStake): StakeAutorizada {
  const k = kellyCheio(p.p, p.odd);
  let fracao = p.fracaoKelly;
  for (const r of p.reducoes ?? []) fracao *= Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
  // teto efetivo: o mais restritivo entre o geral e o específico (inválido conta como zero)
  const tetoEf = Number.isFinite(p.teto ?? MAX_POR_APOSTA)
    ? Math.min(MAX_POR_APOSTA, p.teto ?? MAX_POR_APOSTA)
    : 0;
  const zero = (motivo: string): StakeAutorizada => ({
    autorizada: false,
    motivo,
    kellyCheio: k,
    fracaoKelly: Number.isFinite(fracao) ? fracao : 0,
    fracaoBanca: 0,
    limites: [],
    teto: tetoEf,
    valor: p.banca !== undefined ? 0 : undefined,
  });
  // entradas inválidas nunca viram stake positiva, NaN ou valor inconsistente: viram zero com motivo
  const invalida = motivoEntradaInvalida(p.p, p.odd);
  if (invalida) return zero(invalida);
  if (!Number.isFinite(p.fracaoKelly) || p.fracaoKelly < 0)
    return zero(`fração de Kelly inválida (${p.fracaoKelly})`);
  if (p.teto !== undefined && !(Number.isFinite(p.teto) && p.teto >= 0))
    return zero(`teto inválido (${p.teto})`);
  if (p.folgaDia !== undefined && !Number.isFinite(p.folgaDia))
    return zero(`folga do dia inválida (${p.folgaDia})`);
  if (p.banca !== undefined && !(Number.isFinite(p.banca) && p.banca > 0))
    return zero(`banca inválida (${p.banca})`);
  if (p.dq !== undefined && POLITICA_EXPOSICAO.dqSemExposicao.includes(p.dq))
    return zero(`DQ ${p.dq}: sem exposição autorizada`);
  if (k <= 0) return zero('sem vantagem: EV nulo ou negativo');

  let f = Math.max(0, k) * fracao;
  const limites: StakeAutorizada['limites'] = [];
  if (f > tetoEf) {
    f = tetoEf;
    limites.push('teto');
  }
  if (p.folgaDia !== undefined && f > Math.max(0, p.folgaDia)) {
    f = Math.max(0, p.folgaDia);
    limites.push('dia');
  }
  return {
    autorizada: f > 0,
    kellyCheio: k,
    fracaoKelly: fracao,
    fracaoBanca: f,
    limites,
    teto: tetoEf,
    valor: p.banca !== undefined ? valorEmReais(p.banca, f) : undefined,
  };
}

export function calcularStake(p: {
  p: number;
  odd: number;
  dq: DQ;
  classe: ClasseSensibilidade;
  escalacaoIncerta?: boolean;
  banca?: number;
}): Stake {
  const a = autorizarStake({
    p: p.p,
    odd: p.odd,
    dq: p.dq,
    fracaoKelly: fracaoKelly(p.dq, p.classe, p.escalacaoIncerta),
    banca: p.banca,
  });
  return {
    kellyCheio: a.kellyCheio,
    fracaoKelly: a.fracaoKelly,
    fracaoBanca: a.fracaoBanca,
    limitadaPeloTeto: a.limites.includes('teto'),
    valor: a.valor,
  };
}

/** Reduz proporcionalmente as stakes de um lote para não passar de 5% da banca. */
export function limitarLote(fracoes: number[], max = MAX_POR_LOTE): number[] {
  const total = fracoes.reduce((s, f) => s + f, 0);
  if (total <= max) return [...fracoes];
  return fracoes.map((f) => (f * max) / total);
}
