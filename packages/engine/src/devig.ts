/**
 * Seção 11 — margem e remoção da margem (de-vig).
 * Proporcional por padrão; método da potência quando há favorito < 1,40 ou azarão > 8,00
 * (o proporcional infla o azarão — lição 4 do Viking a 11,2).
 * V4.0: no 1X2 da referência, método de Shin (a margem fica concentrada no azarão).
 */

export type MetodoDevig = 'proporcional' | 'potencia' | 'shin';

export const FAVORITO_POTENCIA = 1.4;
export const AZARAO_POTENCIA = 8.0;

function validarOdds(odds: number[]): void {
  if (odds.length < 2) throw new Error('de-vig precisa de pelo menos 2 lados do mercado');
  for (const o of odds) {
    if (!Number.isFinite(o) || o <= 1) throw new Error(`odd inválida: ${o}`);
  }
}

/** Overround: Σ(1/odd) − 1 */
export function margem(odds: number[]): number {
  return odds.reduce((s, o) => s + 1 / o, 0) - 1;
}

export function devigProporcional(odds: number[]): number[] {
  validarOdds(odds);
  const raw = odds.map((o) => 1 / o);
  const soma = raw.reduce((s, p) => s + p, 0);
  return raw.map((p) => p / soma);
}

/** Acha k tal que Σ p_raw^k = 1 (bisseção) e devolve p_raw^k. */
export function devigPotencia(odds: number[]): number[] {
  validarOdds(odds);
  const raw = odds.map((o) => 1 / o);
  const f = (k: number) => raw.reduce((s, p) => s + p ** k, 0) - 1;
  // f é decrescente em k; f(0) = n − 1 > 0
  let lo = 0;
  let hi = 1;
  if (f(1) > 0) {
    lo = 1;
    while (f(hi) > 0) hi *= 2;
  }
  for (let i = 0; i < 200; i++) {
    const k = (lo + hi) / 2;
    if (f(k) > 0) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  const probs = raw.map((p) => p ** k);
  const soma = probs.reduce((s, p) => s + p, 0);
  return probs.map((p) => p / soma);
}

/**
 * Shin: supõe uma fração z de apostadores com informação privilegiada e acha z tal que
 * Σ p_i = 1, com p_i = (√(z² + 4(1−z)·π_i²/S) − z) / (2(1−z)), π_i = 1/odd_i, S = Σπ_i.
 */
export function devigShin(odds: number[]): number[] {
  validarOdds(odds);
  const raw = odds.map((o) => 1 / o);
  const S = raw.reduce((s, p) => s + p, 0);
  if (S <= 1) return raw.map((p) => p / S);
  const probs = (z: number) =>
    raw.map((pi) => (Math.sqrt(z * z + (4 * (1 - z) * pi * pi) / S) - z) / (2 * (1 - z)));
  const soma = (z: number) => probs(z).reduce((s, p) => s + p, 0) - 1;
  // soma(0) = √S − 1 > 0 e decresce com z
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 200; i++) {
    const z = (lo + hi) / 2;
    if (soma(z) > 0) lo = z;
    else hi = z;
  }
  const p = probs((lo + hi) / 2);
  const t = p.reduce((s, x) => s + x, 0);
  return p.map((x) => x / t);
}

export function escolherMetodo(odds: number[]): MetodoDevig {
  return Math.min(...odds) < FAVORITO_POTENCIA || Math.max(...odds) > AZARAO_POTENCIA
    ? 'potencia'
    : 'proporcional';
}

export interface ResultadoDevig {
  probs: number[];
  metodo: MetodoDevig;
  margem: number;
}

export function removerMargem(
  odds: number[],
  metodo: MetodoDevig = escolherMetodo(odds),
): ResultadoDevig {
  const probs =
    metodo === 'potencia'
      ? devigPotencia(odds)
      : metodo === 'shin'
        ? devigShin(odds)
        : devigProporcional(odds);
  return { probs, metodo, margem: margem(odds) };
}
