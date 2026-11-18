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
): Promise<T> {
  const db = await abrir();
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
 * a memória guarda uma página por vez, não o banco inteiro.
 */
export async function* paginasDeEvidencias(tamanho = TAMANHO_LOTE): AsyncGenerator<Evidencia[]> {
  let depoisDe: IDBValidKey | null = null;
  for (;;) {
    const faixa: IDBKeyRange | null =
      depoisDe === null ? null : IDBKeyRange.lowerBound(depoisDe, true);
    const pagina = await transacao<Evidencia[]>([TABELA], 'readonly', (tx, saida) => {
      const pedido = tx.objectStore(TABELA).getAll(faixa, tamanho);
      pedido.onsuccess = () => {
        saida.valor = pedido.result as Evidencia[];
      };
    });
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
}

export interface ResultadoImportacao {
  lote: string;
  novas: number;
  jaExistiam: number;
  renumeradas: number;
}

const novoLote = () => `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function gravarDiario(d: DiarioImportacao): Promise<void> {
  return transacao<void>([DIARIO], 'readwrite', (tx) => {
    tx.objectStore(DIARIO).put(d);
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
  info: { arquivo: string; esperadas: number },
  aoProgredir?: (d: DiarioImportacao) => void,
  tamanho = TAMANHO_LOTE,
): Promise<ResultadoImportacao> {
  const agora = new Date().toISOString();
  let diario: DiarioImportacao = {
    id: novoLote(),
    arquivo: info.arquivo,
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
    await gravarDiario(diario);
    aoProgredir?.(diario);
    return {
      lote: diario.id,
      novas: diario.novas,
      jaExistiam: diario.jaExistiam,
      renumeradas: diario.renumeradas,
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
export function importarEvidencias(
  vindas: Evidencia[],
  arquivo = 'backup .json',
): Promise<ResultadoImportacao> {
  return importarEvidenciasEmLotes(vindas, { arquivo, esperadas: vindas.length });
}

/** Importações que não terminaram (interrompidas ou com falha), para avisar e oferecer saída. */
export function importacoesPendentes(): Promise<DiarioImportacao[]> {
  return transacao<DiarioImportacao[]>([DIARIO], 'readonly', (tx, saida) => {
    const pedido = tx.objectStore(DIARIO).getAll();
    pedido.onsuccess = () => {
      saida.valor = (pedido.result as DiarioImportacao[]).filter(
        (d) => d.estado === 'em-andamento' || d.estado === 'falhou',
      );
    };
  });
}

/**
 * Desfaz uma importação: apaga SÓ as revisões marcadas com o lote dela (nunca as gravadas pelo
 * aparelho nem as de outra importação), na mesma transação que marca o diário como "desfeita".
 */
export function desfazerImportacao(lote: string): Promise<number> {
  return transacao<number>([TABELA, DIARIO], 'readwrite', (tx, saida) => {
    let removidas = 0;
    const cursor = tx.objectStore(TABELA).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        if ((c.value as Evidencia).meta.loteImportacao === lote) {
          c.delete();
          removidas++;
        }
        c.continue();
        return;
      }
      const d = tx.objectStore(DIARIO).get(lote);
      d.onsuccess = () => {
        if (d.result)
          tx.objectStore(DIARIO).put({
            ...(d.result as DiarioImportacao),
            estado: 'desfeita',
            removidas,
            atualizadaEm: new Date().toISOString(),
          });
        saida.valor = removidas;
      };
    };
  });
}

/**
 * Monta e grava a evidência da análise salva. Nunca lança: devolve um aviso (texto) quando não
 * conseguiu, e o histórico — já gravado antes desta chamada — não depende dela.
 */
export async function registrarEvidencia(
  idJogo: string,
  r: Rascunho,
  d: Derivado,
  ctx: ContextoCalculo,
): Promise<string | null> {
  try {
    if (!antesDoApito(r)) return null;
    await gravarEvidencia(await montarEvidencia(idJogo, r, d, ctx));
    return null;
  } catch (e) {
    return `A análise foi salva no histórico, mas a evidência não foi gravada: ${(e as Error).message}`;
  }
}
