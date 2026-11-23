/**
 * Banco das evidências (Fase 0): IndexedDB próprio, separado do banco do histórico
 * ("pricing-engine", armazem.ts) e de qualquer armazenamento do Ledger.
 *
 * Concorrência: cada gravação é UMA transação readwrite que lê as revisões do jogo, decide a
 * próxima (planejarRevisao) e grava com add(). Transações readwrite no mesmo depósito rodam uma
 * de cada vez, inclusive entre abas; e add() nunca sobrescreve: número já usado aborta a
 * transação inteira em vez de trocar o conteúdo calado.
 *
 * Importação (versão 2 do banco): em lotes, e cada lote grava as revisões E atualiza o diário
 * da importação na mesma transação. Interrompida no meio (aba fechada, erro), o diário diz
 * exatamente quantas revisões entraram; reimportar o mesmo arquivo completa sem duplicar, e
 * "desfazer" apaga só as revisões marcadas com o lote daquela importação.
 */
import type { Derivado } from './dados';
import type { Rascunho } from './estado';
import {
  antesDoApito,
  chaveRevisao,
  impressaoDoBackup,
  LIMITE_REVISOES,
  montarEvidencia,
  planejarImportacao,
  planejarRevisao,
  type ContextoCalculo,
  type Evidencia,
} from './evidencias';

const NOME_BANCO = 'pe-evidencias';
const VERSAO_BANCO = 2;
const TABELA = 'revisoes';
const POR_JOGO = 'porJogo';
const DIARIO = 'importacoes';
export const TAMANHO_LOTE = 50;

let conexao: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (conexao) return conexao;
  conexao = new Promise<IDBDatabase>((ok, falha) => {
    if (typeof indexedDB === 'undefined') {
      falha(new Error('este navegador não tem banco (IndexedDB)'));
      return;
    }
    const pedido = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      // versão 1 → 2 só acrescenta o diário: as revisões existentes ficam como estão
      if (!db.objectStoreNames.contains(TABELA)) {
        const t = db.createObjectStore(TABELA, { keyPath: ['meta.idJogo', 'meta.revisao'] });
        t.createIndex(POR_JOGO, 'meta.idJogo');
      }
      if (!db.objectStoreNames.contains(DIARIO)) db.createObjectStore(DIARIO, { keyPath: 'id' });
    };
    pedido.onsuccess = () => {
      const db = pedido.result;
      // outra aba atualizou o banco: fecha esta conexão e abre de novo na próxima gravação
      db.onversionchange = () => {
        db.close();
        conexao = null;
      };
      ok(db);
    };
    pedido.onerror = () => falha(pedido.error ?? new Error('não abriu o banco de evidências'));
    pedido.onblocked = () => falha(new Error('banco de evidências bloqueado por outra aba'));
  });
  conexao.catch(() => {
    conexao = null;
  });
  return conexao;
}

/** Roda `corpo` numa transação e devolve o que ele deixou em `saida` quando ela conclui. */
async function transacao<T>(
  tabelas: string[],
  modo: IDBTransactionMode,
  corpo: (tx: IDBTransaction, saida: { valor?: T }) => void,
  /** conexão fixa (exportação): se ela fechar, a transação falha em vez de abrir outra */
  conexaoFixa?: IDBDatabase,
): Promise<T> {
  const db = conexaoFixa ?? (await abrir());
  return new Promise<T>((ok, falha) => {
    const tx = db.transaction(tabelas, modo);
    const saida: { valor?: T } = {};
    tx.oncomplete = () => ok(saida.valor as T);
    tx.onabort = () => falha(tx.error ?? new Error('operação no banco de evidências abortada'));
    tx.onerror = () => falha(tx.error ?? new Error('erro no banco de evidências'));
    corpo(tx, saida);
  });
}

export type ResultadoGravacao =
  { acao: 'igual'; revisao: number } | { acao: 'gravada'; revisao: number; apagadas: number[] };

