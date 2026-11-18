/**
 * Apoio dos testes: gravar pela ÚNICA porta de escrita (`anexar`) sobre um armazém em memória que já
 * contém os registros dados. Substitui o antigo `aceitarAnexo(ponta, novo)`, que só conferia o
 * registro e a identidade da ponta: `gravarSobre(anteriores, novo)` confere tudo o que `anexar`
 * confere (o registro novo, as referências, o registro anterior e a ponta, atomicamente).
 */
import {
  anexar,
  type ArmazemLedger,
  type RegistroLedger,
  type TransacaoLedger,
} from '../../src/ledger';

const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;

/** Armazém em memória: leitura fora da transação, transação síncrona e tudo-ou-nada. */
export class ArmazemDeTeste implements ArmazemLedger {
  dados = new Map<string, RegistroLedger>();
  leituras = 0;
  transacoesAbertas = 0;
  transacoesConfirmadas = 0;
  /** roda ao abrir a transação: DEPOIS da Fase A, antes da Fase B */
  aoAbrirTransacao?: () => void;
  constructor(registros: readonly RegistroLedger[] = []) {
    for (const r of registros) this.dados.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
  }
  async ler(cadeia: string, seq: number): Promise<RegistroLedger | null> {
    await Promise.resolve();
    this.leituras++;
    return this.dados.get(chave(cadeia, seq)) ?? null;
  }
  async transacao<R>(corpo: (tx: TransacaoLedger) => R): Promise<R> {
    await Promise.resolve();
    this.transacoesAbertas++;
    this.aoAbrirTransacao?.();
    const rascunho = new Map(this.dados);
    const tx: TransacaoLedger = {
      ponta: (cadeia) => {
        let melhor: RegistroLedger | null = null;
        for (const r of rascunho.values())
          if (r.cabecalho.cadeia === cadeia && (!melhor || r.cabecalho.seq > melhor.cabecalho.seq))
            melhor = r;
        return melhor;
      },
      ler: (cadeia, seq) => rascunho.get(chave(cadeia, seq)) ?? null,
      adicionar: (r) => {
        const k = chave(r.cabecalho.cadeia, r.cabecalho.seq);
        if (rascunho.has(k)) throw new Error(`ConstraintError: chave ${k} repetida`);
        rascunho.set(k, r);
      },
    };
    const resultado = corpo(tx); // se lançar, o rascunho é descartado (rollback)
    this.dados = rascunho;
    this.transacoesConfirmadas++;
    return resultado;
  }
  /** fotografia do conteúdo, para provar que nada mudou */
  foto(): string {
    return JSON.stringify([...this.dados.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
  /** os registros de uma cadeia, em ordem de seq */
  lista(cadeia = 'A'): RegistroLedger[] {
    return [...this.dados.values()]
      .filter((r) => r.cabecalho.cadeia === cadeia)
      .sort((a, b) => a.cabecalho.seq - b.cabecalho.seq);
  }
}

/**
 * Grava `novo` por `anexar` num armazém que já tem `anteriores` (a cadeia até a ponta; vazio para
 * a gênese). Resolve se gravou; rejeita com o mesmo `ErroDeCadeia` / `ConflitoDeCadeia` de `anexar`.
 */
export async function gravarSobre(
  anteriores: readonly RegistroLedger[],
  novo: RegistroLedger,
): Promise<void> {
  await anexar(new ArmazemDeTeste(anteriores), novo);
}
