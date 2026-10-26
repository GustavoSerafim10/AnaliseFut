/**
 * Seções 9.4 e 16.3 — confronto λ_modelo × λ_market.
 */
import type { Lambdas } from './tipos';

export const LIMITE_DIVERGENCIA_TIME = 0.35;
export const LIMITE_DIVERGENCIA_TOTAL = 0.4;

export interface ContextoLambda {
  /** 16.3: favorito de liga mais forte contra time de liga mais fraca */
  favoritoLigaMaisForte?: boolean;
  /** 9.4: limitação conhecida do modelo (prior neutro, amostra curta, liga mais fraca…) */
  limitacaoConhecida?: string;
  /** fato concreto e verificável que justifica manter a divergência */
  explicacaoDivergencia?: string;
}

export interface ResultadoAjusteLambda {
  lambdas: Lambdas;
  ajustes: string[];
  alertas: string[];
}

const f2 = (x: number) => x.toFixed(2).replace('.', ',');
const clamp = (x: number, lim: number) => Math.max(-lim, Math.min(lim, x));

export function ajustarLambdaModelo(
  modelo: Lambdas,
  mercado: Lambdas | null,
  ctx: ContextoLambda = {},
): ResultadoAjusteLambda {
  const ajustes: string[] = [];
  const alertas: string[] = [];
  if (!mercado) {
    alertas.push('sem λ_market: checagem 9.4 não foi feita');
    return { lambdas: { ...modelo }, ajustes, alertas };
  }
  let { casa, fora } = modelo;

  // 16.3 — o modelo encolhe o favorito de liga mais forte. Até a calibração provar o contrário,
  // adota a supremacia do mercado e mantém só a visão de total do modelo.
  if (ctx.favoritoLigaMaisForte) {
    const supMercado = mercado.casa - mercado.fora;
    const supModelo = casa - fora;
    const encolheu = supMercado >= 0 ? supModelo < supMercado : supModelo > supMercado;
    if (encolheu) {
      const total = casa + fora;
      casa = Math.max(0.05, (total + supMercado) / 2);
      fora = Math.max(0.05, (total - supMercado) / 2);
      ajustes.push(
        `16.3 viés conhecido: supremacia do modelo (${f2(supModelo)}) trocada pela do mercado (${f2(supMercado)}); total do modelo mantido → λ ${f2(casa)} × ${f2(fora)}`,
      );
    }
  }

  // 9.4 — "o que o mercado sabe que eu não sei?"
  const dC = casa - mercado.casa;
  const dF = fora - mercado.fora;
  const dT = dC + dF;
  if (
    Math.abs(dC) > LIMITE_DIVERGENCIA_TIME ||
    Math.abs(dF) > LIMITE_DIVERGENCIA_TIME ||
    Math.abs(dT) > LIMITE_DIVERGENCIA_TOTAL
  ) {
    alertas.push(
      `9.4: λ_modelo diverge do λ_market (casa ${f2(dC)}, fora ${f2(dF)}, total ${f2(dT)}) — o que o mercado sabe que eu não sei?`,
    );
    if (ctx.explicacaoDivergencia) {
      ajustes.push(`9.4: divergência mantida por fato concreto: ${ctx.explicacaoDivergencia}`);
    } else {
      let nc = clamp(dC, LIMITE_DIVERGENCIA_TIME);
      let nf = clamp(dF, LIMITE_DIVERGENCIA_TIME);
      const nt = nc + nf;
      if (Math.abs(nt) > LIMITE_DIVERGENCIA_TOTAL) {
        const s = LIMITE_DIVERGENCIA_TOTAL / Math.abs(nt);
        nc *= s;
        nf *= s;
      }
      casa = mercado.casa + nc;
      fora = mercado.fora + nf;
      ajustes.push(
        `9.4: λ_modelo movido em direção ao λ_market até o limite de tolerância (${ctx.limitacaoConhecida ?? 'sem explicação concreta'}) → λ ${f2(casa)} × ${f2(fora)}`,
      );
    }
  }

  return { lambdas: { casa, fora }, ajustes, alertas };
}
