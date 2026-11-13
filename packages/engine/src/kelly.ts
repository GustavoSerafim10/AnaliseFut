/**
 * Seção 21 — stake por Kelly fracionado, com os limites de banca embutidos.
 * Nunca aumenta a stake para recuperar perdas: a função nem recebe histórico de resultado.
 */
import type { ClasseSensibilidade } from './sensibilidade';
import type { DQ } from './tipos';

export const MAX_POR_APOSTA = 0.02;
export const MAX_POR_LOTE = 0.05;

/** f* = (b×p − q) / b, com b = odd − 1 */
export function kellyCheio(p: number, odd: number): number {
  const b = odd - 1;
  return (b * p - (1 - p)) / b;
}

/** 1/4 com DQ A/B e ROBUSTA; 1/8 com DQ C, MODERADA ou escalação incerta. */
export function fracaoKelly(dq: DQ, classe: ClasseSensibilidade, escalacaoIncerta = false): number {
  return (dq === 'A' || dq === 'B') && classe === 'ROBUSTA' && !escalacaoIncerta ? 0.25 : 0.125;
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
  valor?: number;
}

/**
 * Dimensiona e AUTORIZA a exposição. Regra mais restritiva vence: Kelly fracionado, teto geral
 * de 2%, teto específico e o que resta do dia. DQ D/E fica zerado aqui, na camada que autoriza.
 */
export function autorizarStake(p: PedidoStake): StakeAutorizada {
  const k = kellyCheio(p.p, p.odd);
  let fracao = p.fracaoKelly;
  for (const r of p.reducoes ?? []) fracao *= Math.min(1, Math.max(0, r));
  const zero = (motivo: string): StakeAutorizada => ({
    autorizada: false,
    motivo,
    kellyCheio: k,
    fracaoKelly: fracao,
    fracaoBanca: 0,
    limites: [],
    valor: p.banca !== undefined ? 0 : undefined,
  });
  if (p.dq === 'D' || p.dq === 'E') return zero(`DQ ${p.dq}: sem exposição autorizada`);

  let f = Math.max(0, k) * fracao;
  const limites: StakeAutorizada['limites'] = [];
  const teto = Math.min(MAX_POR_APOSTA, p.teto ?? MAX_POR_APOSTA);
  if (f > teto) {
    f = teto;
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
    valor: p.banca !== undefined ? Math.round(p.banca * f * 100) / 100 : undefined,
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
