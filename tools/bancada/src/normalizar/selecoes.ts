/**
 * Análise (a revisão de DECISÃO de cada entrada do histórico) e seleções (jogo × mercado × lado
 * avaliado). Tudo copiado do que a Fase 0 gravou; o que depende de recálculo (modelo bruto,
 * mistura, desfecho do mercado) fica como derivação pendente para a F1.3 — nada é estimado aqui.
 */
import { chaveSelecao, oddEfetiva, resolverCasa, type LinhaOdd } from '@pe/engine';
import type { Evidencia } from '../../../../apps/web/src/evidencias';
import type { EntradaHistorico } from '../../../../apps/web/src/historico';
import { clvPadronizado, type ClvPadronizado } from './clv';
import { ehPreferencial, faixaDe, type IdFaixa } from './faixas';
import { classificarMercado, type ClasseMercado } from './mercados';

/** Campos que dependem de recálculo com o motor: F1.3. */
export const DERIVACAO_PENDENTE = ['pModeloBruto', 'pMistura', 'wMistura', 'desfecho'] as const;

export interface Analise {
  idHistorico: string;
  chaveJogo: string;
  irmaDe: string | null;
  protocolo: string | null;
  decisaoResumo: string | null;
  temEvidencia: boolean;
  revisoes: number;
  /** revisões gravadas no/depois do apito (não devia haver): ficam fora da decisão, contadas */
  revisoesPosApito: number;
  revisaoDecisao: number | null;
  revisaoAbertura: number | null;
  identidadeDecisao: string | null;
  build: { commit: string | null; origem: string; alteracoesLocais: boolean | null } | null;
  calculadoEm: { inicio: string; fim: string } | null;
  dq: string | null;
  decisaoV4: string | null;
  nivelReferencia: string | null;
}

export interface Selecao extends ClasseMercado {
  idHistorico: string;
  chaveJogo: string;
  revisao: number;
  descricao: string;
  /** de onde veio: avaliação da V4, lista "Melhores entradas", ou as duas */
  origem: 'v4' | 'lista' | 'v4+lista';
  melhorOdd: number | null;
  casaMelhorOdd: string | null;
  operadorMelhorOdd: string | null;
  horarioColeta: string | null;
  oddJusta: number | null;
  margemReferencia: number | null;
  casasComPreco: number | null;
  nivelReferencia: string | null;
  ev: number | null;
  evMinimo: number | null;
  filtro: string | null;
  /** as quatro fontes de probabilidade */
  pMercado: number | null;
  fonteP: string | null;
  pConsenso: number | null;
  pModeloAjustado: number | null;
  /** derivação pendente (F1.3): recalcular do λ bruto gravado */
  pModeloBruto: null;
  /** derivação pendente (F1.3): w × modelo + (1 − w) × mercado, w do apoio da V4 */
  pMistura: null;
  wMistura: null;
  camadas: { betV4: boolean; noBetPapel: boolean; lista: boolean };
  lista: {
    odd: number | null;
    casa: string | null;
    chance: number | null;
    pModelo: number | null;
    pMercado: number | null;
    referenciaAfiada: boolean | null;
  } | null;
  faixaDecisao: IdFaixa | null;
  preferencial: boolean;
  /** CLV "no papel": odd de decisão × fechamento registrado para esta entrada (quando houver) */
  clvPapel: ClvPadronizado | null;
  /** derivação pendente (F1.3): apuração do mercado pelo placar */
  desfecho: null;
}

/** Número de um campo gravado na evidência: {$invalido}, null ou não finito viram null. */
export const num = (x: unknown): number | null =>
  typeof x === 'number' && Number.isFinite(x) ? x : null;
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);

