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
 *
 * Versão 3 do banco: índice de IDENTIDADE (jogo + hash + horário original) nas revisões, para a
 * conclusão de uma importação conferir, dentro da própria transação, que cada revisão do backup
 * está de fato no banco — sem ler o conteúdo delas.
 */
import type { Derivado } from './dados';
import type { Rascunho } from './estado';
import {
  antesDoApito,
  chaveRevisao,
  impressaoDigital,
  impressaoDoBackup,
  LIMITE_REVISOES,
  montarEvidencia,
  planejarImportacao,
  planejarRevisao,
  type ContextoCalculo,
  type Evidencia,
} from './evidencias';

const NOME_BANCO = 'pe-evidencias';
const VERSAO_BANCO = 3;
const TABELA = 'revisoes';
const POR_JOGO = 'porJogo';
const POR_IDENTIDADE = 'porIdentidade';
/**
 * Identidade de presença de uma revisão: jogo + hash do conteúdo + horário ORIGINAL de gravação
 * (meta.gravadoEm, nunca o horário da importação). O número da revisão fica de fora porque a
 * importação pode renumerar (conflito); é a mesma identidade que planejarImportacao usa para
 * reconhecer uma revisão já gravada, e os mesmos campos de chaveRevisao (que inclui o número e
 * forma a impressão digital do arquivo e a conferência linha a linha da 2ª leitura).
 */
