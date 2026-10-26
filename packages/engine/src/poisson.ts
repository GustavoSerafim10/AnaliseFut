/**
 * Seção 10 — distribuição de placares: Poisson independente + ajuste Dixon-Coles
 * nos placares baixos (0-0, 1-0, 0-1, 1-1), matriz normalizada.
 */

export const RHO_PADRAO = -0.08;
export const MAX_GOLS = 12;

/** matriz[golsCasa][golsFora] = probabilidade do placar */
export type MatrizPlacar = number[][];

export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda < 0) throw new Error(`λ inválido: ${lambda}`);
  if (lambda === 0) return k === 0 ? 1 : 0;
  // em log para não estourar o fatorial
  let log = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) log -= Math.log(i);
  return Math.exp(log);
}

/** Fator τ de Dixon-Coles. Com ρ < 0 sobem 0-0 e 1-1 e caem 1-0 e 0-1. */
export function tauDixonColes(gc: number, gf: number, lc: number, lf: number, rho: number): number {
  if (gc === 0 && gf === 0) return 1 - lc * lf * rho;
  if (gc === 0 && gf === 1) return 1 + lc * rho;
  if (gc === 1 && gf === 0) return 1 + lf * rho;
  if (gc === 1 && gf === 1) return 1 - rho;
  return 1;
}

export function matrizPlacares(
  lc: number,
  lf: number,
  rho: number = RHO_PADRAO,
  maxGols: number = MAX_GOLS,
): MatrizPlacar {
  const pc = Array.from({ length: maxGols + 1 }, (_, k) => poissonPmf(k, lc));
  const pf = Array.from({ length: maxGols + 1 }, (_, k) => poissonPmf(k, lf));
  const m: MatrizPlacar = [];
  let soma = 0;
  for (let i = 0; i <= maxGols; i++) {
    const linha: number[] = [];
    for (let j = 0; j <= maxGols; j++) {
      const v = pc[i] * pf[j] * Math.max(0, tauDixonColes(i, j, lc, lf, rho));
      linha.push(v);
      soma += v;
    }
    m.push(linha);
  }
  for (const linha of m) for (let j = 0; j < linha.length; j++) linha[j] /= soma;
  return m;
}

export interface Prob1X2 {
  casa: number;
  empate: number;
  fora: number;
}

export function probabilidades1X2(m: MatrizPlacar): Prob1X2 {
  let casa = 0;
  let empate = 0;
  let fora = 0;
  m.forEach((linha, i) =>
    linha.forEach((p, j) => {
      if (i > j) casa += p;
      else if (i === j) empate += p;
      else fora += p;
    }),
  );
  return { casa, empate, fora };
}

export interface PlacarProvavel {
  casa: number;
  fora: number;
  p: number;
}

export function placaresMaisProvaveis(m: MatrizPlacar, n = 3): PlacarProvavel[] {
  const todos: PlacarProvavel[] = [];
  m.forEach((linha, i) => linha.forEach((p, j) => todos.push({ casa: i, fora: j, p })));
  return todos.sort((a, b) => b.p - a.p).slice(0, n);
}
