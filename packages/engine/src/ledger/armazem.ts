/**
 * Contrato de GRAVAÇÃO do Ledger, independente do banco: o que um armazém (a futura L2, em
 * IndexedDB) precisa oferecer e a ordem exata em que o anexo é conferido e gravado. Aqui não há
 * IndexedDB, interface nem hooks: só a lógica pura, que roda dentro de qualquer armazém que cumpra
 * `ArmazemLedger`, e que os testes exercitam com um armazém em memória.
 *
 * A TRANSAÇÃO é o que garante a atomicidade: tudo o que `anexarNaTransacao` lê e grava acontece na
 * mesma transação do armazém. Por isso ela é SÍNCRONA: uma transação de IndexedDB se encerra ao
 * aguardar algo que não seja do próprio banco (o SHA-256 nativo é assíncrono e, por isso, roda ANTES,
 * em `conferirRegistro`).
 */
import { conferirPonta, conferirRegistro, ErroDeCadeia } from './cadeia';
import type { RegistroLedger } from './tipos';

/** O que o armazém entrega DENTRO de uma transação: leituras e gravação sobre o mesmo instantâneo. */
export interface TransacaoLedger {
  /** o registro de maior `seq` da cadeia, lido nesta transação (null se a cadeia não existe) */
  ponta(cadeia: string): RegistroLedger | null;
  /** o registro `(cadeia, seq)`, lido nesta transação (null se não existe) */
  ler(cadeia: string, seq: number): RegistroLedger | null;
  /** grava (como `add`: a chave `(cadeia, seq)` repetida é recusada pelo próprio armazém) */
  adicionar(registro: RegistroLedger): void;
}

export interface ArmazemLedger {
  /**
   * Executa `corpo` numa transação de leitura e escrita. `corpo` é SÍNCRONO. Se lançar, nada do que
   * ele gravou fica (rollback); se terminar, tudo é confirmado de uma vez.
   */
  transacao<T>(corpo: (tx: TransacaoLedger) => T): Promise<T>;
}

/**
 * Confere, no momento da gravação, o registro que uma correção aponta: ele tem de existir na cadeia
 * e ter exatamente o hash declarado em `corrige`. Recusa com `ErroDeCadeia` (não é um conflito:
 * reler a ponta não conserta uma referência inválida). Para registros que não são correção, não
 * faz nada. `apontado` é o que a transação leu em `(cadeia, corrige.seq)`.
 */
export function conferirReferencia(apontado: RegistroLedger | null, novo: RegistroLedger): void {
  if (novo.cabecalho.tipo !== 'correcao') return;
  const alvo = novo.cabecalho.corrige;
  if (!alvo) throw new ErroDeCadeia('correção recusada: o cabeçalho não tem `corrige`');
  if (!apontado)
    throw new ErroDeCadeia(
      `correção recusada: o registro ${alvo.seq} que ela corrige não existe na cadeia`,
    );
  if (apontado.cabecalho.cadeia !== novo.cabecalho.cadeia || apontado.cabecalho.seq !== alvo.seq)
    throw new ErroDeCadeia(
      `correção recusada: o registro lido para o seq ${alvo.seq} não é o dessa cadeia e posição`,
    );
  if (apontado.hash !== alvo.hash)
    throw new ErroDeCadeia(
      `correção recusada: o hash em \`corrige\` não é o do registro ${alvo.seq} gravado`,
    );
}

/**
 * A parte ATÔMICA do anexo: roda DENTRO da transação, de forma síncrona, na ordem:
 *  1. a ponta lida AGORA tem de ser a que o novo registro continua (senão `ConflitoDeCadeia`:
 *     outro escritor chegou antes; reler e recriar);
 *  2. numa correção, o registro apontado é lido NESTA transação e conferido (existe, hash igual);
 *  3. grava.
 * Qualquer falha lança e a transação é desfeita pelo armazém.
 */
export function anexarNaTransacao(tx: TransacaoLedger, novo: RegistroLedger): void {
  const cadeia = novo.cabecalho.cadeia;
  conferirPonta(tx.ponta(cadeia), novo);
  if (novo.cabecalho.tipo === 'correcao') {
    const alvo = novo.cabecalho.corrige;
    if (!alvo) throw new ErroDeCadeia('correção recusada: o cabeçalho não tem `corrige`');
    conferirReferencia(tx.ler(cadeia, alvo.seq), novo);
  }
  tx.adicionar(novo);
}

/**
 * Anexa `novo` ao armazém: primeiro a conferência do registro em si (assíncrona, fora da
 * transação), depois UMA transação que confere a ponta, a referência da correção e grava.
 * `ConflitoDeCadeia` pede releitura e nova tentativa; `ErroDeCadeia` não se resolve tentando de novo.
 */
export async function anexar(armazem: ArmazemLedger, novo: RegistroLedger): Promise<void> {
  await conferirRegistro(novo);
  await armazem.transacao((tx) => anexarNaTransacao(tx, novo));
}