/** Grava a evidência como próxima revisão do jogo (ou nada, se igual à última). */
export function gravarEvidencia(ev: Evidencia): Promise<ResultadoGravacao> {
  return transacao<ResultadoGravacao>([TABELA], 'readwrite', (tx, saida) => {
    const t = tx.objectStore(TABELA);
    const pedido = t.index(POR_JOGO).getAll(ev.meta.idJogo);
    pedido.onsuccess = () => {
      const existentes = (pedido.result as Evidencia[]).map((e) => ({
        revisao: e.meta.revisao,
        hash: e.meta.hash,
      }));
      const plano = planejarRevisao(existentes, ev.meta.hash);
      if (plano.acao === 'igual') {
        saida.valor = { acao: 'igual', revisao: plano.revisao };
        return;
      }
      t.add({ ...ev, meta: { ...ev.meta, revisao: plano.revisao } });
      for (const n of plano.apagar) t.delete([ev.meta.idJogo, n]);
      saida.valor = { acao: 'gravada', revisao: plano.revisao, apagadas: plano.apagar };
    };
  });
}

/** Todas as revisões de uma vez (só para conferências; o backup usa paginasDeEvidencias). */
export function lerEvidencias(): Promise<Evidencia[]> {
  return transacao<Evidencia[]>([TABELA], 'readonly', (tx, saida) => {
    const pedido = tx.objectStore(TABELA).getAll();
    pedido.onsuccess = () => {
      saida.valor = pedido.result as Evidencia[];
    };
  });
}

/**
 * Revisões em páginas, na ordem da chave (jogo, revisão), cada página numa leitura própria:
 * a memória guarda uma página por vez, não o banco inteiro. Todas as páginas usam a MESMA
 * conexão: se o banco for fechado, apagado ou atualizado no meio (outra aba, "limpar dados do
 * site"), a leitura falha — e o backup é cancelado — em vez de continuar num banco novo e vazio
 * e entregar um arquivo com parte das revisões e rodapé de completo.
 */
export async function* paginasDeEvidencias(tamanho = TAMANHO_LOTE): AsyncGenerator<Evidencia[]> {
  const db = await abrir();
  let depoisDe: IDBValidKey | null = null;
  for (;;) {
    const faixa: IDBKeyRange | null =
      depoisDe === null ? null : IDBKeyRange.lowerBound(depoisDe, true);
    const pagina = await transacao<Evidencia[]>(
      [TABELA],
      'readonly',
      (tx, saida) => {
        const pedido = tx.objectStore(TABELA).getAll(faixa, tamanho);
        pedido.onsuccess = () => {
          saida.valor = pedido.result as Evidencia[];
        };
      },
      db,
    );
    if (!pagina.length) return;
    yield pagina;
    const ultima = pagina[pagina.length - 1];
    depoisDe = [ultima.meta.idJogo, ultima.meta.revisao];
    if (pagina.length < tamanho) return;
  }
}

/* ---------- importação em lotes, com diário ---------- */

export type EstadoImportacao = 'em-andamento' | 'concluida' | 'falhou' | 'desfeita';

export interface DiarioImportacao {
  id: string;
  arquivo: string;
  iniciadaEm: string;
  atualizadaEm: string;
  /** revisões no arquivo (já conferidas) */
  esperadas: number;
  /** revisões já tratadas em lotes concluídos (gravadas + já existentes) */
  processadas: number;
  novas: number;
  jaExistiam: number;
  /** chegaram com número já ocupado por outro conteúdo: guardadas com número novo */
  renumeradas: number;
  estado: EstadoImportacao;
  erro?: string;
  /** desfazer: revisões removidas */
  removidas?: number;
  /**
   * SHA-256 da lista (jogo, revisão, horário original, hash) de todas as revisões do arquivo,
   * na ordem: identifica o backup pelo conteúdo, não pelo nome nem pela contagem.
   */
  impressao?: string;
  /** tentativa interrompida que uma reimportação completa do mesmo backup terminou */
  completadaPor?: string;
  /** tentativas interrompidas do mesmo backup que esta importação completou: o desfazer as leva */
  incorpora?: string[];
}

