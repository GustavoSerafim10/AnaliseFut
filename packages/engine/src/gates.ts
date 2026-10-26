/**
 * Seções 12, 13, 14 e 20 — blend, EV, edge gate e price gate.
 */
import type { DQ } from './tipos';

export const PESO_MODELO_BASE: Record<DQ, number | null> = {
  A: 0.5,
  B: 0.4,
  C: 0.3,
  D: 0.2,
  E: null,
};

export const EV_MINIMO_BASE: Record<DQ, number | null> = {
  A: 0.02,
  B: 0.03,
  C: 0.04,
  D: null,
  E: null,
};

/** EV acima disso em mercado principal = presumir erro → INVESTIGAR. */
export const EV_SANIDADE = 0.25;
export const W_MAX_NIVEL3 = 0.3;

export interface FlagsPeso {
  mercadoMuitoLiquido?: boolean;
  escalacaoIncerta?: boolean;
  nivel3?: boolean;
}

/** w do blend. null = DQ E (sem modelo no blend). */
export function pesoModelo(dq: DQ, f: FlagsPeso = {}): number | null {
  const base = PESO_MODELO_BASE[dq];
  if (base === null) return null;
  let w = base - (f.mercadoMuitoLiquido || f.escalacaoIncerta ? 0.1 : 0);
  if (f.nivel3) w = Math.min(w, W_MAX_NIVEL3);
  return Math.max(0, Math.round(w * 100) / 100);
}

/** P_final = w × P_modelo + (1 − w) × P_market */
export function blend(pModelo: number, pMercado: number, w: number): number {
  return w * pModelo + (1 - w) * pMercado;
}

export function oddJusta(p: number): number {
  return 1 / p;
}

export interface FlagsGate {
  mercadoPoucoLiquido?: boolean;
  escalacaoIncerta?: boolean;
  modelosDivergentes?: boolean;
  lambdaLargo?: boolean;
  nivel3?: boolean;
  odd?: number;
}

/**
 * EV mínimo para BET. null = DQ D/E (sem BET).
 * Cada agravante soma +1 pp (escolha conservadora); escanteios/cartões +1 pp; odd > 8 +3 pp.
 */
export function evMinimo(dq: DQ, f: FlagsGate = {}): number | null {
  const base = EV_MINIMO_BASE[dq];
  if (base === null) return null;
  const agravantes = [
    f.mercadoPoucoLiquido,
    f.escalacaoIncerta,
    f.modelosDivergentes,
    f.lambdaLargo,
    f.nivel3,
  ].filter(Boolean).length;
  return base + 0.01 * agravantes + (f.odd !== undefined && f.odd > 8 ? 0.03 : 0);
}

export interface PriceGate {
  pFinalInferior: number;
  oddMinima: number;
}

/**
 * P_final_inferior = w × P_modelo_inferior + (1 − w) × P_market
 * Odd mínima = (1 + EV_mínimo / emRisco) / P_final_inferior
 * (emRisco = 1 em mercado sem push; com push o EV é proporcional à fração em risco)
 */
export function priceGate(p: {
  w: number;
  pModeloInferior: number;
  pMercado: number;
  evMinimo: number;
  emRisco?: number;
}): PriceGate {
  const pFinalInferior = blend(p.pModeloInferior, p.pMercado, p.w);
  const emRisco = p.emRisco ?? 1;
  return { pFinalInferior, oddMinima: (1 + p.evMinimo / emRisco) / pFinalInferior };
}
