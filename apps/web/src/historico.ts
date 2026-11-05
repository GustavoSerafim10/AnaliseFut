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
  /** só existe quando o usuário ENTROU de verdade (botão "Entrei"); sem isto é só análise */
  aposta?: ApostaFeita;
  /** green/red marcado à mão: vale quando o site não apura sozinho (1º escanteio, mercado do 1º tempo...) */
  manual?: Manual;
}

export type Manual = 'green' | 'red' | 'devolvida';

/** A aposta que o usuário fez de fato, com a odd e a casa que pegou (podem diferir da análise). */
export interface ApostaFeita {
  odd: number;
  casa: string;
  /** valor em R$ (opcional: sem ele a entrada conta em unidades, mas não entra nas travas) */
  valor?: number;
  feitaEm: string;
}

export const entrou = (e: EntradaHistorico) => !!e.aposta && !!e.resumo.entrada;

/** odd que vale para apurar: a que o usuário pegou, senão a da análise */
export const oddDe = (e: EntradaHistorico) => e.aposta?.odd ?? e.resumo.entrada?.odd ?? 0;

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

const jogoComecou = (r: Rascunho, agora: number) => {
  const inicio = Date.parse(inicioIso(r));
  return Number.isFinite(inicio) && agora >= inicio;
};

/**
 * Salva sozinho até o início do jogo, assim que a análise tem times, hora e odds válidas: ninguém
 * perde o jogo por esquecer o botão. Depois do início, o motor exclui o jogo (só pré-live).
 */
export function podeSalvarSozinho(r: Rascunho, d: Derivado, agora = Date.now()): boolean {
  return (
    !!r.jogo.casa &&
    !!r.jogo.fora &&
    !!r.jogo.hora &&
    !!d.v4 &&
    d.oddsValidas.length > 0 &&
    !jogoComecou(r, agora)
  );
}

/** Mesmo conteúdo (o id entra no rascunho só depois da primeira gravação). */
export const mesmoRascunho = (a: Rascunho, b: Rascunho) =>
  JSON.stringify({ ...a, idHistorico: undefined }) ===
  JSON.stringify({ ...b, idHistorico: undefined });

/** Salva (ou atualiza, se o rascunho já veio do histórico). Devolve a lista e o id. */
export function salvarNoHistorico(
  lista: EntradaHistorico[],
  r: Rascunho,
  d: Derivado,
  aposta?: ApostaFeita,
  agora = Date.now(),
): { lista: EntradaHistorico[]; id: string } {
  const id =
    r.idHistorico ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const anterior = lista.find((e) => e.id === id);
  const entrada: EntradaHistorico = {
    id,
    salvoEm: isoLocal(new Date()),
    rascunho: { ...r, idHistorico: id },
    // depois do início o motor responde "excluído": a decisão que valeu é a de antes do jogo
    resumo: anterior && jogoComecou(r, agora) ? anterior.resumo : resumir(r, d),
    resultado: anterior?.resultado,
    aposta: aposta ?? anterior?.aposta,
    manual: anterior?.manual,
  };
  return {
    lista: anterior ? lista.map((e) => (e.id === id ? entrada : e)) : [entrada, ...lista],
    id,
  };
}

/** placar registrado (pode haver só o fechamento, sem placar ainda) */
export const temPlacar = (e: EntradaHistorico) =>
  Number.isFinite(e.resultado?.casa) && Number.isFinite(e.resultado?.fora);

/** só pelo placar (sem a marcação à mão) */
export function apurarAuto(e: EntradaHistorico): Apuracao | null {
  if (!e.resultado || !e.resumo.entrada || !temPlacar(e)) return null;
  const linha = { ...e.resumo.entrada.linha, odd: oddDe(e) } as LinhaOdd;
  return apurarAposta(linha, e.resultado);
}

const VALOR_MANUAL: Record<Manual, number> = { green: 1, red: -1, devolvida: 0 };
const ROTULO_MANUAL: Record<Manual, string> = {
  green: 'ganhou',
  red: 'perdeu',
  devolvida: 'devolvida',
};

/** A apuração pelo placar manda; a marcação à mão cobre o que o placar não resolve. */
export function apurar(e: EntradaHistorico): Apuracao | null {
  const auto = apurarAuto(e);
  if (auto?.ok || !e.manual || !e.resumo.entrada) return auto;
  const r = VALOR_MANUAL[e.manual];
  return {
    ok: true,
    resultado: r,
    lucro: r > 0 ? oddDe(e) - 1 : r,
    rotulo: `${ROTULO_MANUAL[e.manual]} (marcado à mão)`,
  };
}

