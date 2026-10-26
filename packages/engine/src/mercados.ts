/**
 * Seções 10 e 19 — como cada mercado é liquidado a partir do placar, e a probabilidade
 * do modelo para qualquer seleção (nível 1: placar final · nível 2: por tempo/sequência).
 * Nível 3 (escanteios, cartões, chutes) só com modelo próprio → Fase 5.
 */
import {
  distribuicaoVazia,
  liquidarLinha,
  somarResultado,
  type DistribuicaoResultado,
} from './liquidacao';
import { matrizPlacares, RHO_PADRAO, type MatrizPlacar } from './poisson';
import type { Lambdas, LinhaOdd, Periodo, TipoMercado } from './tipos';

export const FRACAO_1T = 0.45;
const MAX_GOLS_TEMPO = 10;

export const MERCADOS_NIVEL3: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'escanteios_total',
  'escanteios_time',
  'escanteios_ah',
  'escanteios_1x2',
  'primeiro_escanteio',
  'cartoes_ah',
  'chutes_ah',
  'impedimentos_ah',
]);

type Res1X2 = '1' | 'x' | '2';
const res = (c: number, f: number): Res1X2 => (c > f ? '1' : c < f ? '2' : 'x');
const binario = (ganhou: boolean) => (ganhou ? 1 : -1);

export type Liquidador =
  | { tipo: 'placar'; periodo: Periodo; fn: (c: number, f: number) => number }
  | { tipo: 'tempos'; fn: (c1: number, f1: number, c2: number, f2: number) => number }
  | { tipo: 'sequencia'; lado: 'casa' | 'fora' | 'nenhum' };

export type ResultadoLiquidador =
  { ok: true; liq: Liquidador; nivel: 1 | 2 } | { ok: false; motivo: string; nivel: 1 | 2 | 3 };

export function normalizarLado(lado: string): string {
  return lado.trim().toLowerCase().replace(/\s+/g, '');
}

function ehMeiaLinha(l: number): boolean {
  return Math.abs((l * 2) % 2) === 1;
}

function overUnder(
  linha: number | undefined,
  lado: string,
  gols: (c: number, f: number) => number,
): ((c: number, f: number) => number) | string {
  if (linha === undefined || !Number.isFinite(linha)) return 'linha ausente';
  if (lado === 'over') return (c, f) => liquidarLinha(gols(c, f), -linha);
  if (lado === 'under') return (c, f) => liquidarLinha(-gols(c, f), linha);
  return `lado inválido (use over/under): ${lado}`;
}

/** Condição simples de over/under para combos (só meia linha, sem push). */
function condicaoTotal(lado: string, linha: number | undefined): ((g: number) => boolean) | string {
  if (linha === undefined || !ehMeiaLinha(linha)) return 'combo exige linha de meio gol (ex.: 2.5)';
  if (lado === 'over') return (g) => g > linha;
  if (lado === 'under') return (g) => g < linha;
  return `lado de total inválido: ${lado}`;
}