export interface ResultadoImportacao {
  lote: string;
  novas: number;
  jaExistiam: number;
  renumeradas: number;
  /** tentativas interrompidas deste mesmo backup que esta importação completou */
  incorporadas: string[];
}

const novoLote = () => `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function gravarDiario(d: DiarioImportacao): Promise<void> {
  return transacao<void>([DIARIO], 'readwrite', (tx) => {
    tx.objectStore(DIARIO).put(d);
  });
}

const pendente = (d: DiarioImportacao) => d.estado === 'em-andamento' || d.estado === 'falhou';

/**
 * Tentativas interrompidas do MESMO backup (mesma impressão digital SHA-256, nunca só o mesmo
 * nome ou a mesma contagem) que a importação `d`, ao concluir, incorpora.
 */
export function tentativasIncorporadas(diarios: DiarioImportacao[], d: DiarioImportacao): string[] {
  if (!d.impressao) return [];
  return diarios
    .filter((v) => v.id !== d.id && pendente(v) && v.impressao === d.impressao)
    .map((v) => v.id);
}

/**
 * O que "desfazer" leva: a operação lógica inteira. Pedido sobre uma tentativa incorporada vale
 * para a importação que a completou; a importação leva as tentativas que incorporou. Nunca
 * entram lotes de outras importações nem revisões sem lote (as gravadas pelo aparelho).
 */
export function lotesDoDesfazer(diarios: DiarioImportacao[], lote: string): string[] {
  const pedido = diarios.find((x) => x.id === lote);
  const raiz = pedido?.completadaPor
    ? (diarios.find((x) => x.id === pedido.completadaPor) ?? pedido)
    : pedido;
  if (!raiz) return [lote];
  return [raiz.id, ...(raiz.incorpora ?? [])];
}

/**
 * Marca a importação como concluída e, na mesma transação, dá por completadas as tentativas
 * interrompidas do MESMO backup (tentativasIncorporadas): esta passou por todas as revisões
 * dele, então o que elas gravaram faz parte do resultado e passa a ser desfeito junto com ela
 * (`incorpora`). Sem isso o aviso continuaria e o desfazer ficaria pela metade. Nada é apagado.
 */
function concluirComTentativas(d: DiarioImportacao): Promise<DiarioImportacao> {
  return transacao<DiarioImportacao>([DIARIO], 'readwrite', (tx, saida) => {
    const loja = tx.objectStore(DIARIO);
    const pedido = loja.getAll();
    pedido.onsuccess = () => {
      const todos = pedido.result as DiarioImportacao[];
      const incorpora = tentativasIncorporadas(todos, d);
      const final: DiarioImportacao = incorpora.length ? { ...d, incorpora } : d;
      loja.put(final);
      for (const v of todos)
        if (incorpora.includes(v.id))
          loja.put({
            ...v,
            estado: 'concluida',
            completadaPor: d.id,
            atualizadaEm: d.atualizadaEm,
          });
      saida.valor = final;
    };
  });
}

/** Um lote: revisões novas + diário atualizado, na MESMA transação (tudo ou nada). */
function gravarLote(lote: Evidencia[], diario: DiarioImportacao): Promise<DiarioImportacao> {
  return transacao<DiarioImportacao>([TABELA, DIARIO], 'readwrite', (tx, saida) => {
    const t = tx.objectStore(TABELA);
    const porJogo = new Map<string, Evidencia[]>();
    for (const e of lote) porJogo.set(e.meta.idJogo, [...(porJogo.get(e.meta.idJogo) ?? []), e]);
    const novo = { ...diario };
    let faltam = porJogo.size;
    const terminar = () => {
      novo.processadas += lote.length;
      novo.atualizadaEm = new Date().toISOString();
      tx.objectStore(DIARIO).put(novo);
      saida.valor = novo;
    };
    if (!faltam) return terminar();
    for (const [id, vindas] of porJogo) {
      const pedido = t.index(POR_JOGO).getAll(id);
      pedido.onsuccess = () => {
        const existentes = (pedido.result as Evidencia[]).map((e) => ({
          revisao: e.meta.revisao,
          hash: e.meta.hash,
          gravadoEm: e.meta.gravadoEm,
        }));
        for (const p of planejarImportacao(existentes, vindas)) {
          if (p.acao === 'ja-existe') novo.jaExistiam++;
          else {
            t.add({ ...p.evidencia, meta: { ...p.evidencia.meta, loteImportacao: diario.id } });
            novo.novas++;
            if (p.evidencia.meta.importacao) novo.renumeradas++;
          }
        }
        if (--faltam === 0) terminar();
      };
    }
  });
}

/**
 * Importa revisões JÁ CONFERIDAS (SHA-256) em lotes. Cada lote é atômico com o diário; se algo
 * falhar no meio, o diário fica "falhou" com o erro e a contagem exata, e o erro sobe.
 */
export async function importarEvidenciasEmLotes(
  fonte: AsyncIterable<Evidencia> | Iterable<Evidencia>,
  info: { arquivo: string; esperadas: number; impressao: string },
  aoProgredir?: (d: DiarioImportacao) => void,
  tamanho = TAMANHO_LOTE,
): Promise<ResultadoImportacao> {
  const agora = new Date().toISOString();
  let diario: DiarioImportacao = {
    id: novoLote(),
    arquivo: info.arquivo,
    impressao: info.impressao,
    iniciadaEm: agora,
    atualizadaEm: agora,
    esperadas: info.esperadas,
    processadas: 0,
    novas: 0,
    jaExistiam: 0,
    renumeradas: 0,
    estado: 'em-andamento',
  };
  await gravarDiario(diario);
  try {
    let lote: Evidencia[] = [];
    for await (const ev of fonte) {
      lote.push(ev);
      if (lote.length >= tamanho) {
        diario = await gravarLote(lote, diario);
        aoProgredir?.(diario);
        lote = [];
      }
    }
    if (lote.length) diario = await gravarLote(lote, diario);
    if (diario.processadas !== diario.esperadas)
      throw new Error(
        `processadas ${diario.processadas} de ${diario.esperadas} revisões esperadas`,
      );
    diario = { ...diario, estado: 'concluida', atualizadaEm: new Date().toISOString() };
    diario = await concluirComTentativas(diario);
    aoProgredir?.(diario);
    return {
      lote: diario.id,
      novas: diario.novas,
      jaExistiam: diario.jaExistiam,
      renumeradas: diario.renumeradas,
      incorporadas: diario.incorpora ?? [],
    };
  } catch (e) {
    const erro = (e as Error)?.message ?? String(e);
    await gravarDiario({
      ...diario,
      estado: 'falhou',
      erro,
      atualizadaEm: new Date().toISOString(),
    }).catch(() => undefined);
    throw new Error(
      `importação interrompida: ${diario.processadas} de ${diario.esperadas} revisões tratadas (${diario.novas} gravadas). ${erro}`,
    );
  }
}

/** Lista já em memória (backup .json antigo): o mesmo caminho em lotes, com diário. */
export async function importarEvidencias(
  vindas: Evidencia[],
  arquivo = 'backup .json',
): Promise<ResultadoImportacao> {
  return importarEvidenciasEmLotes(vindas, {
    arquivo,
    esperadas: vindas.length,
    impressao: await impressaoDoBackup(vindas.map((e) => chaveRevisao(e.meta))),
  });
}

/** Todas as importações registradas (pendentes, concluídas, desfeitas), para a tela. */
export function lerDiarios(): Promise<DiarioImportacao[]> {
  return transacao<DiarioImportacao[]>([DIARIO], 'readonly', (tx, saida) => {
    const pedido = tx.objectStore(DIARIO).getAll();
    pedido.onsuccess = () => {
      saida.valor = pedido.result as DiarioImportacao[];
    };
  });
}

/** Importações que não terminaram (interrompidas ou com falha), para avisar e oferecer saída. */
export async function importacoesPendentes(): Promise<DiarioImportacao[]> {
  return (await lerDiarios()).filter(pendente);
}

/**
 * Desfaz uma importação inteira (lotesDoDesfazer: ela e as tentativas interrompidas do mesmo
 * backup que ela completou). Apaga SÓ as revisões marcadas com esses lotes — nunca as gravadas
 * pelo aparelho nem as de outra importação — na mesma transação que marca cada diário como
 * "desfeita", com quantas revisões saíram de cada um.
 */
export function desfazerImportacao(lote: string): Promise<number> {
  return transacao<number>([TABELA, DIARIO], 'readwrite', (tx, saida) => {
    const diarios = tx.objectStore(DIARIO).getAll();
    diarios.onsuccess = () => {
      const todos = diarios.result as DiarioImportacao[];
      const lotes = lotesDoDesfazer(todos, lote);
      const porLote = new Map(lotes.map((l) => [l, 0]));
      const cursor = tx.objectStore(TABELA).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          const dele = (c.value as Evidencia).meta.loteImportacao;
          if (dele !== undefined && porLote.has(dele)) {
            c.delete();
            porLote.set(dele, (porLote.get(dele) ?? 0) + 1);
          }
          c.continue();
          return;
        }
        const agora = new Date().toISOString();
        for (const d of todos)
          if (porLote.has(d.id))
            tx.objectStore(DIARIO).put({
              ...d,
              estado: 'desfeita',
              removidas: porLote.get(d.id),
              atualizadaEm: agora,
            });
        saida.valor = [...porLote.values()].reduce((a, b) => a + b, 0);
      };
    };
  });
}

/** Abre o banco de evidências (ou falha): o backup decide ANTES de começar se elas vão junto. */
export async function abrirBancoEvidencias(): Promise<void> {
  await abrir();
}

export interface AvisoEvidencia {
  /** falha: a evidência não foi gravada; descarte: gravou e o limite de 50 tirou revisões */
  tipo: 'falha' | 'descarte';
  texto: string;
}

/** "2 a 32", "2, 5 e 9" (até 10 números; depois, "…"). */
function numeros(lista: number[]): string {
  const o = [...lista].sort((a, b) => a - b);
  if (o.length > 1 && o[o.length - 1] - o[0] === o.length - 1)
    return `${o[0]} a ${o[o.length - 1]}`;
  const mostra = o.slice(0, 10).map(String);
  if (o.length > 10) return `${mostra.join(', ')}…`;
  return mostra.length > 1
    ? `${mostra.slice(0, -1).join(', ')} e ${mostra[mostra.length - 1]}`
    : mostra.join('');
}

/** Texto do aviso quando uma gravação local descarta revisões pelo limite de 50 por jogo. */
export function avisoDeDescarte(jogo: string, apagadas: number[]): string {
  const n = apagadas.length;
  return (
    `Limite de ${LIMITE_REVISOES} revisões por jogo: ${n} revisão(ões) antiga(s) de ${jogo} ` +
    `foram descartada(s) neste aparelho (nº ${numeros(apagadas)}). Ficam a 1ª e as ` +
    `${LIMITE_REVISOES - 1} mais recentes; um backup exportado antes desta gravação ainda as tem.`
  );
}

/**
 * Monta e grava a evidência da análise salva. Nunca lança: devolve um aviso quando não conseguiu
 * gravar (o histórico — já gravado antes desta chamada — não depende dela) ou quando a gravação
 * descartou revisões pelo limite de 50 (o descarte nunca acontece calado).
 */
export async function registrarEvidencia(
  idJogo: string,
  r: Rascunho,
  d: Derivado,
  ctx: ContextoCalculo,
): Promise<AvisoEvidencia | null> {
  try {
    if (!antesDoApito(r)) return null;
    const g = await gravarEvidencia(await montarEvidencia(idJogo, r, d, ctx));
    if (g.acao === 'gravada' && g.apagadas.length) {
      const jogo = `${r.jogo.casa || 'Mandante'} × ${r.jogo.fora || 'Visitante'}`;
      return { tipo: 'descarte', texto: avisoDeDescarte(jogo, g.apagadas) };
    }
    return null;
  } catch (e) {
    return {
      tipo: 'falha',
      texto: `A análise foi salva no histórico, mas a evidência não foi gravada: ${(e as Error).message}`,
    };
  }
}