interface AvaliadaGravada {
  chave?: unknown;
  linha?: unknown;
  descricao?: unknown;
  nivel?: unknown;
  pTrue?: unknown;
  fonteP?: unknown;
  oddJusta?: unknown;
  melhorOdd?: unknown;
  casaMelhorOdd?: unknown;
  horarioColeta?: unknown;
  margemReferencia?: unknown;
  casas?: unknown;
  ev?: unknown;
  evMinimo?: unknown;
  pModelo?: unknown;
  pConsenso?: unknown;
  filtro?: unknown;
}
interface EntradaListaGravada {
  chave?: unknown;
  linha?: unknown;
  descricao?: unknown;
  odd?: unknown;
  casa?: unknown;
  chance?: unknown;
  pModelo?: unknown;
  pMercado?: unknown;
  referenciaAfiada?: unknown;
}

const ehLinha = (x: unknown): x is LinhaOdd => {
  const l = x as LinhaOdd;
  return (
    !!l && typeof l === 'object' && typeof l.mercado === 'string' && typeof l.lado === 'string'
  );
};

/** A revisão de decisão: a última antes do apito; a abertura: a primeira. */
export function revisoesDoJogo(evs: Evidencia[], inicio: string) {
  const ordenadas = [...evs].sort((a, b) => a.meta.revisao - b.meta.revisao);
  const apito = Date.parse(inicio);
  const antes = ordenadas.filter((e) => !(Date.parse(e.meta.gravadoEm) >= apito));
  return {
    decisao: antes.at(-1) ?? null,
    abertura: antes[0] ?? null,
    posApito: ordenadas.length - antes.length,
    total: ordenadas.length,
  };
}

export function montarAnalise(
  e: EntradaHistorico,
  chave: string,
  evs: Evidencia[],
): { analise: Analise; decisao: Evidencia | null } {
  const r = revisoesDoJogo(evs, e.resumo.inicio);
  const d = r.decisao;
  const v4 = (
    d?.conteudo.avaliacao as
      { v4?: { decisao?: unknown; referencia?: { nivel?: unknown } } } | undefined
  )?.v4;
  const modelo = d?.conteudo.modelo as { dq?: { dq?: unknown } } | undefined;
  return {
    decisao: d,
    analise: {
      idHistorico: e.id,
      chaveJogo: chave,
      irmaDe: e.irmaDe ?? null,
      protocolo: e.resumo.protocolo ?? null,
      decisaoResumo: e.resumo.decisao ?? null,
      temEvidencia: r.total > 0,
      revisoes: r.total,
      revisoesPosApito: r.posApito,
      revisaoDecisao: d?.meta.revisao ?? null,
      revisaoAbertura: r.abertura?.meta.revisao ?? null,
      identidadeDecisao: d ? JSON.stringify([d.meta.idJogo, d.meta.hash, d.meta.gravadoEm]) : null,
      build: d
        ? {
            commit: d.meta.build.commit,
            origem: d.meta.build.origem,
            alteracoesLocais: d.meta.build.alteracoesLocais,
          }
        : null,
      calculadoEm: d?.meta.calculadoEm ?? null,
      dq: str(modelo?.dq?.dq),
      decisaoV4: str(v4?.decisao),
      nivelReferencia: str(v4?.referencia?.nivel),
    },
  };
}

