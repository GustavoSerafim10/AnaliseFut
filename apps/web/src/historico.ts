/**
 * Fase 4 — histórico de análises no aparelho. Cada entrada guarda o rascunho inteiro (para
 * reabrir) e um RESUMO congelado na hora de salvar: depois do início o motor exclui o jogo
 * (só pré-live), então a decisão registrada é a que valeu. O placar entra depois do jogo e a
 * apuração usa os mesmos liquidadores do motor. Exportar/importar JSON leva para outro aparelho.
 * V4.0: a decisão registrada é a da V4; o CLV contra o fechamento JUSTO da referência é o
 * termômetro principal, por estratégia (S1–S4), e as apostas alimentam as travas da banca.
 */
import {
  apurarAposta,
  brier,
  calcularTravas,
  clvJusto,
  type ApostaBanca,
  type Apuracao,
  type Decisao,
  type Estrategia,
  type LinhaOdd,
  type NivelReferencia,
  type PlacarFinal,
  type TravasBanca,
} from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import type { Derivado } from './dados';
import { inicioIso, isoLocal, type Rascunho } from './estado';

const CHAVE = 'pe-historico-v1';
const CHAVE_BANCA = 'pe-banca-v1';

export interface ResumoAnalise {
  jogo: string;
  competicao: string;
  inicio: string;
  decisao: Decisao | null;
  rotulo: string;
  dq: string | null;
  motivos: string[];
  /** protocolo que tomou a decisão (análises antigas: V3.3) */
  protocolo?: 'V4' | 'V3.3';
  /** melhor entrada encontrada (vale para BET e também "no papel" nas demais decisões) */
  entrada?: {
    linha: OddLine;
    descricao: string;
    odd: number;
    casa: string;
    ev: number;
    /** P_true (V4) ou P_final (V3.3) */
    pFinal: number;
    oddMinima?: number;
    /** fração da banca sugerida (só em BET) */
    stake?: number;
    /** valor em R$ da stake, quando havia banca */
    stakeValor?: number;
    nivel?: NivelReferencia;
    estrategia?: Estrategia;
  };
  /** previsões para o Brier do modelo × mercado (seção 26) */
  previsao?: {
    modelo1x2: [number, number, number];
    mercado1x2?: [number, number, number];
    over25Modelo: number;
    over25Mercado?: number;
  };
}

