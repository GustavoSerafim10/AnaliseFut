/**
 * Seção 11 + "Várias casas": margem e de-vig por casa e por mercado, depois consenso
 * (mediana das probabilidades justas), melhor odd e outliers.
 */
import { resolverCasa } from './casas';
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

/**
 * Destino de cada linha recebida (rastreabilidade; não entra em nenhum cálculo):
 * precificada → entrou na precificação (a V4 a troca por avaliada/descartada);
 * avaliada → a seleção dela foi avaliada pela V4; descartada → saiu com motivo;
 * invalida → odd inválida; substituida → trocada por uma coleta da mesma casa.
 */
export type DestinoLinha = 'precificada' | 'avaliada' | 'descartada' | 'invalida' | 'substituida';

export interface RastroLinha {
  /** posição da linha na lista recebida */
  indice: number;
  /** a linha como veio (nome original da casa, odd e horário de coleta) */
  linha: LinhaOdd;
  casa: string;
  operatorId: string;
  brandId: string;
  productType: string;
  /** a seleção (mercado, período, time, linha e lado) */
  chave: string;
  destino: DestinoLinha;
  motivo?: string;
  /** só em 'avaliada': a linha foi a melhor odd ou serviu de preço de apoio */
  papel?: 'melhor odd' | 'preço de apoio';
  /** só em 'substituida': a coleta que ficou no lugar */
  substituidaPor?: { indice: number; odd: number; horarioColeta?: string };
}

export function rastroDeLinha(
  l: LinhaOdd,
  indice: number,
  destino: DestinoLinha,
  motivo?: string,
): RastroLinha {
  const c = resolverCasa(l.casa);
  return {
    indice,
    linha: l,
    casa: l.casa,
    operatorId: c.operatorId,
    brandId: c.brandId,
    productType: c.productType,
    chave: chaveSelecao(l),
    destino,
    motivo,
  };
}