function liquidadorPlacar(l: LinhaOdd): ((c: number, f: number) => number) | string {
  const lado = normalizarLado(l.lado);
  const L = l.linha;
  const gTime = (c: number, f: number) => (l.time === 'casa' ? c : f);

  switch (l.mercado) {
    case '1X2':
      if (lado !== '1' && lado !== 'x' && lado !== '2') return `lado inválido para 1X2: ${l.lado}`;
      return (c, f) => binario(res(c, f) === lado);
    case 'DC':
      if (!['1x', '12', 'x2'].includes(lado)) return `lado inválido para DC: ${l.lado}`;
      return (c, f) => binario(lado.includes(res(c, f)));
    case 'DNB':
      if (lado !== '1' && lado !== '2') return `lado inválido para DNB: ${l.lado}`;
      return (c, f) => (c === f ? 0 : binario(res(c, f) === lado));
    case 'AH': {
      if (L === undefined) return 'linha ausente';
      if (lado !== 'casa' && lado !== 'fora') return `lado inválido para AH (casa/fora): ${l.lado}`;
      return (c, f) => liquidarLinha(lado === 'casa' ? c - f : f - c, L);
    }
    case 'AH_europeu': {
      if (L === undefined || !Number.isInteger(L))
        return 'AH europeu exige linha inteira (handicap da casa)';
      if (lado !== '1' && lado !== 'x' && lado !== '2') return `lado inválido: ${l.lado}`;
      return (c, f) => binario(res(c + L, f) === lado);
    }
    case 'total':
      return overUnder(L, lado, (c, f) => c + f);
    case 'total_time':
      if (!l.time) return 'total_time exige o campo time (casa/fora)';
      return overUnder(L, lado, gTime);
    case 'ambas':
      if (lado !== 'sim' && lado !== 'nao') return `lado inválido (sim/nao): ${l.lado}`;
      return (c, f) => binario((c > 0 && f > 0) === (lado === 'sim'));
    case 'par_impar':
      if (lado !== 'par' && lado !== 'impar') return `lado inválido (par/impar): ${l.lado}`;
      return (c, f) => binario(((c + f) % 2 === 0) === (lado === 'par'));
    case 'vencer_sem_sofrer': {
      if (!l.time) return 'vencer_sem_sofrer exige o campo time';
      if (lado !== 'sim' && lado !== 'nao') return `lado inválido (sim/nao): ${l.lado}`;
      const time = l.time;
      return (c, f) => {
        const venceu = time === 'casa' ? c > f && f === 0 : f > c && c === 0;
        return binario(venceu === (lado === 'sim'));
      };
    }
    case 'placar_exato': {
      const m = /^(\d+)[-x:](\d+)$/.exec(lado);
      if (!m) return `placar inválido: ${l.lado}`;
      const a = Number(m[1]);
      const b = Number(m[2]);
      return (c, f) => binario(c === a && f === b);
    }
    case 'n_exato_gols': {
      const m = /^(\d+)(\+)?$/.exec(lado);
      if (!m) return `número de gols inválido: ${l.lado}`;
      const n = Number(m[1]);
      const ouMais = m[2] === '+';
      return (c, f) => binario(ouMais ? c + f >= n : c + f === n);
    }
    case 'combo_resultado_total': {
      const [r, t] = lado.split('&');
      if (r !== '1' && r !== 'x' && r !== '2') return `combo inválido: ${l.lado}`;
      const cond = condicaoTotal(t ?? '', L);
      if (typeof cond === 'string') return cond;
      return (c, f) => binario(res(c, f) === r && cond(c + f));
    }
    case 'combo_1x2_ambas': {
      const [r, a] = lado.split('&');
      if ((r !== '1' && r !== 'x' && r !== '2') || (a !== 'sim' && a !== 'nao'))
        return `combo inválido: ${l.lado}`;
      return (c, f) => binario(res(c, f) === r && (c > 0 && f > 0) === (a === 'sim'));
    }
    case 'combo_total_ambas': {
      const [t, a] = lado.split('&');
      if (a !== 'sim' && a !== 'nao') return `combo inválido: ${l.lado}`;
      const cond = condicaoTotal(t ?? '', L);
      if (typeof cond === 'string') return cond;
      return (c, f) => binario(cond(c + f) && (c > 0 && f > 0) === (a === 'sim'));
    }
    default:
      return `sem modelo para o mercado ${l.mercado}`;
  }
}

