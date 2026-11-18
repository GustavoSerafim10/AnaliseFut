/**
 * Fase B: o que `tx.ponta` devolve tem a forma conferida ANTES de `conferirPonta`.
 *  - `null` é a cadeia vazia: legítimo, a gênese continua sendo gravada;
 *  - `undefined`, objeto malformado ou valor que nem é objeto: `ErroDeCadeia`, nunca `TypeError`, e
 *    nunca confundido com cadeia vazia;
 *  - uma ponta válida que não é a que o registro continua segue sendo `ConflitoDeCadeia` (inalterado);
 *  - em `anexar`, uma ponta inválida faz a transação falhar sem confirmar nada.
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
import { cadeiaBase, clonar, T } from './apoioEsquema2';

const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;
const SEM_SUBSTITUTO = Symbol('ponta real');

/**
 * Armazém em memória com uma ponta substituível: `pontaDevolvida` (se definida) é o que `tx.ponta`
 * entrega, no lugar da ponta real. Conta transações abertas, confirmadas e gravações.
 */
class Armazem implements ArmazemLedger {
  dados = new Map<string, RegistroLedger>();
  transacoesAbertas = 0;
  transacoesConfirmadas = 0;
  gravacoes = 0;
  pontaDevolvida: unknown = SEM_SUBSTITUTO;
  constructor(registros: RegistroLedger[] = []) {
    for (const r of registros) this.dados.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
  }
  async ler(cadeia: string, seq: number) {
    await Promise.resolve();
    return this.dados.get(chave(cadeia, seq)) ?? null;
  }
  async transacao<R>(corpo: (tx: TransacaoLedger) => R): Promise<R> {
    await Promise.resolve();
    this.transacoesAbertas++;
    const rascunho = new Map(this.dados);
    const pontaReal = (cadeia: string) => {
      let melhor: RegistroLedger | null = null;
      for (const r of rascunho.values())
        if (r.cabecalho.cadeia === cadeia && (!melhor || r.cabecalho.seq > melhor.cabecalho.seq))
          melhor = r;
      return melhor;
    };
    const tx: TransacaoLedger = {
      ponta: (cadeia) =>
        this.pontaDevolvida === SEM_SUBSTITUTO
          ? pontaReal(cadeia)
          : (this.pontaDevolvida as RegistroLedger | null),
      ler: (cadeia, seq) => rascunho.get(chave(cadeia, seq)) ?? null,
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
  foto(): string {
    return JSON.stringify([...this.dados.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

/** a gênese de uma cadeia nova (seq 1, prevHash null), sem referências */
const genese = (cadeia = 'Z') =>
  criarRegistro(
    {
      tipo: 'resultado',
      cadeia,
      criadoEm: T(1),
      corpo: { decisao: null, resultado: { casa: 1, fora: 0, registradoEm: T(1) } },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    null,
  );

/** uma correção do seq 3 da cadeia base, logo depois dele (tem referência: Fase B chamaria tx.ler) */
const correcaoDoSeq3 = (base: RegistroLedger[]) =>
  criarRegistro(
    {
      tipo: 'correcao',
      cadeia: 'A',
      criadoEm: T(4),
      corpo: { motivo: 'placar digitado errado', novo: { casa: 2, fora: 1 } },
      corrige: { seq: 3, hash: base[2].hash },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    base[2],
  );

/** transação controlada: `tx.ponta` devolve `ponta`; `tx.ler` devolve o registro real da base */
function transacaoComPonta(base: RegistroLedger[], ponta: unknown) {
  const chamadas = { ponta: 0, ler: 0, adicionar: 0 };
  const tx: TransacaoLedger = {
    ponta: () => (chamadas.ponta++, ponta as RegistroLedger | null),
    ler: (_c, seq) => (chamadas.ler++, base[seq - 1] ?? null),
    adicionar: () => void chamadas.adicionar++,
  };
  return { tx, chamadas };
}

const erroDe = (f: () => void): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  return undefined;
};

/** valores que NÃO são uma ponta válida (nem registro, nem null) */
const PONTAS_INVALIDAS: [string, (r: RegistroLedger) => unknown][] = [
  ['undefined', () => undefined],
  ['objeto vazio', () => ({})],
  ['sem cabeçalho', (r) => ({ corpo: r.corpo, hash: r.hash })],
  ['cabeçalho null', (r) => ({ cabecalho: null, corpo: r.corpo, hash: r.hash })],
  ['cabeçalho que é texto', (r) => ({ cabecalho: 'x', corpo: r.corpo, hash: r.hash })],
  ['sem corpo', (r) => ({ cabecalho: r.cabecalho, hash: r.hash })],
  ['hash fora do formato', (r) => ({ ...r, hash: 'xyz' })],
  ['seq inválido', (r) => ({ ...r, cabecalho: { ...r.cabecalho, seq: 0 } })],
  ['seq que é texto', (r) => ({ ...r, cabecalho: { ...r.cabecalho, seq: '3' } })],
  ['cadeia ausente', (r) => ({ ...r, cabecalho: { ...r.cabecalho, cadeia: '' } })],
  ['esquema que não é inteiro', (r) => ({ ...r, cabecalho: { ...r.cabecalho, esquema: '1' } })],
  ['tipo fora do esquema', (r) => ({ ...r, cabecalho: { ...r.cabecalho, tipo: 'xyz' } })],
  ['prevHash fora do formato', (r) => ({ ...r, cabecalho: { ...r.cabecalho, prevHash: 'x' } })],
  ['texto', () => 'ponta'],
  ['número', () => 3],
  ['zero', () => 0],
  ['booleano false', () => false],
  ['lista', () => []],
];

describe('ponta inexistente LEGÍTIMA (null): cadeia vazia', () => {
  it('a gênese é gravada quando tx.ponta devolve null', async () => {
    const g = await genese();
    const verificadas = await verificarReferencias(new Armazem(), g);
    const { tx, chamadas } = transacaoComPonta([], null);
    expect(() => anexarNaTransacao(tx, g, verificadas)).not.toThrow();
    expect(chamadas.adicionar).toBe(1);
  });

  it('via anexar, num armazém vazio: grava, confirma e a cadeia fica íntegra', async () => {
    const armazem = new Armazem();
    const g = await genese();
    await anexar(armazem, g);
    expect(armazem.transacoesConfirmadas).toBe(1);
    expect(armazem.gravacoes).toBe(1);
    expect((await verificarCadeia([...armazem.dados.values()])).estado).toBe('integra');
  });

  it('null para um registro que NÃO é gênese continua sendo ConflitoDeCadeia (inalterado)', async () => {
    const base = await cadeiaBase();
    const c = await correcaoDoSeq3(base);
    const verificadas = await verificarReferencias(new Armazem(base), c);
    const { tx, chamadas } = transacaoComPonta(base, null);
    const erro = erroDe(() => anexarNaTransacao(tx, c, verificadas));
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/esperado seq 1, recebido 4/);
    expect(chamadas.adicionar).toBe(0);
  });
});

describe('ponta VÁLIDA: comportamento de conferirPonta inalterado', () => {
  it('a ponta certa: grava', async () => {
    const base = await cadeiaBase();
    const c = await correcaoDoSeq3(base);
    const verificadas = await verificarReferencias(new Armazem(base), c);
    const { tx, chamadas } = transacaoComPonta(base, clonar(base[2]));
    expect(() => anexarNaTransacao(tx, c, verificadas)).not.toThrow();
    expect(chamadas.adicionar).toBe(1);
  });

  it('uma ponta válida mais nova (outro escritor chegou antes): ConflitoDeCadeia', async () => {
    const base = await cadeiaBase();
    const c = await correcaoDoSeq3(base);
    const verificadas = await verificarReferencias(new Armazem(base), c);
    const maisNova = await correcaoDoSeq3(base); // um seq 4 já gravado
    const { tx } = transacaoComPonta(base, maisNova);
    expect(erroDe(() => anexarNaTransacao(tx, c, verificadas))).toBeInstanceOf(ConflitoDeCadeia);
  });

  it('uma ponta válida de OUTRA cadeia: ConflitoDeCadeia', async () => {
    const base = await cadeiaBase();
    const c = await correcaoDoSeq3(base);
    const verificadas = await verificarReferencias(new Armazem(base), c);
    const outra = (await cadeiaBase('B'))[2];
    const { tx } = transacaoComPonta(base, outra);
    const erro = erroDe(() => anexarNaTransacao(tx, c, verificadas));
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/outra cadeia/);
  });
});

describe('ponta INVÁLIDA (anexarNaTransacao): ErroDeCadeia, sem TypeError, antes de qualquer leitura', () => {
  for (const [nome, montar] of PONTAS_INVALIDAS)
    it(nome, async () => {
      const base = await cadeiaBase();
      const c = await correcaoDoSeq3(base);
      const verificadas = await verificarReferencias(new Armazem(base), c);
      const { tx, chamadas } = transacaoComPonta(base, montar(clonar(base[2])));
      const erro = erroDe(() => anexarNaTransacao(tx, c, verificadas));
      expect(erro).toBeInstanceOf(ErroDeCadeia);
      expect(erro).not.toBeInstanceOf(TypeError);
      expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
      expect((erro as Error).message).toMatch(/a ponta lida na transação é inválida/);
      // recusada na ponta: as referências nem são relidas e nada é gravado
      expect(chamadas).toEqual({ ponta: 1, ler: 0, adicionar: 0 });
    });
});

describe('ponta inválida NÃO é confundida com cadeia vazia (gênese)', () => {
  for (const [nome, montar] of PONTAS_INVALIDAS)
    it(`gênese com ponta ${nome}: recusada, não gravada como se a cadeia estivesse vazia`, async () => {
      const g = await genese();
      const verificadas = await verificarReferencias(new Armazem(), g);
      const { tx, chamadas } = transacaoComPonta([], montar(g));
      const erro = erroDe(() => anexarNaTransacao(tx, g, verificadas));
      expect(erro).toBeInstanceOf(ErroDeCadeia);
      expect(erro).not.toBeInstanceOf(TypeError);
      expect((erro as Error).message).toMatch(/a ponta lida na transação é inválida/);
      expect(chamadas.adicionar).toBe(0);
    });
});

describe('anexar: ponta inválida durante a transação, ROLLBACK (nada confirmado)', () => {
  for (const [nome, montar] of [
    ['undefined', () => undefined],
    ['objeto sem cabeçalho', () => ({ corpo: {} })],
    ['texto', () => 'ponta'],
  ] as [string, () => unknown][])
    it(`${nome}: ErroDeCadeia, a transação não confirma e o armazém fica igual`, async () => {
      const base = await cadeiaBase();
      const armazem = new Armazem(base);
      const antes = armazem.foto();
      armazem.pontaDevolvida = montar();
      const erro = await anexar(armazem, await correcaoDoSeq3(base)).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroDeCadeia);
      expect(erro).not.toBeInstanceOf(TypeError);
      expect(armazem.transacoesAbertas).toBe(1);
      expect(armazem.transacoesConfirmadas).toBe(0);
      expect(armazem.gravacoes).toBe(0);
      expect(armazem.foto()).toBe(antes);
    });

  it('gênese num armazém vazio com ponta undefined: recusada, armazém continua vazio', async () => {
    const armazem = new Armazem();
    armazem.pontaDevolvida = undefined;
    const erro = await anexar(armazem, await genese()).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(armazem.transacoesConfirmadas).toBe(0);
    expect(armazem.dados.size).toBe(0);
  });

  it('a mesma correção, com a ponta real: grava e confirma (o cenário em si é válido)', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    await anexar(armazem, await correcaoDoSeq3(base));
    expect(armazem.transacoesConfirmadas).toBe(1);
    expect(armazem.gravacoes).toBe(1);
  });
});