const CAMPOS_IDENTIDADE = ['meta.idJogo', 'meta.hash', 'meta.gravadoEm'];
export const identidadePresenca = (
  meta: Pick<Evidencia['meta'], 'idJogo' | 'hash' | 'gravadoEm'>,
): [string, string, string] => [meta.idJogo, meta.hash, meta.gravadoEm];
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
      // 1 → 2 acrescenta o diário; 2 → 3 acrescenta o índice de identidade (o navegador indexa
      // as revisões que já existem). Nada é apagado nem regravado.
      const t = db.objectStoreNames.contains(TABELA)
        ? pedido.transaction!.objectStore(TABELA)
        : db.createObjectStore(TABELA, { keyPath: ['meta.idJogo', 'meta.revisao'] });
      if (!t.indexNames.contains(POR_JOGO)) t.createIndex(POR_JOGO, 'meta.idJogo');
      if (!t.indexNames.contains(POR_IDENTIDADE)) t.createIndex(POR_IDENTIDADE, CAMPOS_IDENTIDADE);
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
  corpo: (tx: IDBTransaction, saida: { valor?: T }, abortar: (e: Error) => void) => void,
  /** conexão fixa (exportação): se ela fechar, a transação falha em vez de abrir outra */
  conexaoFixa?: IDBDatabase,
): Promise<T> {
  const db = conexaoFixa ?? (await abrir());
  return new Promise<T>((ok, falha) => {
    const tx = db.transaction(tabelas, modo);
    const saida: { valor?: T } = {};
    tx.oncomplete = () => ok(saida.valor as T);
    let motivo: Error | null = null;
    tx.onabort = () =>
      falha(motivo ?? tx.error ?? new Error('operação no banco de evidências abortada'));
    tx.onerror = () => falha(tx.error ?? new Error('erro no banco de evidências'));
    corpo(tx, saida, (e) => {
      motivo = e;
      tx.abort();
    });
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
  /**
   * Revisões que esta importação encontrou já gravadas POR OUTRA importação (lote → quantas):
   * se aquela for desfeita, estas somem também, e esta importação fica marcada (desfalques).
   */
  apoio?: Record<string, number>;
  /** revisões que esta importação contava e que saíram ao desfazer outra (reimportar recompõe) */
  desfalques?: {
    por: string;
    arquivo: string;
    revisoes: number;
    em: string;
    /** por que faltam (ex.: conferência de presença na conclusão); sem motivo: outra desfeita */
    motivo?: string;
    /** algumas das identidades ausentes (jogo · horário original), para conferir */
    exemplos?: string[];
  }[];
  /** reimportação do mesmo backup que recompôs os desfalques */
  recompostaPor?: string;
}

export interface ResultadoImportacao {
  lote: string;
  novas: number;
  jaExistiam: number;
  renumeradas: number;
  /** tentativas interrompidas deste mesmo backup que esta importação completou */
  incorporadas: string[];
}

/** A importação foi desfeita ou completada por outra aba enquanto rodava: parou sem gravar mais. */
export class ImportacaoEncerrada extends Error {}

const novoLote = () => `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function gravarDiario(d: DiarioImportacao): Promise<void> {
  return transacao<void>([DIARIO], 'readwrite', (tx) => {
    tx.objectStore(DIARIO).put(d);
  });
}

const pendente = (d: DiarioImportacao) => d.estado === 'em-andamento' || d.estado === 'falhou';

/* Trava por importação (Web Locks, vale entre abas da mesma origem): diz se uma importação
 * "em andamento" está VIVA (alguma aba rodando) ou morreu (aba fechada no meio). */
const PREFIXO_TRAVA = 'pe-evidencias-importacao:';
const travas = (): LockManager | undefined =>
  typeof navigator !== 'undefined' ? navigator.locks : undefined;

/** Ids das importações rodando agora em alguma aba (vazio se o navegador não tem Web Locks). */
export async function importacoesVivas(): Promise<Set<string>> {
  const l = travas();
  if (!l) return new Set();
  try {
    const { held = [] } = await l.query();
    return new Set(
      held
        .map((x) => x.name ?? '')
        .filter((n) => n.startsWith(PREFIXO_TRAVA))
        .map((n) => n.slice(PREFIXO_TRAVA.length)),
    );
  } catch {
    return new Set();
  }
}

/**
 * Tentativas interrompidas do MESMO backup (mesma impressão digital SHA-256, nunca só o mesmo
 * nome ou a mesma contagem) que a importação `d`, ao concluir, incorpora. Uma tentativa ainda
 * VIVA em outra aba não é incorporada: ela termina por conta própria.
 */
export function tentativasIncorporadas(
  diarios: DiarioImportacao[],
  d: DiarioImportacao,
  vivas: Set<string> = new Set(),
): string[] {
  if (!d.impressao) return [];
  return diarios
    .filter((v) => v.id !== d.id && pendente(v) && !vivas.has(v.id) && v.impressao === d.impressao)
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
 * Outras importações que contaram revisões destes lotes como "já existiam": desfazer os lotes
 * as deixa sem essas revisões. Servem para o aviso antes de desfazer e para marcá-las depois.
 */
export function dependentesDoDesfazer(
  diarios: DiarioImportacao[],
  lotes: string[],
): { id: string; arquivo: string; revisoes: number }[] {
  return diarios
    .filter((d) => !lotes.includes(d.id) && d.estado !== 'desfeita' && d.apoio)
    .map((d) => ({
      id: d.id,
      arquivo: d.arquivo,
      revisoes: lotes.reduce((a, l) => a + (d.apoio?.[l] ?? 0), 0),
    }))
    .filter((x) => x.revisoes > 0);
}

/** O diário desta importação ainda permite gravar? Senão, por quê. */
export function motivoParaParar(atual: DiarioImportacao | undefined): string | null {
  if (!atual) return 'o diário desta importação não existe mais';
  if (atual.estado === 'em-andamento') return null;
  if (atual.estado === 'desfeita') return 'esta importação foi desfeita em outra aba';
  if (atual.completadaPor)
    return 'outra importação do mesmo backup já completou esta (em outra aba)';
  return `esta importação já está "${atual.estado}"`;
}

/** O que um lote mudou nas contagens (somado ao diário LIDO DO BANCO, nunca a uma cópia). */
export interface ContagemLote {
  processadas: number;
  novas: number;
  jaExistiam: number;
  renumeradas: number;
  /** lote de outra importação → revisões dele que este lote encontrou já gravadas */
  apoio: Record<string, number>;
}

/**
 * Diário depois de um lote: parte da cópia lida do banco na transação do lote e muda só as
 * contagens e o horário. Tudo o que outra aba gravou nele (desfalques, por exemplo) fica.
 */
export function aplicarLote(
  atual: DiarioImportacao,
  c: ContagemLote,
  agora: string,
): DiarioImportacao {
  const apoio = { ...atual.apoio };
  for (const [l, n] of Object.entries(c.apoio)) apoio[l] = (apoio[l] ?? 0) + n;
  return {
    ...atual,
    processadas: atual.processadas + c.processadas,
    novas: atual.novas + c.novas,
    jaExistiam: atual.jaExistiam + c.jaExistiam,
    renumeradas: atual.renumeradas + c.renumeradas,
    ...(Object.keys(apoio).length ? { apoio } : {}),
    atualizadaEm: agora,
  };
}

/**
 * Recomposição comprovada: `d` (lido do banco na transação de conclusão) passou por TODAS as
 * revisões do backup (processadas = esperadas, mesma impressão SHA-256 das identidades jogo,
 * número, horário original e hash) e cada uma foi gravada por ela ou achada já gravada pela
 * mesma identidade (hash + horário original). Se, desde então, alguma das achadas saiu porque
 * outra importação foi desfeita, `d` já tem desfalques próprios — e então nada está comprovado.
 * Na conclusão, ainda se exige a conferência de presença (avaliarPresenca) sem nenhuma ausente.
 */
export function recomposicaoComprovada(d: DiarioImportacao): boolean {
  return (
    d.estado === 'em-andamento' &&
    !!d.impressao &&
    d.processadas === d.esperadas &&
    !d.desfalques?.length
  );
}

/**
 * Identidades do backup ausentes do banco: `esperadas` são as identidades de presença (sem
 * repetição) e `contagens[i]` quantas revisões do banco têm a identidade `esperadas[i]`.
 * Identidade repetida no arquivo é a mesma revisão (mesmo conteúdo, mesmo horário): conta uma vez.
 */
export function avaliarPresenca(
  esperadas: [string, string, string][],
  contagens: number[],
): { ausentes: [string, string, string][] } {
  return { ausentes: esperadas.filter((_, i) => !(contagens[i] > 0)) };
}

/** Identidades de presença sem repetição, na ordem em que aparecem. */
export function identidadesUnicas(lista: [string, string, string][]): [string, string, string][] {
  const vistas = new Set<string>();
  return lista.filter((x) => {
    const k = JSON.stringify(x);
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/** Desfalque registrado quando a conferência de presença da conclusão acha revisões ausentes. */
export function desfalqueDeConferencia(
  d: DiarioImportacao,
  ausentes: [string, string, string][],
  agora: string,
): NonNullable<DiarioImportacao['desfalques']>[number] {
  return {
    por: d.id,
    arquivo: d.arquivo,
    revisoes: ausentes.length,
    em: agora,
    motivo:
      'ausentes do banco na conclusão (conferência por jogo + hash + horário original); a recomposição não foi comprovada — reimporte o arquivo',
    exemplos: ausentes.slice(0, 3).map(([jogo, , gravadoEm]) => `${jogo} · ${gravadoEm}`),
  };
}

/**
 * Tentativa ou importação do mesmo backup reconciliada por `d`: com a recomposição comprovada,
 * a marca de desfalque sai e fica registrado quem recompôs; sem ela, a marca fica.
 */
export function reconciliar(
  v: DiarioImportacao,
  d: DiarioImportacao,
  comprovada: boolean,
  agora: string,
): DiarioImportacao {
  if (!v.desfalques?.length || !comprovada) return { ...v, atualizadaEm: agora };
  return {
    ...v,
    desfalques: undefined,
    recompostaPor: d.id,
    // daqui em diante depende do que `d` gravou: desfazer `d` volta a desfalcá-la
    apoio: { ...v.apoio, [d.id]: d.novas },
    atualizadaEm: agora,
  };
}

/** Importações desfalcadas que a tela mostra: concluídas, com desfalque, e não incorporadas. */
export function desfalcadasParaTela(diarios: DiarioImportacao[]): DiarioImportacao[] {
  return diarios.filter(
    (d) => d.estado === 'concluida' && !d.completadaPor && !!d.desfalques?.length,
  );
}

/**
 * Marca a importação como concluída e, na mesma transação, dá por completadas as tentativas
 * interrompidas (e mortas) do MESMO backup: esta passou por todas as revisões dele, então o que
 * elas gravaram faz parte do resultado e passa a ser desfeito junto com ela (`incorpora`).
 * Tudo parte dos diários LIDOS nesta transação: o desta importação só muda estado e horário
 * (desfalques que outra aba marcou ficam). Tentativas incorporadas e importações concluídas do
 * mesmo backup só perdem a marca de desfalque com a recomposição comprovada. Se o diário desta
 * já não estiver "em andamento", nada é gravado e a importação para com ImportacaoEncerrada.
 */
function concluirComTentativas(
  id: string,
  vivas: Set<string>,
  identidades: [string, string, string][],
): Promise<DiarioImportacao> {
  // escopo com as revisões: a conferência de presença e a decisão acontecem numa transação de
  // escrita que nenhuma gravação local (poda do limite de 50) nem desfazer consegue intercalar
  return transacao<DiarioImportacao>([TABELA, DIARIO], 'readwrite', (tx, saida, abortar) => {
    const loja = tx.objectStore(DIARIO);
    const pedido = loja.getAll();
    pedido.onsuccess = () => {
      const todos = pedido.result as DiarioImportacao[];
      const atual = todos.find((x) => x.id === id);
      const parar = motivoParaParar(atual);
      if (parar || !atual) return abortar(new ImportacaoEncerrada(parar ?? 'sem diário'));
      const esperadas = identidadesUnicas(identidades);
      const contagens: number[] = new Array(esperadas.length).fill(0);
      let faltam = esperadas.length;
      const decidir = () => {
        const agora = new Date().toISOString();
        const { ausentes } = avaliarPresenca(esperadas, contagens);
        // comprovada só com: mesmo backup, tudo processado, sem desfalque próprio E tudo presente
        const comprovada = recomposicaoComprovada(atual) && ausentes.length === 0;
        const incorpora = tentativasIncorporadas(todos, atual, vivas);
        const final: DiarioImportacao = {
          ...atual,
          estado: 'concluida',
          atualizadaEm: agora,
          ...(incorpora.length ? { incorpora: [...(atual.incorpora ?? []), ...incorpora] } : {}),
          ...(ausentes.length
            ? {
                desfalques: [
                  ...(atual.desfalques ?? []),
                  desfalqueDeConferencia(atual, ausentes, agora),
                ],
              }
            : {}),
        };
        loja.put(final);
        for (const v of todos) {
          if (incorpora.includes(v.id))
            loja.put({
              ...reconciliar(v, atual, comprovada, agora),
              estado: 'concluida',
              completadaPor: id,
            });
          else if (
            v.id !== id &&
            v.estado === 'concluida' &&
            v.desfalques?.length &&
            atual.impressao &&
            v.impressao === atual.impressao
          )
            loja.put(reconciliar(v, atual, comprovada, agora));
        }
        saida.valor = final;
      };
      if (!faltam) return decidir();
      const indice = tx.objectStore(TABELA).index(POR_IDENTIDADE);
      esperadas.forEach((ident, i) => {
        const conta = indice.count(ident);
        conta.onsuccess = () => {
          contagens[i] = conta.result;
          if (--faltam === 0) decidir();
        };
      });
    };
  });
}

/**
 * Um lote: revisões novas + diário atualizado, na MESMA transação (tudo ou nada). O diário é
 * LIDO do banco nesta transação: se não está "em andamento" (desfeita ou completada por outra
 * aba), o lote é abortado inteiro (ImportacaoEncerrada); se está, só as contagens mudam
 * (aplicarLote), e o que outra aba marcou nele fica.
 */
function gravarLote(lote: Evidencia[], id: string): Promise<DiarioImportacao> {
  return transacao<DiarioImportacao>([TABELA, DIARIO], 'readwrite', (tx, saida, abortar) => {
    const t = tx.objectStore(TABELA);
    const estado = tx.objectStore(DIARIO).get(id);
    estado.onsuccess = () => {
      const atual = estado.result as DiarioImportacao | undefined;
      const parar = motivoParaParar(atual);
      if (parar || !atual) return abortar(new ImportacaoEncerrada(parar ?? 'sem diário'));
      const porJogo = new Map<string, Evidencia[]>();
      for (const e of lote) porJogo.set(e.meta.idJogo, [...(porJogo.get(e.meta.idJogo) ?? []), e]);
      const c: ContagemLote = {
        processadas: lote.length,
        novas: 0,
        jaExistiam: 0,
        renumeradas: 0,
        apoio: {},
      };
      let faltam = porJogo.size;
      const terminar = () => {
        const novo = aplicarLote(atual, c, new Date().toISOString());
        tx.objectStore(DIARIO).put(novo);
        saida.valor = novo;
      };
      if (!faltam) return terminar();
      for (const [jogo, vindas] of porJogo) {
        const pedido = t.index(POR_JOGO).getAll(jogo);
        pedido.onsuccess = () => {
          const guardadas = pedido.result as Evidencia[];
          const loteDe = new Map(guardadas.map((e) => [e.meta.revisao, e.meta.loteImportacao]));
          const existentes = guardadas.map((e) => ({
            revisao: e.meta.revisao,
            hash: e.meta.hash,
            gravadoEm: e.meta.gravadoEm,
          }));
          for (const p of planejarImportacao(existentes, vindas)) {
            if (p.acao === 'ja-existe') {
              c.jaExistiam++;
              // já gravada por OUTRA importação: esta passa a depender dela
              const de = loteDe.get(p.revisao);
              if (de && de !== id) c.apoio[de] = (c.apoio[de] ?? 0) + 1;
            } else {
              t.add({ ...p.evidencia, meta: { ...p.evidencia.meta, loteImportacao: id } });
              c.novas++;
              if (p.evidencia.meta.importacao) c.renumeradas++;
            }
          }
          if (--faltam === 0) terminar();
        };
      }
    };
  });
}

/** Marca "falhou" só se o diário (lido do banco) ainda está "em andamento"; o resto fica. */
function marcarFalha(id: string, erro: string): Promise<void> {
  return transacao<void>([DIARIO], 'readwrite', (tx) => {
    const loja = tx.objectStore(DIARIO);
    const atual = loja.get(id);
    atual.onsuccess = () => {
      const d = atual.result as DiarioImportacao | undefined;
      if (d?.estado === 'em-andamento')
        loja.put({ ...d, estado: 'falhou', erro, atualizadaEm: new Date().toISOString() });
    };
  });
}

/**
 * Trava COMPARTILHADA que toda importação segura do começo ao fim. O desfazer pede a mesma
 * trava em modo EXCLUSIVO e sem esperar (ifAvailable): o gerenciador de travas do navegador só a
 * concede se NENHUMA importação estiver rodando em nenhuma aba, e, enquanto o desfazer a
 * segura, nenhuma importação começa (fica na fila). Não há leitura de "quem está vivo" que
 * possa ficar velha entre a consulta e a transação.
 */
const TRAVA_IMPORTACOES = 'pe-evidencias-importacoes';

/**
 * Importa revisões JÁ CONFERIDAS (SHA-256) em lotes. Cada lote é atômico com o diário; se algo
 * falhar no meio, o diário fica "falhou" com o erro e a contagem exata, e o erro sobe. A
 * importação inteira roda segurando a trava dela (identifica que está viva) e a trava
 * compartilhada das importações (bloqueia o desfazer enquanto ela roda).
 */
export async function importarEvidenciasEmLotes(
  fonte: AsyncIterable<Evidencia> | Iterable<Evidencia>,
  info: { arquivo: string; esperadas: number; impressao: string },
  aoProgredir?: (d: DiarioImportacao) => void,
  tamanho = TAMANHO_LOTE,
): Promise<ResultadoImportacao> {
  const id = novoLote();
  const rodar = () => rodarImportacao(id, fonte, info, aoProgredir, tamanho);
  const l = travas();
  if (!l) return rodar();
  return l.request(PREFIXO_TRAVA + id, () =>
    l.request(TRAVA_IMPORTACOES, { mode: 'shared' }, rodar),
  );
}

/**
 * Recalcula o SHA-256 do conteúdo de cada revisão e exige que seja o meta.hash dela. Roda antes
 * da transação do lote (o cálculo é assíncrono e fecharia a transação): se uma não confere, o
 * lote inteiro não é gravado.
 */
export async function conferirConteudos(lote: Evidencia[]): Promise<void> {
  const calculados = await Promise.all(lote.map((ev) => impressaoDigital(ev.conteudo)));
  calculados.forEach((h, i) => {
    if (h !== lote[i].meta.hash)
      throw new Error(
        `conteúdo diferente do hash na 2ª leitura (jogo ${lote[i].meta.idJogo}, revisão ${lote[i].meta.revisao}): lote não gravado`,
      );
  });
}

async function rodarImportacao(
  id: string,
  fonte: AsyncIterable<Evidencia> | Iterable<Evidencia>,
  info: { arquivo: string; esperadas: number; impressao: string },
  aoProgredir: ((d: DiarioImportacao) => void) | undefined,
  tamanho: number,
): Promise<ResultadoImportacao> {
  const agora = new Date().toISOString();
  let diario: DiarioImportacao = {
    id,
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
  // identidades efetivamente processadas, na ordem: a impressão digital é recalculada com elas
  const chaves: string[] = [];
  const identidades: [string, string, string][] = [];
  /** SHA-256 de cada conteúdo recalculado ANTES do lote: conteúdo ≠ hash, o lote não grava */
  const conferirEGravar = async (lote: Evidencia[]) => {
    await conferirConteudos(lote);
    for (const ev of lote) {
      chaves.push(chaveRevisao(ev.meta));
      identidades.push(identidadePresenca(ev.meta));
    }
    return gravarLote(lote, id);
  };
  try {
    let lote: Evidencia[] = [];
    for await (const ev of fonte) {
      lote.push(ev);
      if (lote.length >= tamanho) {
        diario = await conferirEGravar(lote);
        aoProgredir?.(diario);
        lote = [];
      }
    }
    if (lote.length) diario = await conferirEGravar(lote);
    if (diario.processadas !== diario.esperadas)
      throw new Error(
        `processadas ${diario.processadas} de ${diario.esperadas} revisões esperadas`,
      );
    // identidade: as revisões processadas são exatamente as do arquivo conferido na 1ª leitura
    if ((await impressaoDoBackup(chaves)) !== info.impressao)
      throw new Error(
        'identidades processadas diferentes do arquivo conferido (impressão digital recalculada não confere): nada foi comprovado',
      );
    const vivas = await importacoesVivas();
    diario = await concluirComTentativas(id, vivas, identidades);
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
    if (e instanceof ImportacaoEncerrada)
      throw new ImportacaoEncerrada(
        `importação parada: ${erro}. Ela não gravou mais nada; o diário guarda o que a outra aba fez.`,
      );
    await marcarFalha(id, erro).catch(() => undefined);
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

/** O desfazer foi recusado porque há importação rodando: diz qual precisa terminar. */
export class DesfazerRecusado extends Error {}

/**
 * Por que o desfazer de `lotes` não pode rodar agora: as importações em andamento, dizendo quais
 * fazem parte da operação, quais dependem dela e quais ainda podem passar a depender (toda
 * importação que roda pode achar revisões destes lotes até terminar).
 */
export function motivoRecusaDesfazer(
  diarios: DiarioImportacao[],
  vivas: Set<string>,
  lotes: string[],
): string {
  const dependentes = new Set(dependentesDoDesfazer(diarios, lotes).map((d) => d.id));
  const rodando = diarios.filter((d) => vivas.has(d.id));
  const nomes = rodando.map((d) => {
    const papel = lotes.includes(d.id)
      ? 'parte desta importação'
      : dependentes.has(d.id)
        ? 'depende das revisões desta'
        : 'pode passar a depender delas até terminar';
    return `"${d.arquivo}" (${papel})`;
  });
  return `desfazer recusado: ${
    nomes.length ? `importação rodando — ${nomes.join(', ')}` : 'uma importação está começando'
  }. Espere terminar e tente de novo; nada foi apagado.`;
}

/**
 * Desfaz uma importação inteira (lotesDoDesfazer: ela e as tentativas interrompidas do mesmo
 * backup que ela completou). Apaga SÓ as revisões marcadas com esses lotes — nunca as gravadas
 * pelo aparelho nem as de outra importação — na mesma transação que marca cada diário como
 * "desfeita", com quantas revisões saíram de cada um. Importações que contavam essas revisões
 * como "já existiam" (dependentesDoDesfazer) ficam marcadas com o desfalque, nunca caladas.
 *
 * Com Web Locks, só roda com a trava exclusiva das importações (nenhuma rodando em nenhuma aba;
 * nenhuma começa até terminar); sem ela, recusa com DesfazerRecusado dizendo qual precisa
 * terminar. Sem Web Locks, roda direto: a conferência de estado em cada lote e a marca de
 * desfalque preservada (aplicarLote) impedem que alguma importação apareça completa sem estar.
 */
export async function desfazerImportacao(lote: string): Promise<number> {
  const l = travas();
  if (!l) return desfazerNoBanco(lote);
  return l.request(TRAVA_IMPORTACOES, { mode: 'exclusive', ifAvailable: true }, async (trava) => {
    if (!trava) {
      const [diarios, vivas] = await Promise.all([lerDiarios(), importacoesVivas()]);
      throw new DesfazerRecusado(
        motivoRecusaDesfazer(diarios, vivas, lotesDoDesfazer(diarios, lote)),
      );
    }
    return desfazerNoBanco(lote);
  });
}

function desfazerNoBanco(lote: string): Promise<number> {
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
        const raiz = todos.find((d) => d.id === lotes[0]);
        const loja = tx.objectStore(DIARIO);
        for (const d of todos)
          if (porLote.has(d.id))
            loja.put({
              ...d,
              estado: 'desfeita',
              removidas: porLote.get(d.id),
              atualizadaEm: agora,
            });
        for (const dep of dependentesDoDesfazer(todos, lotes)) {
          const d = todos.find((x) => x.id === dep.id);
          if (!d) continue;
          loja.put({
            ...d,
            desfalques: [
              ...(d.desfalques ?? []),
              {
                por: lotes[0],
                arquivo: raiz?.arquivo ?? lotes[0],
                revisoes: dep.revisoes,
                em: agora,
              },
            ],
            atualizadaEm: agora,
          });
        }
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
