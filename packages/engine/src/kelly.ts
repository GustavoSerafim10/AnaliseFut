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

export function calcularStake(p: {
  p: number;
  odd: number;
  dq: DQ;
  classe: ClasseSensibilidade;
  escalacaoIncerta?: boolean;
  banca?: number;
}): Stake {
  const k = kellyCheio(p.p, p.odd);
  const fracao = fracaoKelly(p.dq, p.classe, p.escalacaoIncerta);
  const bruta = Math.max(0, k) * fracao;
  const fracaoBanca = Math.min(bruta, MAX_POR_APOSTA);
  return {
    kellyCheio: k,
    fracaoKelly: fracao,
    fracaoBanca,
    limitadaPeloTeto: bruta > MAX_POR_APOSTA,
    valor: p.banca !== undefined ? Math.round(p.banca * fracaoBanca * 100) / 100 : undefined,
  };
}

/** Reduz proporcionalmente as stakes de um lote para não passar de 5% da banca. */
export function limitarLote(fracoes: number[], max = MAX_POR_LOTE): number[] {
  const total = fracoes.reduce((s, f) => s + f, 0);
  if (total <= max) return [...fracoes];
  return fracoes.map((f) => (f * max) / total);
}