export function criarLiquidador(l: LinhaOdd): ResultadoLiquidador {
  if (MERCADOS_NIVEL3.has(l.mercado)) {
    return {
      ok: false,
      nivel: 3,
      motivo:
        'nível 3 sem modelo próprio ainda (escanteios/cartões/chutes → Fase 5): só informação',
    };
  }
  const lado = normalizarLado(l.lado);

  if (l.mercado === 'intervalo_final') {
    const m = /^([1x2])\/([1x2])$/.exec(lado);
    if (!m) return { ok: false, nivel: 2, motivo: `lado inválido para intervalo/final: ${l.lado}` };
    const [, ht, ft] = m;
    return {
      ok: true,
      nivel: 2,
      liq: {
        tipo: 'tempos',
        fn: (c1, f1, c2, f2) => binario(res(c1, f1) === ht && res(c1 + c2, f1 + f2) === ft),
      },
    };
  }

  if (l.mercado === 'marcar_2_tempos') {
    if (!l.time) return { ok: false, nivel: 2, motivo: 'marcar_2_tempos exige o campo time' };
    if (lado !== 'sim' && lado !== 'nao') return { ok: false, nivel: 2, motivo: 'lado sim/nao' };
    const casa = l.time === 'casa';
    return {
      ok: true,
      nivel: 2,
      liq: {
        tipo: 'tempos',
        fn: (c1, f1, c2, f2) => {
          const marcou = casa ? c1 > 0 && c2 > 0 : f1 > 0 && f2 > 0;
          return binario(marcou === (lado === 'sim'));
        },
      },
    };
  }

  if (l.mercado === 'primeiro_gol' || l.mercado === 'ultimo_gol') {
    if (lado !== 'casa' && lado !== 'fora' && lado !== 'nenhum')
      return { ok: false, nivel: 2, motivo: `lado inválido (casa/fora/nenhum): ${l.lado}` };
    return { ok: true, nivel: 2, liq: { tipo: 'sequencia', lado } };
  }

  const fn = liquidadorPlacar(l);
  if (typeof fn === 'string') return { ok: false, nivel: 1, motivo: fn };
  return {
    ok: true,
    nivel: l.periodo === 'FT' ? 1 : 2,
    liq: { tipo: 'placar', periodo: l.periodo, fn },
  };
}

/** Matrizes do modelo, calculadas sob demanda. */
export interface ModeloPlacar {
  readonly lambdas: Lambdas;
  readonly rho: number;
  readonly fracao1T: number;
  readonly ft: MatrizPlacar;
  readonly t1: MatrizPlacar;
  readonly t2: MatrizPlacar;
}

export function criarModelo(
  lambdas: Lambdas,
  rho: number = RHO_PADRAO,
  fracao1T: number = FRACAO_1T,
): ModeloPlacar {
  let ft: MatrizPlacar | undefined;
  let t1: MatrizPlacar | undefined;
  let t2: MatrizPlacar | undefined;
  return {
    lambdas,
    rho,
    fracao1T,
    get ft() {
      return (ft ??= matrizPlacares(lambdas.casa, lambdas.fora, rho));
    },
    // por tempo: Poisson independente (seção 10), sem Dixon-Coles
    get t1() {
      return (t1 ??= matrizPlacares(
        lambdas.casa * fracao1T,
        lambdas.fora * fracao1T,
        0,
        MAX_GOLS_TEMPO,
      ));
    },
    get t2() {
      return (t2 ??= matrizPlacares(
        lambdas.casa * (1 - fracao1T),
        lambdas.fora * (1 - fracao1T),
        0,
        MAX_GOLS_TEMPO,
      ));
    },
  };
}

export function distribuicaoModelo(liq: Liquidador, m: ModeloPlacar): DistribuicaoResultado {
  const d = distribuicaoVazia();
  if (liq.tipo === 'placar') {
    const mat = liq.periodo === 'FT' ? m.ft : liq.periodo === '1T' ? m.t1 : m.t2;
    mat.forEach((linha, i) => linha.forEach((p, j) => somarResultado(d, liq.fn(i, j), p)));
  } else if (liq.tipo === 'tempos') {
    const t1 = m.t1;
    const t2 = m.t2;
    for (let c1 = 0; c1 < t1.length; c1++)
      for (let f1 = 0; f1 < t1.length; f1++) {
        const p1 = t1[c1][f1];
        if (p1 < 1e-12) continue;
        for (let c2 = 0; c2 < t2.length; c2++)
          for (let f2 = 0; f2 < t2.length; f2++) {
            const p = p1 * t2[c2][f2];
            if (p < 1e-15) continue;
            somarResultado(d, liq.fn(c1, f1, c2, f2), p);
          }
      }
  } else {
    // Processo de Poisson: dado que sai gol, ele é do mandante com prob. λc/(λc+λf)
    // (vale para o primeiro e para o último gol).
    const p00 = m.ft[0][0];
    const { casa, fora } = m.lambdas;
    const total = casa + fora;
    const p =
      liq.lado === 'nenhum'
        ? p00
        : total === 0
          ? 0
          : ((1 - p00) * (liq.lado === 'casa' ? casa : fora)) / total;
    d.ganho = p;
    d.perda = 1 - p;
  }
  return d;
}
