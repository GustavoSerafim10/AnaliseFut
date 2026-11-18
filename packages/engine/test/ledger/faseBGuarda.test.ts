/**
 * Fase B: o que `tx.ler` devolve DENTRO da transação tem a forma conferida antes de qualquer acesso a
 * `cabecalho`. Lixo vira `ErroDeCadeia` controlado, nunca `TypeError`; a comparação canônica entre as
 * fases continua valendo; e nenhuma falha deixa a transação confirmar uma gravação.
 */
import { describe, expect, it } from 'vitest';
import {
  anexar,
  anexarNaTransacao,
  ConflitoDeCadeia,
  criarRegistro,
  ErroDeCadeia,
  verificarCadeia,
  verificarReferencias,
  type ArmazemLedger,
  type RegistroLedger,
  type TransacaoLedger,
} from '../../src/ledger';
import { cadeiaBase, clonar, refazerHash, T } from './apoioEsquema2';

const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;

/**
 * Armazém em memória: leitura fora da transação (Fase A), transação tudo-ou-nada (Fase B) e um gancho
 * que roda quando a transação abre, DEPOIS da Fase A, para mudar o que a Fase B vai ler.
 */
class Armazem implements ArmazemLedger {
  dados = new Map<string, unknown>();
  transacoesAbertas = 0;
  transacoesConfirmadas = 0;
  gravacoes = 0;
  aoAbrirTransacao?: () => void;
  constructor(registros: RegistroLedger[]) {
    for (const r of registros) this.dados.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
  }
  async ler(cadeia: string, seq: number) {
    await Promise.resolve();
    return (this.dados.get(chave(cadeia, seq)) ?? null) as RegistroLedger | null;
  }
  async transacao<R>(corpo: (tx: TransacaoLedger) => R): Promise<R> {
    await Promise.resolve();
    this.transacoesAbertas++;
    this.aoAbrirTransacao?.();
    const rascunho = new Map(this.dados);
    const tx: TransacaoLedger = {
      ponta: (cadeia) => {
        let melhor: RegistroLedger | null = null;
        for (const v of rascunho.values()) {
          const r = v as RegistroLedger;
          if (
            r?.cabecalho?.cadeia === cadeia &&
            (!melhor || r.cabecalho.seq > melhor.cabecalho.seq)
          )
            melhor = r;
        }
        return melhor;
      },
      ler: (cadeia, seq) => (rascunho.get(chave(cadeia, seq)) ?? null) as RegistroLedger | null,
      adicionar: (r) => {
        const k = chave(r.cabecalho.cadeia, r.cabecalho.seq);
        if (rascunho.has(k)) throw new Error(`ConstraintError: chave ${k} repetida`);
        rascunho.set(k, r);
        this.gravacoes++;
      },
    };
    const resultado = corpo(tx); // se lançar, o rascunho é descartado: nada é confirmado
    this.dados = rascunho;
    this.transacoesConfirmadas++;
    return resultado;
  }
  /** fotografia do conteúdo do armazém, para provar que nada mudou */
  foto(): string {
    return JSON.stringify([...this.dados.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

/** uma correção (esquema 1), gravada depois do seq 3 (a ponta), do registro de posição `seq` */
const correcaoDo = (base: RegistroLedger[], seq: number) =>
  criarRegistro(
    {
      tipo: 'correcao',
      cadeia: 'A',
      criadoEm: T(4),
      corpo: { motivo: 'placar digitado errado', novo: { casa: 2, fora: 1 } },
      corrige: { seq, hash: base[seq - 1].hash },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    base[2],
  );

/** cenário pronto: cadeia base, a correção do seq 3 e as referências que a Fase A verificou */
async function cenario() {
  const base = await cadeiaBase();
  const novo = await correcaoDo(base, 3);
  const verificadas = await verificarReferencias(new Armazem(base), novo);
  return { base, novo, verificadas };
}

/** transação controlada: a ponta é o seq 3; `tx.ler` devolve `lido`; `adicionar` é contado */
function transacaoQueLe(base: RegistroLedger[], lido: unknown) {
  const chamadas = { ler: 0, adicionar: 0 };
  const tx: TransacaoLedger = {
    ponta: () => base[2],
    ler: () => (chamadas.ler++, lido as RegistroLedger | null),
    adicionar: () => void chamadas.adicionar++,
  };
  return { tx, chamadas };
}

/** captura o erro de uma chamada síncrona */
const erroDe = (f: () => void): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  return undefined;
};

describe('Fase B (anexarNaTransacao): tx.ler devolve null', () => {
  it('recusa com ErroDeCadeia de inexistência, sem TypeError e sem gravar', async () => {
    const { base, novo, verificadas } = await cenario();
    const { tx, chamadas } = transacaoQueLe(base, null);
    const erro = erroDe(() => anexarNaTransacao(tx, novo, verificadas));
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(TypeError);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/não existe na cadeia/);
    expect(chamadas).toEqual({ ler: 1, adicionar: 0 });
  });
});

describe('Fase B (anexarNaTransacao): tx.ler devolve objeto malformado ou inesperado', () => {
  const lixos: [string, (r: RegistroLedger) => unknown][] = [
    ['objeto vazio', () => ({})],
    ['sem cabeçalho', (r) => ({ corpo: r.corpo, hash: r.hash })],
    ['cabeçalho null', (r) => ({ cabecalho: null, corpo: r.corpo, hash: r.hash })],
    ['cabeçalho que é texto', (r) => ({ cabecalho: 'x', corpo: r.corpo, hash: r.hash })],
    ['sem corpo', (r) => ({ cabecalho: r.cabecalho, hash: r.hash })],
    ['corpo que é lista', (r) => ({ cabecalho: r.cabecalho, corpo: [], hash: r.hash })],
    ['hash fora do formato', (r) => ({ ...r, hash: 'xyz' })],
    ['sem hash', (r) => ({ cabecalho: r.cabecalho, corpo: r.corpo })],
    ['esquema que não é inteiro', (r) => ({ ...r, cabecalho: { ...r.cabecalho, esquema: '1' } })],
    ['tipo fora do esquema', (r) => ({ ...r, cabecalho: { ...r.cabecalho, tipo: 'xyz' } })],
    ['seq inválido', (r) => ({ ...r, cabecalho: { ...r.cabecalho, seq: 0 } })],
    ['cadeia ausente', (r) => ({ ...r, cabecalho: { ...r.cabecalho, cadeia: '' } })],
    ['texto', () => 'registro'],
    ['número', () => 42],
    ['booleano', () => true],
    ['lista', () => []],
  ];
  for (const [nome, montar] of lixos)
    it(`${nome}: ErroDeCadeia controlado, sem TypeError e sem gravar`, async () => {
      const { base, novo, verificadas } = await cenario();
      const { tx, chamadas } = transacaoQueLe(base, montar(clonar(base[2])));
      const erro = erroDe(() => anexarNaTransacao(tx, novo, verificadas));
      expect(erro).toBeInstanceOf(ErroDeCadeia);
      expect(erro).not.toBeInstanceOf(TypeError);
      expect((erro as Error).message).toMatch(/inválido \(registro malformado/);
      expect(chamadas.adicionar).toBe(0);
    });
});

describe('Fase B (anexarNaTransacao): registro VÁLIDO cujo conteúdo diverge do verificado na Fase A', () => {
  it('conteúdo diferente com o MESMO campo hash: ConflitoDeCadeia pela comparação canônica', async () => {
    const { base, novo, verificadas } = await cenario();
    const trocado = clonar(base[2]);
    (trocado.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 7; // corpo ainda válido
    const { tx, chamadas } = transacaoQueLe(base, trocado);
    const erro = erroDe(() => anexarNaTransacao(tx, novo, verificadas));
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/mudou entre a verificação e a gravação/);
    expect(chamadas.adicionar).toBe(0);
  });

  it('outro registro válido, com hash próprio (refeito): ErroDeCadeia de hash divergente', async () => {
    const { base, novo, verificadas } = await cenario();
    const outro = await refazerHash(base[2], (c) => {
      (c.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 7;
    });
    const { tx, chamadas } = transacaoQueLe(base, outro);
    const erro = erroDe(() => anexarNaTransacao(tx, novo, verificadas));
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/hash em `corrige` não é o do registro 3/);
    expect(chamadas.adicionar).toBe(0);
  });

  it('a comparação é pelo CONTEÚDO: uma cópia idêntica (outro objeto) é aceita e gravada', async () => {
    const { base, novo, verificadas } = await cenario();
    const { tx, chamadas } = transacaoQueLe(base, clonar(base[2]));
    expect(() => anexarNaTransacao(tx, novo, verificadas)).not.toThrow();
    expect(chamadas).toEqual({ ler: 1, adicionar: 1 });
  });
});

describe('anexar: o armazém muda entre as fases e a transação NÃO confirma nada', () => {
  /**
   * Roda `anexar` de uma correção do seq 2 (a aposta; a ponta continua sendo o seq 3, então a Fase B
   * passa pela ponta e chega a `tx.ler`) com `mudar` aplicado ao abrir a transação.
   */
  async function entreAsFases(
    mudar: (dados: Map<string, unknown>, base: RegistroLedger[]) => void,
  ) {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    const novo = await correcaoDo(base, 2);
    let fotoAoAbrir = '';
    armazem.aoAbrirTransacao = () => {
      mudar(armazem.dados, base);
      fotoAoAbrir = armazem.foto();
    };
    const erro = await anexar(armazem, novo).catch((e: unknown) => e);
    return { armazem, erro, fotoAoAbrir };
  }

  /** a transação abriu, falhou e não confirmou: nenhuma gravação, armazém igual ao da abertura */
  function nadaConfirmado(r: Awaited<ReturnType<typeof entreAsFases>>) {
    expect(r.armazem.transacoesAbertas).toBe(1);
    expect(r.armazem.transacoesConfirmadas).toBe(0);
    expect(r.armazem.foto()).toBe(r.fotoAoAbrir);
    expect(r.armazem.dados.has(chave('A', 4))).toBe(false);
  }

  it('o apontado sumiu (tx.ler devolve null): ErroDeCadeia de inexistência', async () => {
    const r = await entreAsFases((dados) => dados.delete(chave('A', 2)));
    expect(r.erro).toBeInstanceOf(ErroDeCadeia);
    expect(r.erro).not.toBeInstanceOf(TypeError);
    expect(r.erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((r.erro as Error).message).toMatch(/não existe na cadeia/);
    nadaConfirmado(r);
  });

  it('o apontado virou lixo (sem cabeçalho): ErroDeCadeia, sem TypeError', async () => {
    const r = await entreAsFases((dados) => dados.set(chave('A', 2), { corpo: {} }));
    expect(r.erro).toBeInstanceOf(ErroDeCadeia);
    expect(r.erro).not.toBeInstanceOf(TypeError);
    expect((r.erro as Error).message).toMatch(/registro malformado/);
    nadaConfirmado(r);
  });

  it('o apontado virou um valor que nem é objeto: ErroDeCadeia, sem TypeError', async () => {
    const r = await entreAsFases((dados) => dados.set(chave('A', 2), 'lixo'));
    expect(r.erro).toBeInstanceOf(ErroDeCadeia);
    expect(r.erro).not.toBeInstanceOf(TypeError);
    expect((r.erro as Error).message).toMatch(/registro malformado/);
    nadaConfirmado(r);
  });

  it('o conteúdo do apontado mudou (mesmo campo hash): ConflitoDeCadeia', async () => {
    const r = await entreAsFases((dados, base) => {
      const trocado = clonar(base[1]);
      (trocado.corpo as unknown as { aposta: { odd: number } }).aposta.odd = 3; // corpo ainda válido
      dados.set(chave('A', 2), trocado);
    });
    expect(r.erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((r.erro as Error).message).toMatch(/mudou entre a verificação e a gravação/);
    nadaConfirmado(r);
  });

  it('sem mudança entre as fases: grava, confirma uma vez e a cadeia fica íntegra', async () => {
    const r = await entreAsFases(() => undefined);
    expect(r.erro).toBeUndefined();
    expect(r.armazem.transacoesConfirmadas).toBe(1);
    expect(r.armazem.gravacoes).toBe(1);
    const lista = [1, 2, 3, 4].map((s) => r.armazem.dados.get(chave('A', s)) as RegistroLedger);
    expect((await verificarCadeia(lista)).estado).toBe('integra');
  });
});