export interface ResultadoJogo extends PlacarFinal {
  /** odd de fechamento da REFERÊNCIA no lado apostado */
  oddFechamento?: number;
  /** odds de fechamento dos outros lados do mesmo mercado (para tirar a margem) */
  fechamentoOutros?: number[];
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

/** Banca separada, definida uma vez (seção 6). */
export function carregarBancaInicial(): number | null {
  try {
    const n = Number(localStorage.getItem(CHAVE_BANCA));
    return n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function gravarBancaInicial(v: number | null): void {
  try {
    if (v === null) localStorage.removeItem(CHAVE_BANCA);
    else localStorage.setItem(CHAVE_BANCA, String(v));
  } catch {
    /* sem storage: a banca vale só nesta sessão */
  }
}

export function resumir(r: Rascunho, d: Derivado): ResumoAnalise {
  const v4 = d.v4;
  const res = d.resultado;
  const prev = res?.previsao;
  const base = {
    jogo: `${r.jogo.casa || 'Mandante'} × ${r.jogo.fora || 'Visitante'}`,
    competicao: r.jogo.competicao,
    inicio: inicioIso(r),
    dq: res?.dq.efetiva ?? d.dq.dq,
    previsao: prev
      ? {
          modelo1x2: [prev.p1x2.modelo.casa, prev.p1x2.modelo.empate, prev.p1x2.modelo.fora] as [
            number,
            number,
            number,
          ],
          mercado1x2: prev.p1x2.mercado
            ? ([prev.p1x2.mercado.casa, prev.p1x2.mercado.empate, prev.p1x2.mercado.fora] as [
                number,
                number,
                number,
              ])
            : undefined,
          over25Modelo: prev.over25.modelo,
          over25Mercado: prev.over25.mercado ?? undefined,
        }
      : undefined,
  };
  if (v4) {
    const m = v4.melhor;
    return {
      ...base,
      protocolo: 'V4',
      decisao: v4.decisao,
      rotulo: v4.rotulo,
      motivos: v4.motivos,
      entrada: m
        ? {
            linha: m.linha as OddLine,
            descricao: m.descricao.replace('Ganha se: ', ''),
            odd: m.melhorOdd,
            casa: m.casaMelhorOdd,
            ev: m.ev,
            pFinal: m.pTrue,
            oddMinima: m.oddMinima ?? undefined,
            stake: m.stake?.fracaoBanca,
            stakeValor: m.stake?.valor,
            nivel: m.nivel,
            estrategia: m.estrategia,
          }
        : undefined,
    };
  }
  const m = res?.melhor;
  return {
    ...base,
    protocolo: 'V3.3',
    decisao: res?.decisao ?? null,
    rotulo: res?.rotulo ?? 'análise incompleta',
    motivos: res?.motivos ?? d.pendenciasV4,
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
          stakeValor: m.stake?.valor,
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

/** placar registrado (pode haver só o fechamento, sem placar ainda) */
export const temPlacar = (e: EntradaHistorico) =>
  Number.isFinite(e.resultado?.casa) && Number.isFinite(e.resultado?.fora);

export function apurar(e: EntradaHistorico): Apuracao | null {
  if (!e.resultado || !e.resumo.entrada || !temPlacar(e)) return null;
  return apurarAposta(e.resumo.entrada.linha as LinhaOdd, e.resultado);
}

/** CLV da entrada contra o fechamento (justo, se vieram os outros lados). */
export function clvDe(e: EntradaHistorico): number | null {
  const fech = e.resultado?.oddFechamento;
  if (!fech || !e.resumo.entrada) return null;
  return clvJusto(e.resumo.entrada.odd, fech, e.resultado?.fechamentoOutros).clv;
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
    const c = clvDe(e);
    if (c !== null) clvs.push(c);
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

/** Marcos da seção 8 (CLV por estratégia). */
export function marco(b: Balanco): string {
  if (b.nClv < 100)
    return `${b.nClv}/100 apostas com fechamento: cedo demais para julgar (não julgar por green/red)`;
  if (b.clvMedio! <= 0) return 'CLV ≤ 0 em 100+ apostas: SUSPENDER esta estratégia';
  if (b.nClv >= 300 && b.clvMedio! > 0.015)
    return 'CLV > +1,5% em 300+ apostas: processo validado, pode subir a fração de Kelly um degrau';
  if (b.nClv >= 300) return 'CLV positivo, mas abaixo de +1,5% em 300+ apostas: manter e revisar';
  return 'CLV positivo em 100+ apostas: seguir até 300 para validar';
}

export const apostasFeitas = (lista: EntradaHistorico[]) =>
  lista.filter((e) => e.resumo.decisao === 'BET' && e.resumo.entrada?.stakeValor);

export function travasDoHistorico(
  lista: EntradaHistorico[],
  bancaInicial: number,
  agora = isoLocal(new Date()),
): TravasBanca {
  const apostas: ApostaBanca[] = apostasFeitas(lista).map((e) => {
    const a = apurar(e);
    return {
      feitaEm: e.salvoEm,
      stake: e.resumo.entrada!.stakeValor!,
      lucro: a?.ok ? a.lucro : undefined,
      apuradaEm: e.resultado?.registradoEm,
    };
  });
  return calcularTravas(bancaInicial, apostas, agora);
}

export interface Calibracao {
  jogos: number;
  brier1x2: { modelo: number; mercado: number } | null;
  brierOU: { modelo: number; mercado: number } | null;
}

/** Brier do modelo × mercado em todo jogo analisado com placar (inclusive NO BET). */
export function calibracao(lista: EntradaHistorico[]): Calibracao {
  const r1: [number, number][] = [];
  const rOU: [number, number][] = [];
  for (const e of lista) {
    const p = e.resumo.previsao;
    const res = e.resultado;
    if (!p || !res || !temPlacar(e)) continue;
    const ocorrido = res.casa > res.fora ? 0 : res.casa === res.fora ? 1 : 2;
    if (p.mercado1x2) r1.push([brier(p.modelo1x2, ocorrido), brier(p.mercado1x2, ocorrido)]);
    if (p.over25Mercado !== undefined) {
      const over = res.casa + res.fora > 2.5 ? 0 : 1;
      rOU.push([
        brier([p.over25Modelo, 1 - p.over25Modelo], over),
        brier([p.over25Mercado, 1 - p.over25Mercado], over),
      ]);
    }
  }
  const media = (xs: [number, number][]) =>
    xs.length
      ? {
          modelo: xs.reduce((s, x) => s + x[0], 0) / xs.length,
          mercado: xs.reduce((s, x) => s + x[1], 0) / xs.length,
        }
      : null;
  return { jogos: Math.max(r1.length, rOU.length), brier1x2: media(r1), brierOU: media(rOU) };
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
