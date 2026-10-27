/**
 * V4.0 S4 — EV real de promoções, sempre contra o P_true da referência.
 * Valores em R$; EV > 0 = aceitar. Prazo do bônus não entra na conta (avaliar à parte).
 */

export interface ResultadoPromocao {
  ev: number;
  /** EV por R$ de stake/bônus */
  evRelativo: number;
  aceitar: boolean;
  explicacao: string;
}

const r2 = (x: number) => x.toFixed(2).replace('.', ',');
const conclusao = (ev: number, base: number, explicacao: string): ResultadoPromocao => ({
  ev,
  evRelativo: base > 0 ? ev / base : 0,
  aceitar: ev > 0,
  explicacao,
});

/** Odd turbinada: EV = P_true × odd_turbinada − 1 (por R$ apostado). */
export function evOddTurbinada(pTrue: number, oddTurbinada: number, stake = 1): ResultadoPromocao {
  const ev = stake * (pTrue * oddTurbinada - 1);
  return conclusao(
    ev,
    stake,
    `P_true ${r2(pTrue * 100)}% × odd ${r2(oddTurbinada)} − 1; odd justa ${r2(1 / pTrue)}`,
  );
}

/** Aposta grátis (freebet): a stake não volta, só o lucro. EV = valor × P × (odd − 1). */
export function evApostaGratis(valor: number, odd: number, pTrue: number): ResultadoPromocao {
  const ev = valor * pTrue * (odd - 1);
  return conclusao(
    ev,
    valor,
    `freebet de R$ ${r2(valor)} rende em média ${r2((ev / valor) * 100)}% do valor (melhor em odds altas com P_true bem medido)`,
  );
}

/**
 * Aposta "sem risco": se perder, a casa devolve uma fração `reembolso` da stake
 * (1 = dinheiro; ~0,7 se vier como freebet).
 */
export function evSemRisco(
  stake: number,
  odd: number,
  pTrue: number,
  reembolso: number,
): ResultadoPromocao {
  const ev = stake * (pTrue * (odd - 1) - (1 - pTrue) * (1 - reembolso));
  return conclusao(
    ev,
    stake,
    `ganha ${r2(stake * (odd - 1))} com ${r2(pTrue * 100)}%; perdendo, volta ${r2(reembolso * 100)}% da stake`,
  );
}

/**
 * Bônus com rollover: volume a apostar = multiplicador × base. Apostando em mercados com
 * margem m, a perda esperada por R$ apostado é m / (1 + m).
 */
export function evBonusRollover(p: {
  bonus: number;
  deposito: number;
  multiplicador: number;
  /** sobre o que incide o rollover */
  base: 'bonus' | 'deposito+bonus';
  /** margem média dos mercados usados para cumprir (ex.: 0,04 em mercado principal) */
  margem: number;
}): ResultadoPromocao & { volume: number; custo: number } {
  const volume = p.multiplicador * (p.base === 'bonus' ? p.bonus : p.deposito + p.bonus);
  const custo = (volume * p.margem) / (1 + p.margem);
  const ev = p.bonus - custo;
  return {
    ...conclusao(
      ev,
      p.bonus,
      `rollover de R$ ${r2(volume)} em mercados com ${r2(p.margem * 100)}% de margem custa ~R$ ${r2(custo)} contra R$ ${r2(p.bonus)} de bônus`,
    ),
    volume,
    custo,
  };
}
