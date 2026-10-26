/**
 * Seção 11 + "Várias casas": margem e de-vig por casa e por mercado, depois consenso
 * (mediana das probabilidades justas), melhor odd e outliers.
 */
import { margem as calcMargem, removerMargem, type MetodoDevig } from './devig';
import { normalizarLado } from './mercados';
import type { LinhaOdd, TipoMercado } from './tipos';

export interface PrecoCasa {
  casa: string;
  odd: number;
  pJusta: number;
  margem: number;
  metodo: MetodoDevig | 'via_1x2';
  horarioColeta?: string;
  linha: LinhaOdd;
}

export interface SelecaoPrecificada {
  chave: string;
  /** linha da casa com a melhor odd */
  linha: LinhaOdd;
  precos: PrecoCasa[];
  /** P_market = mediana das probabilidades justas entre casas */
  pMercado: number;
  melhor: PrecoCasa;
  /** mediana das margens das casas */
  margem: number;
  metodo: MetodoDevig | 'via_1x2';
  outliers: string[];
}

export interface DescartePreco {
  chave: string;
  casa: string;
  linha: LinhaOdd;
  motivo: string;
}

export interface ResultadoPrecificacao {
  selecoes: SelecaoPrecificada[];
  descartes: DescartePreco[];
  casas: string[];
}

/** Quantos lados um mercado completo tem. Sem valor = número variável. */
const LADOS_ESPERADOS: Partial<Record<TipoMercado, number>> = {
  '1X2': 3,
  DC: 3,
  DNB: 2,
  AH: 2,
  AH_europeu: 3,
  total: 2,
  total_time: 2,
  ambas: 2,
  par_impar: 2,
  vencer_sem_sofrer: 2,
  marcar_2_tempos: 2,
  intervalo_final: 9,
  primeiro_gol: 3,
  ultimo_gol: 3,
  combo_resultado_total: 6,
  combo_1x2_ambas: 6,
  combo_total_ambas: 4,
  escanteios_total: 2,
  escanteios_time: 2,
  escanteios_ah: 2,
  cartoes_ah: 2,
  chutes_ah: 2,
  impedimentos_ah: 2,
  escanteios_1x2: 3,
};

export const LIMITE_OUTLIER = 0.03;

/** No AH a linha do grupo é a do mandante (Villa −1.5 e Viking +1.5 formam o mesmo mercado). */
function linhaDoGrupo(l: LinhaOdd): string {
  if (l.linha === undefined) return '-';
  const ehAH =
    l.mercado === 'AH' ||
    l.mercado === 'escanteios_ah' ||
    l.mercado === 'cartoes_ah' ||
    l.mercado === 'chutes_ah' ||
    l.mercado === 'impedimentos_ah';
  if (ehAH && normalizarLado(l.lado) === 'fora') return String(-l.linha + 0);
  return String(l.linha);
}

export function chaveGrupo(l: LinhaOdd): string {
  return [l.mercado, l.periodo, l.time ?? '-', linhaDoGrupo(l)].join('|');
}

export function chaveSelecao(l: LinhaOdd): string {
  return `${chaveGrupo(l)}|${normalizarLado(l.lado)}`;
}

export function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const nomeCasa = (c: string) => c.trim().toLowerCase();

