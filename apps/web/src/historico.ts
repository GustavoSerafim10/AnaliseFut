/**
 * Fase 4 — histórico de análises no aparelho. Cada entrada guarda o rascunho inteiro (para
 * reabrir) e um RESUMO congelado na hora de salvar: depois do início o motor exclui o jogo
 * (só pré-live), então a decisão registrada é a que valeu. O placar entra depois do jogo e a
 * apuração usa os mesmos liquidadores do motor. Exportar/importar JSON leva para outro aparelho.
 */
import {
  apurarAposta,
  clv,
  type Apuracao,
  type Decisao,
  type LinhaOdd,
  type PlacarFinal,
} from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import type { Derivado } from './dados';
import { inicioIso, isoLocal, type Rascunho } from './estado';

const CHAVE = 'pe-historico-v1';

export interface ResumoAnalise {
  jogo: string;
  competicao: string;
  inicio: string;
  decisao: Decisao | null;
  rotulo: string;
  dq: string | null;
  motivos: string[];
  /** melhor entrada encontrada (vale para BET e também "no papel" nas demais decisões) */
  entrada?: {
    linha: OddLine;
    descricao: string;
    odd: number;
    casa: string;
    ev: number;
    pFinal: number;
    oddMinima?: number;
    /** fração da banca sugerida (só em BET) */
    stake?: number;
  };
}

export interface ResultadoJogo extends PlacarFinal {
  oddFechamento?: number;
  registradoEm: string;
}

export interface EntradaHistorico {
  id: string;
  salvoEm: string;
  rascunho: Rascunho;
  resumo: ResumoAnalise;
  resultado?: ResultadoJogo;
}

export function carregarHistorico(): EntradaHistorico[] {
  try {
    const s = localStorage.getItem(CHAVE);
    const lista = s ? (JSON.parse(s) as EntradaHistorico[]) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/** false = o aparelho não deixou gravar (aba privada, armazenamento cheio). */
export function gravarHistorico(lista: EntradaHistorico[]): boolean {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}

export function resumir(r: Rascunho, d: Derivado): ResumoAnalise {
  const res = d.resultado;
  const m = res?.melhor;
  return {
    jogo: `${r.jogo.casa || 'Mandante'} × ${r.jogo.fora || 'Visitante'}`,
    competicao: r.jogo.competicao,
    inicio: inicioIso(r),
    decisao: res?.decisao ?? null,
    rotulo: res?.rotulo ?? 'análise incompleta',
    dq: res?.dq.efetiva ?? null,
    motivos: res?.motivos ?? d.pendencias,
    entrada: m
      ? {
          linha: m.linha as OddLine,
          descricao: m.descricao.replace('Ganha se: ', ''),
          odd: m.melhorOdd,
          casa: m.casaMelhorOdd,
          ev: m.ev,
          pFinal: m.pFinal,
          oddMinima: m.priceGate?.oddMinima,
          stake: m.stake?.fracaoBanca,
        }
      : undefined,
  };
}

/** Salva (ou atualiza, se o rascunho já veio do histórico). Devolve a lista e o id. */
export function salvarNoHistorico(
  lista: EntradaHistorico[],
  r: Rascunho,
  d: Derivado,
): { lista: EntradaHistorico[]; id: string } {
  const id =
    r.idHistorico ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const anterior = lista.find((e) => e.id === id);
  const entrada: EntradaHistorico = {
    id,
    salvoEm: isoLocal(new Date()),
    rascunho: { ...r, idHistorico: id },
    resumo: resumir(r, d),
    resultado: anterior?.resultado,
  };
  return {
    lista: anterior ? lista.map((e) => (e.id === id ? entrada : e)) : [entrada, ...lista],
    id,
  };
}

export function apurar(e: EntradaHistorico): Apuracao | null {
  if (!e.resultado || !e.resumo.entrada) return null;
  return apurarAposta(e.resumo.entrada.linha as LinhaOdd, e.resultado);
}

export interface Balanco {
  n: number;
  apuradas: number;
  /** lucro em unidades (1 unidade por aposta) */
  unidades: number;
  roi: number | null;
  acertos: number;
  /** probabilidade média prevista × fração de acertos: calibração do motor */
  pMedia: number | null;
  taxaAcerto: number | null;
  clvMedio: number | null;
  nClv: number;
}

export function balanco(lista: EntradaHistorico[]): Balanco {
  let apuradas = 0;
  let unidades = 0;
  let acertos = 0;
  let somaP = 0;
  const clvs: number[] = [];
  for (const e of lista) {
    const ent = e.resumo.entrada;
    if (!ent) continue;
    if (e.resultado?.oddFechamento) clvs.push(clv(ent.odd, e.resultado.oddFechamento));
    const a = apurar(e);
    if (!a?.ok || a.resultado === 0) continue;
    apuradas++;
    unidades += a.lucro;
    somaP += ent.pFinal;
    if (a.resultado > 0) acertos++;
  }
  return {
    n: lista.length,
    apuradas,
    unidades,
    roi: apuradas ? unidades / apuradas : null,
    acertos,
    pMedia: apuradas ? somaP / apuradas : null,
    taxaAcerto: apuradas ? acertos / apuradas : null,
    clvMedio: clvs.length ? clvs.reduce((s, x) => s + x, 0) / clvs.length : null,
    nClv: clvs.length,
  };
}

export function exportarJson(lista: EntradaHistorico[]): string {
  return JSON.stringify(
    { versao: 1, exportadoEm: isoLocal(new Date()), historico: lista },
    null,
    1,
  );
}

/** Junta um backup ao histórico atual (mesmo id: fica a versão salva por último). */
export function importarJson(
  texto: string,
  atual: EntradaHistorico[],
): { lista: EntradaHistorico[]; novas: number } | { erro: string } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch (e) {
    return { erro: `JSON inválido: ${(e as Error).message}` };
  }
  const itens = (bruto as { historico?: unknown })?.historico;
  if (!Array.isArray(itens)) return { erro: 'não é um backup do histórico (falta "historico")' };
  const validas = itens.filter(
    (x): x is EntradaHistorico =>
      !!x &&
      typeof x.id === 'string' &&
      !!x.rascunho &&
      !!x.resumo &&
      typeof x.salvoEm === 'string',
  );
  if (validas.length !== itens.length)
    return { erro: `${itens.length - validas.length} entrada(s) inválida(s): nada foi importado` };
  const mapa = new Map(atual.map((e) => [e.id, e]));
  let novas = 0;
  for (const e of validas) {
    const ja = mapa.get(e.id);
    if (!ja) novas++;
    if (!ja || e.salvoEm >= ja.salvoEm)
      mapa.set(e.id, { ...e, resultado: e.resultado ?? ja?.resultado });
  }
  const lista = [...mapa.values()].sort((a, b) => b.resumo.inicio.localeCompare(a.resumo.inicio));
  return { lista, novas };
}
