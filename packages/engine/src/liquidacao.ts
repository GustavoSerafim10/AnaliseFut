/**
 * Liquidação de apostas com linha (AH e totais), incluindo push e linhas de quarto,
 * e o EV "de verdade" para mercados com devolução (seção 13).
 *
 * Resultado por unidade apostada: 1 ganho · 0.5 meio-ganho · 0 push · −0.5 meia-perda · −1 perda.
 */

const EPS = 1e-9;

function liquidarSimples(x: number): number {
  if (x > EPS) return 1;
  if (x < -EPS) return -1;
  return 0;
}

/**
 * Liquida `valor + linha`. Linhas de quarto (x.25 / x.75) dividem a aposta em duas
 * metades: uma em linha − 0.25 e outra em linha + 0.25.
 * AH casa: liquidarLinha(golsCasa − golsFora, linha) · Over L: liquidarLinha(gols, −L)
 * Under L: liquidarLinha(−gols, L).
 */
export function liquidarLinha(valor: number, linha: number): number {
  const quartos = Math.round(linha * 4);
  if (Math.abs(quartos % 2) === 1) {
    return (liquidarSimples(valor + linha - 0.25) + liquidarSimples(valor + linha + 0.25)) / 2;
  }
  return liquidarSimples(valor + linha);
}

export function ehLinhaDeQuarto(linha: number): boolean {
  return Math.abs(Math.round(linha * 4) % 2) === 1;
}

export interface DistribuicaoResultado {
  ganho: number;
  meioGanho: number;
  push: number;
  meiaPerda: number;
  perda: number;
}

export function distribuicaoVazia(): DistribuicaoResultado {
  return { ganho: 0, meioGanho: 0, push: 0, meiaPerda: 0, perda: 0 };
}

export function somarResultado(d: DistribuicaoResultado, resultado: number, p: number): void {
  if (resultado === 1) d.ganho += p;
  else if (resultado === 0.5) d.meioGanho += p;
  else if (resultado === 0) d.push += p;
  else if (resultado === -0.5) d.meiaPerda += p;
  else d.perda += p;
}

/**
 * Probabilidade efetiva: a probabilidade binária equivalente (sem push), ou seja,
 * 1 / odd justa. Num mercado de 2 lados com push é o que o de-vig devolve.
 */
export function probEfetiva(d: DistribuicaoResultado): number {
  const a = d.ganho + d.meioGanho / 2;
  const b = d.perda + d.meiaPerda / 2;
  return a / (a + b);
}

/** Fração da aposta realmente em risco (1 − push − metades devolvidas). */
export function fracaoEmRisco(d: DistribuicaoResultado): number {
  return d.ganho + d.meioGanho / 2 + d.perda + d.meiaPerda / 2;
}

/** EV exato por unidade apostada. */
export function evExato(d: DistribuicaoResultado, odd: number): number {
  return d.ganho * (odd - 1) + (d.meioGanho * (odd - 1)) / 2 - d.meiaPerda / 2 - d.perda;
}

/**
 * Mesmo EV escrito em função da probabilidade efetiva:
 * EV = emRisco × (p_efetiva × odd − 1). Permite misturar P_modelo e P_market (blend)
 * e continuar com push e meios resultados contados corretamente.
 */
export function evPorProbEfetiva(pEfetiva: number, odd: number, emRisco = 1): number {
  return emRisco * (pEfetiva * odd - 1);
}
