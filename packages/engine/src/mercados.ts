/**
 * Seções 10 e 19 — como cada mercado é liquidado a partir do placar, e a probabilidade
 * do modelo para qualquer seleção (nível 1: placar final · nível 2: por tempo/sequência ·
 * nível 3: escanteios e cartões, com modelo de contagem próprio em contagens.ts).
 */
import {
  FRACAO_1T_CONTAGEM,
  matrizContagem,
  NOME_ESTATISTICA,
  type Estatistica,
} from './contagens';
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
  'cartoes_total',
  'cartoes_time',
  'cartoes_1x2',
  'cartoes_ah',
  'chutes_ah',
  'impedimentos_ah',
]);

/** Mercado de contagem → estatística e mercado de gols que se liquida igual. */
const EQUIVALENTE_NIVEL3: Partial<Record<TipoMercado, [Estatistica, TipoMercado]>> = {
  escanteios_total: ['escanteios', 'total'],
  escanteios_time: ['escanteios', 'total_time'],
  escanteios_ah: ['escanteios', 'AH'],
  escanteios_1x2: ['escanteios', '1X2'],
  cartoes_total: ['cartoes', 'total'],
  cartoes_time: ['cartoes', 'total_time'],
  cartoes_ah: ['cartoes', 'AH'],
  cartoes_1x2: ['cartoes', '1X2'],
};

export function estatisticaDoMercado(m: TipoMercado): Estatistica | null {
  if (m === 'primeiro_escanteio') return 'escanteios';
  return EQUIVALENTE_NIVEL3[m]?.[0] ?? null;
}

type Res1X2 = '1' | 'x' | '2';
const res = (c: number, f: number): Res1X2 => (c > f ? '1' : c < f ? '2' : 'x');
const binario = (ganhou: boolean) => (ganhou ? 1 : -1);

export type Liquidador =
  | { tipo: 'placar'; periodo: Periodo; fn: (c: number, f: number) => number }
  | { tipo: 'tempos'; fn: (c1: number, f1: number, c2: number, f2: number) => number }
  | { tipo: 'sequencia'; lado: 'casa' | 'fora' | 'nenhum' }
  | {
      tipo: 'contagem';
      estatistica: Estatistica;
      periodo: Periodo;
      fn: (c: number, f: number) => number;
    }
  | { tipo: 'primeira_contagem'; estatistica: Estatistica; lado: 'casa' | 'fora' | 'nenhum' };

export type ResultadoLiquidador =
  { ok: true; liq: Liquidador; nivel: 1 | 2 | 3 } | { ok: false; motivo: string; nivel: 1 | 2 | 3 };

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

function liquidadorNivel3(l: LinhaOdd): ResultadoLiquidador {
  const lado = normalizarLado(l.lado);
  if (l.mercado === 'primeiro_escanteio') {
    if (lado !== 'casa' && lado !== 'fora' && lado !== 'nenhum')
      return { ok: false, nivel: 3, motivo: `lado inválido (casa/fora/nenhum): ${l.lado}` };
    if (l.periodo !== 'FT')
      return { ok: false, nivel: 3, motivo: 'primeiro escanteio só no jogo todo' };
    return {
      ok: true,
      nivel: 3,
      liq: { tipo: 'primeira_contagem', estatistica: 'escanteios', lado },
    };
  }
  const eq = EQUIVALENTE_NIVEL3[l.mercado];
  if (!eq)
    return {
      ok: false,
      nivel: 3,
      motivo: 'nível 3 sem modelo próprio (chutes/impedimentos): só informação',
    };
  const [estatistica, mercado] = eq;
  if (l.periodo === '2T')
    return {
      ok: false,
      nivel: 3,
      motivo: `${NOME_ESTATISTICA[estatistica]} do 2º tempo sem modelo`,
    };
  const fn = liquidadorPlacar({ ...l, mercado });
  if (typeof fn === 'string') return { ok: false, nivel: 3, motivo: fn };
  return { ok: true, nivel: 3, liq: { tipo: 'contagem', estatistica, periodo: l.periodo, fn } };
}

export function criarLiquidador(l: LinhaOdd): ResultadoLiquidador {
  if (MERCADOS_NIVEL3.has(l.mercado)) return liquidadorNivel3(l);
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

export type LambdasContagem = Partial<Record<Estatistica, Lambdas>>;

/** Matrizes do modelo, calculadas sob demanda. */
export interface ModeloPlacar {
  readonly lambdas: Lambdas;
  readonly rho: number;
  readonly fracao1T: number;
  /** λ de escanteios/cartões (nível 3); ausente = sem modelo para essa estatística */
  readonly contagens: LambdasContagem;
  readonly ft: MatrizPlacar;
  readonly t1: MatrizPlacar;
  readonly t2: MatrizPlacar;
  contagem(e: Estatistica, periodo: 'FT' | '1T'): MatrizPlacar | null;
}

export function criarModelo(
  lambdas: Lambdas,
  rho: number = RHO_PADRAO,
  fracao1T: number = FRACAO_1T,
  contagens: LambdasContagem = {},
): ModeloPlacar {
  let ft: MatrizPlacar | undefined;
  let t1: MatrizPlacar | undefined;
  let t2: MatrizPlacar | undefined;
  const matrizes = new Map<string, MatrizPlacar>();
  return {
    lambdas,
    rho,
    fracao1T,
    contagens,
    contagem(e, periodo) {
      const l = contagens[e];
      if (!l) return null;
      const k = `${e}|${periodo}`;
      if (!matrizes.has(k))
        matrizes.set(k, matrizContagem(e, l, periodo === '1T' ? FRACAO_1T_CONTAGEM[e] : 1));
      return matrizes.get(k)!;
    },
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

/** Motivo para o modelo NÃO conseguir avaliar a seleção (falta λ de escanteios/cartões). */
export function faltaNoModelo(liq: Liquidador, m: ModeloPlacar): string | null {
  if (liq.tipo !== 'contagem' && liq.tipo !== 'primeira_contagem') return null;
  return m.contagens[liq.estatistica]
    ? null
    : `sem estatísticas de ${NOME_ESTATISTICA[liq.estatistica]} dos dois times para o modelo nível 3`;
}

export function distribuicaoModelo(liq: Liquidador, m: ModeloPlacar): DistribuicaoResultado {
  const d = distribuicaoVazia();
  if (liq.tipo === 'contagem' || liq.tipo === 'primeira_contagem') {
    const periodo = liq.tipo === 'contagem' && liq.periodo === '1T' ? '1T' : 'FT';
    const mat = m.contagem(liq.estatistica, periodo);
    if (!mat) throw new Error(faltaNoModelo(liq, m) ?? 'sem modelo');
    if (liq.tipo === 'contagem') {
      mat.forEach((linha, i) => linha.forEach((p, j) => somarResultado(d, liq.fn(i, j), p)));
      return d;
    }
    // quem bate o 1º escanteio: proporcional aos λ; sem escanteio no jogo, devolve
    const p0 = mat[0][0];
    const { casa, fora } = m.contagens[liq.estatistica]!;
    if (liq.lado === 'nenhum') {
      d.ganho = p0;
      d.perda = 1 - p0;
    } else {
      d.ganho = ((1 - p0) * (liq.lado === 'casa' ? casa : fora)) / (casa + fora);
      d.push = p0;
      d.perda = 1 - p0 - d.ganho;
    }
    return d;
  }
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
