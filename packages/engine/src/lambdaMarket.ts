/**
 * Seção 9.1 — λ_market: (λ_casa, λ_fora) ajustados por mínimos quadrados em TODAS as
 * linhas sem margem (1X2, totais e gols por time). Nunca uma linha só (lição 1).
 */
import { probEfetiva } from './liquidacao';
import {
  criarLiquidador,
  criarModelo,
  distribuicaoModelo,
  normalizarLado,
  type Liquidador,
} from './mercados';
import { poissonPmf, RHO_PADRAO } from './poisson';
import type { SelecaoPrecificada } from './precificacao';
import type { Lambdas, TipoMercado, Time } from './tipos';

export const LIMITE_COERENCIA = 0.15;

export interface ObservacaoMercado {
  chave: string;
  mercado: TipoMercado;
  linha?: number;
  time?: Time;
  pAlvo: number;
  liq: Liquidador;
}

export interface CoerenciaTime {
  lambdasPorLinha: { linha: number; lambda: number }[];
  amplitude: number;
  coerente: boolean;
}

export interface LambdaMercado extends Lambdas {
  total: number;
  /** soma dos quadrados dos resíduos */
  sse: number;
  residuos: { chave: string; pAlvo: number; pAjustada: number }[];
  coerencia: { casa: CoerenciaTime | null; fora: CoerenciaTime | null };
  /** false = casa precifica cauda mais larga que a Poisson → λ_market só referência */
  coerente: boolean;
}

/** Seleções usadas no ajuste: 1X2, totais (lado over) e gols por time (lado over), jogo todo. */
export function observacoesParaLambda(selecoes: SelecaoPrecificada[]): ObservacaoMercado[] {
  const obs: ObservacaoMercado[] = [];
  for (const s of selecoes) {
    const l = s.linha;
    if (l.periodo !== 'FT') continue;
    const lado = normalizarLado(l.lado);
    const usa =
      l.mercado === '1X2' ||
      ((l.mercado === 'total' || l.mercado === 'total_time') && lado === 'over');
    if (!usa) continue;
    const r = criarLiquidador(l);
    if (!r.ok) continue;
    obs.push({
      chave: s.chave,
      mercado: l.mercado,
      linha: l.linha,
      time: l.time,
      pAlvo: s.pMercado,
      liq: r.liq,
    });
  }
  return obs;
}

function sse(obs: ObservacaoMercado[], lc: number, lf: number, rho: number): number {
  const m = criarModelo({ casa: lc, fora: lf }, rho);
  return obs.reduce((s, o) => s + (probEfetiva(distribuicaoModelo(o.liq, m)) - o.pAlvo) ** 2, 0);
}

function buscaGrade(
  f: (a: number, b: number) => number,
  centro: [number, number] | null,
  raio: number,
  passo: number,
): [number, number] {
  const min = 0.05;
  const max = 6;
  const [a0, a1] = centro
    ? [Math.max(min, centro[0] - raio), Math.min(max, centro[0] + raio)]
    : [0.1, 5];
  const [b0, b1] = centro
    ? [Math.max(min, centro[1] - raio), Math.min(max, centro[1] + raio)]
    : [0.1, 5];
  let melhor: [number, number] = [a0, b0];
  let melhorV = Infinity;
  for (let a = a0; a <= a1 + 1e-9; a += passo)
    for (let b = b0; b <= b1 + 1e-9; b += passo) {
      const v = f(a, b);
      if (v < melhorV) {
        melhorV = v;
        melhor = [a, b];
      }
    }
  return melhor;
}

/** λ que reproduz P(gols do time > linha) numa Poisson pura (só meia linha). */
function lambdaImplicito(pOver: number, linha: number): number {
  const k = Math.floor(linha);
  const pOverDe = (lam: number) => {
    let acum = 0;
    for (let i = 0; i <= k; i++) acum += poissonPmf(i, lam);
    return 1 - acum;
  };
  let lo = 1e-4;
  let hi = 12;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (pOverDe(mid) < pOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function coerenciaDoTime(obs: ObservacaoMercado[], time: Time): CoerenciaTime | null {
  const linhas = obs
    .filter(
      (o) =>
        o.mercado === 'total_time' &&
        o.time === time &&
        o.linha !== undefined &&
        Math.abs((o.linha * 2) % 2) === 1,
    )
    .map((o) => ({
      linha: o.linha as number,
      lambda: lambdaImplicito(o.pAlvo, o.linha as number),
    }));
  if (linhas.length < 2) return null;
  const ls = linhas.map((x) => x.lambda);
  const amplitude = Math.max(...ls) - Math.min(...ls);
  return { lambdasPorLinha: linhas, amplitude, coerente: amplitude <= LIMITE_COERENCIA };
}

export function ajustarLambdaMercado(
  obs: ObservacaoMercado[],
  rho: number = RHO_PADRAO,
): LambdaMercado | { erro: string } {
  const tem1x2 = obs.some((o) => o.mercado === '1X2');
  const timesComLinha = new Set(obs.filter((o) => o.mercado === 'total_time').map((o) => o.time));
  const mercados = new Set(obs.map((o) => o.mercado));
  if (obs.length < 3 || mercados.size < 2 || (!tem1x2 && timesComLinha.size < 2)) {
    return {
      erro: 'λ_market exige várias linhas sem margem (1X2 + totais e/ou gols por time). Nunca uma linha só.',
    };
  }

  const f = (a: number, b: number) => sse(obs, a, b, rho);
  let p = buscaGrade(f, null, 0, 0.1);
  p = buscaGrade(f, p, 0.1, 0.01);
  p = buscaGrade(f, p, 0.01, 0.001);
  const [casa, fora] = p;

  const m = criarModelo({ casa, fora }, rho);
  const residuos = obs.map((o) => ({
    chave: o.chave,
    pAlvo: o.pAlvo,
    pAjustada: probEfetiva(distribuicaoModelo(o.liq, m)),
  }));
  const coerencia = { casa: coerenciaDoTime(obs, 'casa'), fora: coerenciaDoTime(obs, 'fora') };
  const coerente = (coerencia.casa?.coerente ?? true) && (coerencia.fora?.coerente ?? true);

  return { casa, fora, total: casa + fora, sse: f(casa, fora), residuos, coerencia, coerente };
}
