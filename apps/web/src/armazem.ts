/**
 * Banco do navegador (IndexedDB) para o histórico: o localStorage só comporta cerca de 100
 * análises. A migração é conservadora: copia, lê de volta, compara e só então apaga a cópia antiga.
 */
export interface ItemDoHistorico {
  id: string;
  salvoEm: string;
}

export interface Deposito<T> {
  ler(): Promise<T[] | undefined>;
  gravar(lista: T[]): Promise<void>;
}

export interface CopiaAntiga {
  ler(): string | null;
  apagar(): void;
}

/** Mesmo id nos dois lados: fica a versão salva por último (uma aba antiga pode ter gravado). */
export function juntarCopias<T extends ItemDoHistorico>(banco: T[], antiga: T[]): T[] {
  const mapa = new Map(banco.map((e) => [e.id, e]));
  for (const e of antiga) {
    const ja = mapa.get(e.id);
    if (!ja || e.salvoEm > ja.salvoEm) mapa.set(e.id, e);
  }
  return [...mapa.values()];
}

/**
 * Devolve a lista já no banco. Qualquer falha lança erro com a cópia antiga intacta. Cópia antiga
 * ilegível também fica: pode ser recuperada à mão, e não vale perder dado por causa dela.
 */
export async function migrarHistorico<T extends ItemDoHistorico>(
  deposito: Deposito<T>,
  copia: CopiaAntiga,
): Promise<T[]> {
  const noBanco = (await deposito.ler()) ?? [];
  const texto = copia.ler();
  if (texto === null) return noBanco;
  let antiga: unknown;
  try {
    antiga = JSON.parse(texto);
  } catch {
    return noBanco;
  }
  if (!Array.isArray(antiga)) return noBanco;
  const juntas = juntarCopias(noBanco, antiga as T[]);
  await deposito.gravar(juntas);
  const conferida = await deposito.ler();
  if (JSON.stringify(conferida) !== JSON.stringify(juntas))
    throw new Error('o banco não devolveu o que foi gravado');
  copia.apagar();
  return juntas;
}

const NOME_BANCO = 'pricing-engine';
const TABELA = 'dados';

/** Abre o banco e devolve o depósito de uma chave. Lança se o navegador não tiver IndexedDB. */
export function abrirDeposito<T>(chave: string): Promise<Deposito<T>> {
  return new Promise((ok, falha) => {
    const pedido = indexedDB.open(NOME_BANCO, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(TABELA);
    pedido.onerror = () => falha(pedido.error ?? new Error('banco indisponível'));
    pedido.onblocked = () => falha(new Error('banco bloqueado por outra aba'));
    pedido.onsuccess = () => {
      const banco = pedido.result;
      ok({
        ler: () =>
          new Promise((fim, erro) => {
            const r = banco.transaction(TABELA, 'readonly').objectStore(TABELA).get(chave);
            r.onsuccess = () => fim(r.result as T[] | undefined);
            r.onerror = () => erro(r.error ?? new Error('falha ao ler'));
          }),
        gravar: (lista) =>
          new Promise((fim, erro) => {
            const t = banco.transaction(TABELA, 'readwrite');
            t.objectStore(TABELA).put(lista, chave);
            t.oncomplete = () => fim();
            t.onerror = () => erro(t.error ?? new Error('falha ao gravar'));
            t.onabort = () => erro(t.error ?? new Error('gravação cancelada'));
          }),
      });
    };
  });
}