/** CLV da entrada contra o fechamento (justo, se vieram os outros lados). */
export function clvDe(e: EntradaHistorico): number | null {
  const fech = e.resultado?.oddFechamento;
  if (!fech || !e.resumo.entrada) return null;
  return clvJusto(oddDe(e), fech, e.resultado?.fechamentoOutros).clv;
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

/** apostas com valor em R$: alimentam as travas da banca */
export const apostasFeitas = (lista: EntradaHistorico[]) =>
  lista.filter((e) => entrou(e) && (e.aposta!.valor ?? 0) > 0);

export function travasDoHistorico(
  lista: EntradaHistorico[],
  bancaInicial: number,
  agora = isoLocal(new Date()),
): TravasBanca {
  const apostas: ApostaBanca[] = apostasFeitas(lista).map((e) => {
    const a = apurar(e);
    return {
      feitaEm: e.aposta!.feitaEm,
      stake: e.aposta!.valor!,
      lucro: a?.ok ? a.lucro : undefined,
      apuradaEm: e.resultado?.registradoEm,
    };
  });
  return calcularTravas(bancaInicial, apostas, agora);
}

/** as entradas de verdade (botão "Entrei"), base do painel */
export const minhasEntradas = (lista: EntradaHistorico[]) => lista.filter(entrou);

/** a melhor entrada das análises em que o usuário não entrou, "no papel" */
export const soNoPapel = (lista: EntradaHistorico[]) =>
  lista.filter((e) => !e.aposta && e.resumo.entrada);

export type FiltroPainel = 'entradas' | 'papel';

export const filtrar = (lista: EntradaHistorico[], f: FiltroPainel) =>
  f === 'entradas' ? minhasEntradas(lista) : soNoPapel(lista);

export type Situacao = 'green' | 'red' | 'devolvida' | 'pendente';

export function situacao(e: EntradaHistorico): Situacao {
  const a = apurar(e);
  if (!a?.ok) return 'pendente';
  return a.resultado > 0 ? 'green' : a.resultado < 0 ? 'red' : 'devolvida';
}

export interface PontoCurva {
  id: string;
  jogo: string;
  data: string;
  lucro: number;
  acumulado: number;
}

export interface Painel {
  entradas: number;
  green: number;
  red: number;
  devolvidas: number;
  pendentes: number;
  /** green ÷ (green + red); meio ganho conta como green, meia perda como red */
  winrate: number | null;
  unidades: number;
  roi: number | null;
  evMedio: number | null;
  oddMedia: number | null;
  /** unidades acumuladas na ordem dos jogos (só as apuradas) */
  curva: PontoCurva[];
}

export function painel(lista: EntradaHistorico[]): Painel {
  const p: Painel = {
    entradas: lista.length,
    green: 0,
    red: 0,
    devolvidas: 0,
    pendentes: 0,
    winrate: null,
    unidades: 0,
    roi: null,
    evMedio: null,
    oddMedia: null,
    curva: [],
  };
  let somaEv = 0;
  let somaOdd = 0;
  const ordem = [...lista].sort((a, b) => a.resumo.inicio.localeCompare(b.resumo.inicio));
  for (const e of ordem) {
    const ent = e.resumo.entrada!;
    somaEv += ent.ev;
    somaOdd += oddDe(e);
    const s = situacao(e);
    if (s === 'pendente') {
      p.pendentes++;
      continue;
    }
    p[s === 'devolvida' ? 'devolvidas' : s]++;
    const a = apurar(e) as Extract<Apuracao, { ok: true }>;
    p.unidades += a.lucro;
    p.curva.push({
      id: e.id,
      jogo: e.resumo.jogo,
      data: e.resumo.inicio.slice(0, 10),
      lucro: a.lucro,
      acumulado: p.unidades,
    });
  }
  const apuradas = p.green + p.red + p.devolvidas;
  if (p.green + p.red) p.winrate = p.green / (p.green + p.red);
  if (apuradas) p.roi = p.unidades / apuradas;
  if (lista.length) {
    p.evMedio = somaEv / lista.length;
    p.oddMedia = somaOdd / lista.length;
  }
  return p;
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

/** O que vai no backup além do histórico. As fotos de figurinhas e galeria ficam de fora: pesam. */
export interface ExtrasBackup {
  banca?: number | null;
  rascunho?: Rascunho;
  cores?: Record<string, { cor1: string; cor2: string }>;
  escudos?: Record<string, { imagem: string; cor1?: string; cor2?: string }>;
}

export function exportarJson(lista: EntradaHistorico[], extras: ExtrasBackup = {}): string {
  return JSON.stringify(
    { versao: 2, exportadoEm: isoLocal(new Date()), historico: lista, ...extras },
    null,
    1,
  );
}

export function lerExtrasBackup(texto: string): ExtrasBackup {
  try {
    const { banca, rascunho, cores, escudos } = JSON.parse(texto) as ExtrasBackup;
    return {
      ...(banca !== undefined ? { banca } : {}),
      ...(rascunho ? { rascunho } : {}),
      ...(cores ? { cores } : {}),
      ...(escudos ? { escudos } : {}),
    };
  } catch {
    return {};
  }
}

const CHAVE_ULTIMO_BACKUP = 'pe-ultimo-backup';

export function lerUltimoBackup(): string | null {
  try {
    return localStorage.getItem(CHAVE_ULTIMO_BACKUP);
  } catch {
    return null;
  }
}

export function gravarUltimoBackup(quando: string): void {
  try {
    localStorage.setItem(CHAVE_ULTIMO_BACKUP, quando);
  } catch {
    /* sem storage: fica sem o lembrete */
  }
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
      mapa.set(e.id, {
        ...e,
        resultado: e.resultado ?? ja?.resultado,
        manual: e.manual ?? ja?.manual,
        aposta: e.aposta ?? ja?.aposta,
      });
  }
  const lista = [...mapa.values()].sort((a, b) => b.resumo.inicio.localeCompare(a.resumo.inicio));
  return { lista, novas };
}