export function precificar(linhas: LinhaOdd[]): ResultadoPrecificacao {
  const descartes: DescartePreco[] = [];
  const grupos = new Map<string, Map<string, LinhaOdd>>();

  for (const l of linhas) {
    if (!Number.isFinite(l.odd) || l.odd <= 1) {
      descartes.push({
        chave: chaveSelecao(l),
        casa: l.casa,
        linha: l,
        motivo: `odd inválida: ${l.odd}`,
      });
      continue;
    }
    const g = `${nomeCasa(l.casa)}#${chaveGrupo(l)}`;
    const lados = grupos.get(g) ?? new Map<string, LinhaOdd>();
    const lado = normalizarLado(l.lado);
    const atual = lados.get(lado);
    // prints sobrepostos: fica a coleta mais recente
    if (!atual || (l.horarioColeta ?? '') > (atual.horarioColeta ?? '')) lados.set(lado, l);
    grupos.set(g, lados);
  }

  const precos = new Map<string, PrecoCasa[]>();
  const add = (l: LinhaOdd, p: Omit<PrecoCasa, 'linha' | 'casa' | 'odd' | 'horarioColeta'>) => {
    const k = chaveSelecao(l);
    const lista = precos.get(k) ?? [];
    lista.push({ ...p, casa: l.casa, odd: l.odd, horarioColeta: l.horarioColeta, linha: l });
    precos.set(k, lista);
  };

  // 1X2 justo por casa e período (base do DC)
  const justo1x2 = new Map<string, Record<string, number>>();
  const pendentesDC: LinhaOdd[][] = [];

  for (const [, lados] of grupos) {
    const ls = [...lados.values()];
    const m = ls[0].mercado;
    const esperado = LADOS_ESPERADOS[m];
    const descartarTodos = (motivo: string) =>
      ls.forEach((l) => descartes.push({ chave: chaveSelecao(l), casa: l.casa, linha: l, motivo }));

    if (ls.length < 2 || (esperado !== undefined && ls.length < esperado)) {
      descartarTodos('mercado incompleto: faltam lados para tirar a margem');
      continue;
    }
    if (esperado !== undefined && ls.length > esperado) {
      descartarTodos('lados demais no mesmo mercado (conferir leitura)');
      continue;
    }
    if (m === 'DC') {
      pendentesDC.push(ls);
      continue;
    }
    const odds = ls.map((l) => l.odd);
    if (esperado === undefined && calcMargem(odds) <= 0) {
      descartarTodos('mercado incompleto: soma das probabilidades < 100%');
      continue;
    }
    const r = removerMargem(odds);
    ls.forEach((l, i) => add(l, { pJusta: r.probs[i], margem: r.margem, metodo: r.metodo }));
    if (m === '1X2') {
      const mapa: Record<string, number> = {};
      ls.forEach((l, i) => (mapa[normalizarLado(l.lado)] = r.probs[i]));
      justo1x2.set(`${nomeCasa(ls[0].casa)}#${ls[0].periodo}`, mapa);
    }
  }

  // DC: nunca tirar a margem somando as 3 odds de DC → P(1X) = P(1) + P(X) do 1X2 da mesma casa
  for (const ls of pendentesDC) {
    const base = justo1x2.get(`${nomeCasa(ls[0].casa)}#${ls[0].periodo}`);
    if (!base) {
      ls.forEach((l) =>
        descartes.push({
          chave: chaveSelecao(l),
          casa: l.casa,
          linha: l,
          motivo: 'DC sem 1X2 da mesma casa para tirar a margem',
        }),
      );
      continue;
    }
    const margemDC = ls.reduce((s, l) => s + 1 / l.odd, 0) - 2;
    for (const l of ls) {
      const p = normalizarLado(l.lado)
        .split('')
        .reduce((s, r) => s + (base[r] ?? 0), 0);
      add(l, { pJusta: p, margem: margemDC, metodo: 'via_1x2' });
    }
  }

  const selecoes: SelecaoPrecificada[] = [];
  for (const [chave, lista] of precos) {
    const pMercado = mediana(lista.map((p) => p.pJusta));
    const melhor = lista.reduce((a, b) => (b.odd > a.odd ? b : a));
    const outliers =
      lista.length >= 3
        ? lista.filter((p) => Math.abs(p.pJusta - pMercado) > LIMITE_OUTLIER).map((p) => p.casa)
        : [];
    selecoes.push({
      chave,
      linha: melhor.linha,
      precos: lista,
      pMercado,
      melhor,
      margem: mediana(lista.map((p) => p.margem)),
      metodo: melhor.metodo,
      outliers,
    });
  }

  const casas = [...new Set(linhas.map((l) => nomeCasa(l.casa)))];
  return { selecoes, descartes, casas };
}