export interface ResultadoPrecificacao {
  selecoes: SelecaoPrecificada[];
  descartes: DescartePreco[];
  casas: string[];
  /** um registro por linha recebida, na mesma ordem */
  rastro: RastroLinha[];
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
  cartoes_total: 2,
  cartoes_time: 2,
  cartoes_1x2: 3,
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

/** fonte de preço: marca + produto ("Bet 365" e "bet365" são a mesma; Exchange ≠ Sportsbook) */
const nomeCasa = (c: string) => resolverCasa(c).chaveFonte;

export interface OpcoesPrecificacao {
  /** de-vig dos mercados de 3 resultados (V4.0: 'shin'); padrão = regra da seção 11 */
  devig3?: MetodoDevig;
}

export function precificar(
  linhas: LinhaOdd[],
  opcoes: OpcoesPrecificacao = {},
): ResultadoPrecificacao {
  const descartes: DescartePreco[] = [];
  const grupos = new Map<string, Map<string, LinhaOdd>>();
  // rastreabilidade (só registra, não decide): posição da linha que ficou em cada lado do grupo
  const posicoes = new Map<string, Map<string, number>>();
  const rastro: RastroLinha[] = linhas.map((l, i) =>
    rastroDeLinha(l, i, 'descartada', 'sem destino registrado'),
  );
  const marcar = (i: number, destino: DestinoLinha, motivo?: string) => {
    rastro[i] = rastroDeLinha(linhas[i], i, destino, motivo);
  };
  const substituir = (iVelha: number, iNova: number, motivo: string) => {
    const nova = linhas[iNova];
    rastro[iVelha] = {
      ...rastroDeLinha(linhas[iVelha], iVelha, 'substituida', motivo),
      substituidaPor: { indice: iNova, odd: nova.odd, horarioColeta: nova.horarioColeta },
    };
  };

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (!Number.isFinite(l.odd) || l.odd <= 1) {
      const motivo = `odd inválida: ${l.odd}`;
      descartes.push({ chave: chaveSelecao(l), casa: l.casa, linha: l, motivo });
      marcar(i, 'invalida', motivo);
      continue;
    }
    const g = `${nomeCasa(l.casa)}#${chaveGrupo(l)}`;
    const lados = grupos.get(g) ?? new Map<string, LinhaOdd>();
    const pos = posicoes.get(g) ?? new Map<string, number>();
    const lado = normalizarLado(l.lado);
    const atual = lados.get(lado);
    // prints sobrepostos: fica a coleta mais recente
    if (!atual || (l.horarioColeta ?? '') > (atual.horarioColeta ?? '')) {
      if (atual)
        substituir(
          pos.get(lado)!,
          i,
          `coleta mais recente da mesma casa, mercado e seleção (${l.horarioColeta ?? 'sem horário'} no lugar de ${atual.horarioColeta ?? 'sem horário'})`,
        );
      lados.set(lado, l);
      pos.set(lado, i);
    } else {
      substituir(
        i,
        pos.get(lado)!,
        (l.horarioColeta ?? '') === (atual.horarioColeta ?? '')
          ? 'mesmo horário (ou ambos sem horário): fica a primeira lida'
          : `coleta mais antiga (${l.horarioColeta}) que a já lida (${atual.horarioColeta})`,
      );
    }
    grupos.set(g, lados);
    posicoes.set(g, pos);
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
  const pendentesDCIdx: number[][] = [];

  for (const [g, lados] of grupos) {
    const ls = [...lados.values()];
    const is = [...posicoes.get(g)!.values()];
    const m = ls[0].mercado;
    const esperado = LADOS_ESPERADOS[m];
    const descartarTodos = (motivo: string) =>
      ls.forEach((l, k) => {
        descartes.push({ chave: chaveSelecao(l), casa: l.casa, linha: l, motivo });
        marcar(is[k], 'descartada', motivo);
      });

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
      pendentesDCIdx.push(is);
      continue;
    }
    const odds = ls.map((l) => l.odd);
    if (esperado === undefined && calcMargem(odds) <= 0) {
      descartarTodos('mercado incompleto: soma das probabilidades < 100%');
      continue;
    }
    const r = removerMargem(odds, odds.length === 3 ? opcoes.devig3 : undefined);
    ls.forEach((l, i) => add(l, { pJusta: r.probs[i], margem: r.margem, metodo: r.metodo }));
    is.forEach((i) => marcar(i, 'precificada'));
    if (m === '1X2') {
      const mapa: Record<string, number> = {};
      ls.forEach((l, i) => (mapa[normalizarLado(l.lado)] = r.probs[i]));
      justo1x2.set(`${nomeCasa(ls[0].casa)}#${ls[0].periodo}`, mapa);
    }
  }

  // DC: nunca tirar a margem somando as 3 odds de DC → P(1X) = P(1) + P(X) do 1X2 da mesma casa
  for (const [k, ls] of pendentesDC.entries()) {
    const is = pendentesDCIdx[k];
    const base = justo1x2.get(`${nomeCasa(ls[0].casa)}#${ls[0].periodo}`);
    if (!base) {
      ls.forEach((l, j) => {
        const motivo = 'DC sem 1X2 da mesma casa para tirar a margem';
        descartes.push({ chave: chaveSelecao(l), casa: l.casa, linha: l, motivo });
        marcar(is[j], 'descartada', motivo);
      });
      continue;
    }
    // as três DC somam 2 (cada resultado aparece em duas): a margem é relativa a 2, como no 1X2
    const margemDC = ls.reduce((s, l) => s + 1 / l.odd, 0) / 2 - 1;
    for (const l of ls) {
      const p = normalizarLado(l.lado)
        .split('')
        .reduce((s, r) => s + (base[r] ?? 0), 0);
      add(l, { pJusta: p, margem: margemDC, metodo: 'via_1x2' });
    }
    is.forEach((i) => marcar(i, 'precificada'));
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
  return { selecoes, descartes, casas, rastro };
}