/** Seleções da revisão de decisão: as avaliadas pela V4 e as da lista, juntas pela chave. */
export function montarSelecoes(e: EntradaHistorico, chave: string, decisao: Evidencia): Selecao[] {
  const aval = decisao.conteudo.avaliacao as {
    v4?: { decisao?: unknown; melhor?: { chave?: unknown } | null; avaliadas?: unknown };
    entradas?: { entradas?: unknown } | null;
  };
  const v4 = aval?.v4;
  const avaliadas: AvaliadaGravada[] = Array.isArray(v4?.avaliadas) ? v4.avaliadas : [];
  const lista: EntradaListaGravada[] = Array.isArray(aval?.entradas?.entradas)
    ? (aval.entradas!.entradas as EntradaListaGravada[])
    : [];
  const decisaoV4 = str(v4?.decisao);
  const chaveMelhor = str(v4?.melhor?.chave);
  const chaveEntrada = e.resumo.entrada?.linha
    ? chaveSelecao(e.resumo.entrada.linha as LinhaOdd)
    : null;
  const res = e.resultado;

  const porChave = new Map<string, Selecao>();
  const nova = (linha: LinhaOdd, descricao: string, origem: Selecao['origem']): Selecao => ({
    ...classificarMercado(linha),
    idHistorico: e.id,
    chaveJogo: chave,
    revisao: decisao.meta.revisao,
    descricao,
    origem,
    melhorOdd: null,
    casaMelhorOdd: null,
    operadorMelhorOdd: null,
    horarioColeta: null,
    oddJusta: null,
    margemReferencia: null,
    casasComPreco: null,
    nivelReferencia: null,
    ev: null,
    evMinimo: null,
    filtro: null,
    pMercado: null,
    fonteP: null,
    pConsenso: null,
    pModeloAjustado: null,
    pModeloBruto: null,
    pMistura: null,
    wMistura: null,
    camadas: { betV4: false, noBetPapel: false, lista: false },
    lista: null,
    faixaDecisao: null,
    preferencial: false,
    clvPapel: null,
    desfecho: null,
  });

  for (const a of avaliadas) {
    if (!ehLinha(a.linha)) continue;
    const s = nova(a.linha, str(a.descricao) ?? '', 'v4');
    const casa = str(a.casaMelhorOdd);
    Object.assign(s, {
      melhorOdd: num(a.melhorOdd),
      casaMelhorOdd: casa,
      operadorMelhorOdd: casa ? resolverCasa(casa).operatorId : null,
      horarioColeta: str(a.horarioColeta),
      oddJusta: num(a.oddJusta),
      margemReferencia: num(a.margemReferencia),
      casasComPreco: num(a.casas),
      nivelReferencia: str(a.nivel),
      ev: num(a.ev),
      evMinimo: num(a.evMinimo),
      filtro: str(a.filtro),
      pMercado: num(a.pTrue),
      fonteP: str(a.fonteP),
      pConsenso: num(a.pConsenso),
      pModeloAjustado: num(a.pModelo),
    });
    s.camadas.betV4 = decisaoV4 === 'BET' && chaveMelhor === s.chave;
    s.camadas.noBetPapel = decisaoV4 !== null && decisaoV4 !== 'BET' && chaveMelhor === s.chave;
    porChave.set(s.chave, s);
  }
  for (const l of lista) {
    if (!ehLinha(l.linha)) continue;
    const k = chaveSelecao(l.linha);
    const s = porChave.get(k) ?? nova(l.linha, str(l.descricao) ?? '', 'lista');
    if (porChave.has(k)) s.origem = 'v4+lista';
    s.camadas.lista = true;
    s.lista = {
      odd: num(l.odd),
      casa: str(l.casa),
      chance: num(l.chance),
      pModelo: num(l.pModelo),
      pMercado: num(l.pMercado),
      referenciaAfiada: typeof l.referenciaAfiada === 'boolean' ? l.referenciaAfiada : null,
    };
    porChave.set(k, s);
  }

  for (const s of porChave.values()) {
    // faixa pela odd da decisão: a melhor odd da V4; só da lista, a odd da lista
    const odd = s.melhorOdd ?? s.lista?.odd ?? null;
    s.faixaDecisao = faixaDe(odd);
    s.preferencial = ehPreferencial(s.faixaDecisao);
    // CLV no papel: só para a seleção que é a entrada registrada, e se houver fechamento
    if (chaveEntrada === s.chave && res && odd !== null) {
      const casa = s.melhorOdd !== null ? s.casaMelhorOdd : s.lista?.casa;
      s.clvPapel = clvPadronizado(
        casa ? oddEfetiva(casa, odd) : odd,
        res.oddFechamento,
        res.fechamentoOutros,
      );
    }
  }
  return [...porChave.values()].sort((a, b) => a.chave.localeCompare(b.chave));
}
