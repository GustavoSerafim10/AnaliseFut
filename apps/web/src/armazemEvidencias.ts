/**
 * Banco das evidências (Fase 0): IndexedDB próprio, separado do banco do histórico
 * ("pricing-engine", armazem.ts) e de qualquer armazenamento do Ledger.
 *
 * Concorrência: cada gravação é UMA transação readwrite que lê as revisões do jogo, decide a
 * próxima (planejarRevisao) e grava com add(). Transações readwrite no mesmo depósito rodam uma
 * de cada vez, inclusive entre abas; e add() nunca sobrescreve: número já usado aborta a
 * transação inteira em vez de trocar o conteúdo calado.
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
const TABELA = 'revisoes';
const POR_JOGO = 'porJogo';

let conexao: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (conexao) return conexao;
  conexao = new Promise<IDBDatabase>((ok, falha) => {
    if (typeof indexedDB === 'undefined') {
      falha(new Error('este navegador não tem banco (IndexedDB)'));
      return;
    }
    const pedido = indexedDB.open(NOME_BANCO, 1);
    pedido.onupgradeneeded = () => {
      const t = pedido.result.createObjectStore(TABELA, {
        keyPath: ['meta.idJogo', 'meta.revisao'],
      });
      t.createIndex(POR_JOGO, 'meta.idJogo');
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

/** Roda `corpo` numa transação readwrite e devolve o que ele deixou em `saida` ao concluir. */
async function transacao<T>(corpo: (t: IDBObjectStore, saida: { valor?: T }) => void): Promise<T> {
  const db = await abrir();
  return new Promise<T>((ok, falha) => {
    const tx = db.transaction(TABELA, 'readwrite');
    const saida: { valor?: T } = {};
    tx.oncomplete = () => ok(saida.valor as T);
    tx.onabort = () => falha(tx.error ?? new Error('gravação de evidência abortada'));
    tx.onerror = () => falha(tx.error ?? new Error('erro ao gravar evidência'));
    corpo(tx.objectStore(TABELA), saida);
  });
}

export type ResultadoGravacao =
  { acao: 'igual'; revisao: number } | { acao: 'gravada'; revisao: number; apagadas: number[] };

/** Grava a evidência como próxima revisão do jogo (ou nada, se igual à última). */
export function gravarEvidencia(ev: Evidencia): Promise<ResultadoGravacao> {
  return transacao<ResultadoGravacao>((t, saida) => {
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

/** Todas as revisões guardadas (para o backup). */
export async function lerEvidencias(): Promise<Evidencia[]> {
  return transacao<Evidencia[]>((t, saida) => {
    const pedido = t.getAll();
    pedido.onsuccess = () => {
      saida.valor = pedido.result as Evidencia[];
    };
  });
}

export interface ResultadoImportacao {
  novas: number;
  jaExistiam: number;
  /** chegaram com número já ocupado por outro conteúdo: guardadas com número novo */
  renumeradas: number;
}

/** Junta revisões de um backup sem sobrescrever nem podar nada (planejarImportacao). */
export function importarEvidencias(vindas: Evidencia[]): Promise<ResultadoImportacao> {
  return transacao<ResultadoImportacao>((t, saida) => {
    const pedido = t.getAll();
    pedido.onsuccess = () => {
      const r: ResultadoImportacao = { novas: 0, jaExistiam: 0, renumeradas: 0 };
      const porJogo = new Map<string, Evidencia[]>();
      for (const e of vindas)
        porJogo.set(e.meta.idJogo, [...(porJogo.get(e.meta.idJogo) ?? []), e]);
      const atuais = pedido.result as Evidencia[];
      for (const [id, doJogo] of porJogo) {
        const existentes = atuais
          .filter((e) => e.meta.idJogo === id)
          .map((e) => ({ revisao: e.meta.revisao, hash: e.meta.hash }));
        for (const p of planejarImportacao(existentes, doJogo)) {
          if (p.acao === 'ja-existe') r.jaExistiam++;
          else {
            t.add(p.evidencia);
            r.novas++;
            if (p.evidencia.meta.importacao) r.renumeradas++;
          }
        }
      }
      saida.valor = r;
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
