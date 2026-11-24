/**
 * Probabilidade do modelo recalculada a partir do que a evidência gravou, pelo MESMO caminho da
 * V4 (v4.ts): criarModelo(λ, ρ padrão, fração do 1º tempo padrão, contagens) → liquidador da
 * seleção → distribuicaoModelo → probEfetiva. E2: usa o motor atual; a conferência contra os
 * valores gravados (em derivar.ts) detecta qualquer diferença de versão.
 *
 *  - λ bruto: conteudo.modelo.lambda.lambdas (antes do ajuste 9.4)
 *  - λ ajustado: conteudo.avaliacao.v33.lambdaModelo.ajustado — o que a V4 usou (sem V3.3, a V4
 *    usou o próprio λ bruto, e aqui também)
 *  - w: pesoModelo(DQ, {mercado muito líquido, escalação incerta, nicho}) — escalação incerta =
 *    caixinha do Contexto OU leitura da escalação, como em dados.ts
 */
import {
  FRACAO_1T,
  RHO_PADRAO,
  criarLiquidador,
  criarModelo,
  distribuicaoModelo,
  faltaNoModelo,
  pesoModelo,
  probEfetiva,
  type DQ,
  type LambdasContagem,
  type LinhaOdd,
} from '@pe/engine';
import type { Evidencia } from '../../../../apps/web/src/evidencias';

interface Lambdas {
  casa: number;
  fora: number;
}

export interface InsumosModelo {
  lambdasBruto: Lambdas | null;
  lambdasAjustado: Lambdas | null;
  contagens: LambdasContagem;
  dq: DQ | null;
  mercadoMuitoLiquido: boolean;
  escalacaoIncerta: boolean;
}

const lambdasValidos = (x: unknown): Lambdas | null => {
  const l = x as { casa?: unknown; fora?: unknown } | null | undefined;
  return l &&
    typeof l.casa === 'number' &&
    typeof l.fora === 'number' &&
    Number.isFinite(l.casa) &&
    Number.isFinite(l.fora) &&
    l.casa >= 0 &&
    l.fora >= 0
    ? { casa: l.casa, fora: l.fora }
    : null;
};

const DQS = new Set(['A', 'B', 'C', 'D', 'E']);

export function insumosDaEvidencia(ev: Evidencia): InsumosModelo {
  const c = ev.conteudo as unknown as {
    modelo?: {
      lambda?: { lambdas?: unknown } | null;
      contagens?: Record<string, { lambdas?: unknown } | null> | null;
      dq?: { dq?: unknown } | null;
      escalacao?: { incerta?: unknown } | null;
    };
    parametros?: { config?: { mercadoMuitoLiquido?: unknown; escalacaoIncerta?: unknown } };
    avaliacao?: { v33?: { lambdaModelo?: { ajustado?: unknown } } | null };
  };
  const bruto = lambdasValidos(c.modelo?.lambda?.lambdas);
  const ajustadoGravado = c.avaliacao?.v33?.lambdaModelo?.ajustado;
  const contagens: LambdasContagem = {};
  for (const [e, x] of Object.entries(c.modelo?.contagens ?? {})) {
    const l = lambdasValidos(x?.lambdas);
    if (l && (e === 'escanteios' || e === 'cartoes')) contagens[e] = l;
  }
  const dq = c.modelo?.dq?.dq;
  return {
    lambdasBruto: bruto,
    // como em dados.ts: apoio.lambdas = resultado?.lambdaModelo.ajustado ?? lambda.lambdas
    lambdasAjustado: bruto
      ? ajustadoGravado === undefined || ajustadoGravado === null
        ? bruto
        : lambdasValidos(ajustadoGravado)
      : null,
    contagens,
    dq: typeof dq === 'string' && DQS.has(dq) ? (dq as DQ) : null,
    mercadoMuitoLiquido: c.parametros?.config?.mercadoMuitoLiquido === true,
    escalacaoIncerta:
      c.parametros?.config?.escalacaoIncerta === true || c.modelo?.escalacao?.incerta === true,
  };
}

/** P do modelo de uma linha com os λ dados; null quando o motor não liquida ou o modelo não cobre. */
export function pModeloDe(
  linha: LinhaOdd,
  lambdas: Lambdas,
  contagens: LambdasContagem,
): { p: number | null; nivel: 1 | 2 | 3; motivo: string | null } {
  const r = criarLiquidador(linha);
  if (!r.ok) return { p: null, nivel: r.nivel, motivo: r.motivo };
  const m = criarModelo(lambdas, RHO_PADRAO, FRACAO_1T, contagens);
  const falta = faltaNoModelo(r.liq, m);
  if (falta) return { p: null, nivel: r.nivel, motivo: falta };
  return { p: probEfetiva(distribuicaoModelo(r.liq, m)), nivel: r.nivel, motivo: null };
}

/** Peso do modelo como a V4 e a lista calculam (teto no nicho). null = DQ E ou sem DQ. */
export function wDe(ins: InsumosModelo, nivel: 1 | 2 | 3): number | null {
  if (!ins.dq) return null;
  return pesoModelo(ins.dq, {
    mercadoMuitoLiquido: ins.mercadoMuitoLiquido,
    escalacaoIncerta: ins.escalacaoIncerta,
    nivel3: nivel === 3,
  });
}
