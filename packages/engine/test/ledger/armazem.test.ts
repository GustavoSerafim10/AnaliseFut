/**
 * Gravação atômica: a referência `corrige` é conferida NA MESMA transação que grava o registro novo.
 * O armazém em memória abaixo modela o que importa de uma transação de IndexedDB: leituras e escrita
 * sobre o mesmo instantâneo, corpo síncrono, tudo-ou-nada, chave `(cadeia, seq)` com `add` que recusa
 * repetição, e a transação só abre depois de um intervalo (as "abas" se intercalam).
 * Não há IndexedDB aqui: isso é o adaptador da L2, que não foi implementado.
 */
import { describe, expect, it } from 'vitest';
import {
  anexar,
  anexarNaTransacao,
  conferirReferencia,
  ConflitoDeCadeia,
  criarRegistro,
  ErroDeCadeia,
  hashDoRegistro,
  verificarCadeia,
  type ArmazemLedger,
  type CorpoLedger,
  type RegistroLedger,
  type TipoRegistro,
  type TransacaoLedger,
} from '../../src/ledger';

const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
const clonar = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;

class ArmazemEmMemoria implements ArmazemLedger {
  dados = new Map<string, RegistroLedger>();
  transacoesAbertas = 0;
  transacoesConfirmadas = 0;

  async transacao<T>(corpo: (tx: TransacaoLedger) => T): Promise<T> {
    // a transação só abre depois de alguns turnos: os outros escritores avançam nesse intervalo
    await Promise.resolve();
    await Promise.resolve();
    this.transacoesAbertas++;
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

  /** leitura FORA de transação, como uma aba que lê a ponta antes de montar o registro */
  ponta(cadeia: string): RegistroLedger | null {
    let melhor: RegistroLedger | null = null;
    for (const r of this.dados.values())
      if (r.cabecalho.cadeia === cadeia && (!melhor || r.cabecalho.seq > melhor.cabecalho.seq))
        melhor = r;
    return melhor;
  }

  lista(cadeia: string): RegistroLedger[] {
    return [...this.dados.values()]
      .filter((r) => r.cabecalho.cadeia === cadeia)
      .sort((a, b) => a.cabecalho.seq - b.cabecalho.seq);
  }
}

const CORPOS: Record<'resultado' | 'exclusao' | 'correcao', CorpoLedger> = {
  resultado: { decisao: null, resultado: { casa: 1, fora: 0, registradoEm: T(1) } },
  exclusao: { motivo: null },
  correcao: { motivo: 'placar digitado errado', novo: { casa: 2, fora: 1 } },
};

async function novoRegistro(
  tipo: keyof typeof CORPOS,
  n: number,
  ultimo: RegistroLedger | null,
  corrige?: { seq: number; hash: string },
  cadeia = 'A',
): Promise<RegistroLedger> {
  return criarRegistro(
    {
      tipo: tipo as TipoRegistro,
      cadeia,
      criadoEm: T(n),
      corpo: CORPOS[tipo],
      versaoMotor: 'teste',
      politicas: { x: 1 },
      ...(corrige ? { corrige } : {}),
    },
    ultimo,
  );
}

/** Semeia o armazém com `n` resultados, direto (como se já estivessem gravados). */
async function semear(armazem: ArmazemEmMemoria, n: number, cadeia = 'A') {
  let ultimo: RegistroLedger | null = null;
  const lista: RegistroLedger[] = [];
  for (let i = 1; i <= n; i++) {
    const r = await novoRegistro('resultado', i, ultimo, undefined, cadeia);
    armazem.dados.set(chave(cadeia, i), r);
    lista.push(r);
    ultimo = r;
  }
  return lista;
}

describe('anexar: registro comum (sem correção)', () => {
  it('grava a gênese e os seguintes, em uma transação cada', async () => {
    const armazem = new ArmazemEmMemoria();
    let ultimo: RegistroLedger | null = null;
    for (let i = 1; i <= 3; i++) {
      const r = await novoRegistro('resultado', i, ultimo);
      await expect(anexar(armazem, r)).resolves.toBeUndefined();
      ultimo = r;
    }
    expect(armazem.lista('A').map((r) => r.cabecalho.seq)).toEqual([1, 2, 3]);
    expect(armazem.transacoesAbertas).toBe(3);
    expect((await verificarCadeia(armazem.lista('A'))).estado).toBe('integra');
  });

  it('registro inválido NÃO abre transação (conferirRegistro roda antes)', async () => {
    const armazem = new ArmazemEmMemoria();
    const r = await novoRegistro('resultado', 1, null);
    const errado = { ...clonar(r), hash: 'f'.repeat(64) };
    const erro = await anexar(armazem, errado).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.transacoesAbertas).toBe(0);
    expect(armazem.dados.size).toBe(0);
  });

  it('ponta velha: ConflitoDeCadeia e nada é gravado', async () => {
    const armazem = new ArmazemEmMemoria();
    const [a] = await semear(armazem, 1);
    const daAba1 = await novoRegistro('resultado', 2, a);
    const daAba2 = await novoRegistro('resultado', 3, a);
    await anexar(armazem, daAba1);
    await expect(anexar(armazem, daAba2)).rejects.toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.lista('A')).toHaveLength(2);
  });
});

describe('anexar: a referência `corrige` é conferida na gravação', () => {
  it('correção com a referência certa é gravada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 2, hash: lista[1].hash });
    await expect(anexar(armazem, c)).resolves.toBeUndefined();
    expect(armazem.lista('A')).toHaveLength(4);
    expect((await verificarCadeia(armazem.lista('A'))).estado).toBe('integra');
  });

  it('referência com hash divergente (de outro registro): recusada, nada gravado', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 2, hash: lista[0].hash });
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/hash/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('referência com hash inventado: recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 2, hash: 'f'.repeat(64) });
    await expect(anexar(armazem, c)).rejects.toThrow(/hash/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('referência a registro que NÃO existe no armazém: recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    // o armazém perdeu o seq 2 (cópia parcial/corrompida): a ponta (3) ainda é a certa
    armazem.dados.delete(chave('A', 2));
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 2, hash: lista[1].hash });
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/não existe/);
    expect(armazem.dados.has(chave('A', 4))).toBe(false);
  });

  it('referência a um registro de OUTRA cadeia com o mesmo seq não vale', async () => {
    const armazem = new ArmazemEmMemoria();
    const a = await semear(armazem, 3, 'A');
    const b = await semear(armazem, 3, 'B');
    // hash do registro 2 da cadeia B, apontado por uma correção da cadeia A
    const c = await novoRegistro('correcao', 4, a[2], { seq: 2, hash: b[1].hash });
    await expect(anexar(armazem, c)).rejects.toThrow(/hash/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('seq da referência igual ou superior ao do registro nunca chega à transação', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 3, hash: lista[2].hash });
    const ruim = clonar(c);
    ruim.cabecalho.corrige = { seq: 4, hash: lista[2].hash }; // aponta para si mesmo
    ruim.hash = await hashDoRegistro(ruim.cabecalho, ruim.corpo);
    await expect(anexar(armazem, ruim)).rejects.toThrow(/estritamente menor/);
    expect(armazem.transacoesAbertas).toBe(0);
  });

  it('campo adicional em `corrige` nunca chega à transação', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 3, hash: lista[2].hash });
    const ruim = clonar(c);
    (ruim.cabecalho.corrige as unknown as Record<string, unknown>).extra = 1;
    ruim.hash = await hashDoRegistro(ruim.cabecalho, ruim.corpo);
    await expect(anexar(armazem, ruim)).rejects.toThrow(/corrige/);
    expect(armazem.transacoesAbertas).toBe(0);
  });

  it('a leitura da referência e a gravação acontecem na MESMA transação, nesta ordem', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 3, hash: lista[2].hash });
    const chamadas: string[] = [];
    const donos = new Set<TransacaoLedger>();
    await armazem.transacao((tx) => {
      const espiao: TransacaoLedger = {
        ponta: (cadeia) => (chamadas.push('ponta'), tx.ponta(cadeia)),
        ler: (cadeia, seq) => (chamadas.push(`ler:${seq}`), tx.ler(cadeia, seq)),
        adicionar: (r) => (chamadas.push('adicionar'), tx.adicionar(r)),
      };
      donos.add(espiao);
      anexarNaTransacao(espiao, c);
    });
    expect(chamadas).toEqual(['ponta', 'ler:3', 'adicionar']);
    expect(donos.size).toBe(1);
    expect(armazem.transacoesConfirmadas).toBe(1);
  });

  it('a conferência da referência é SÍNCRONA (cabe numa transação de IndexedDB)', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 3, hash: lista[2].hash });
    await armazem.transacao((tx) => {
      const retorno: unknown = anexarNaTransacao(tx, c);
      expect(retorno).toBeUndefined(); // nada de Promise
    });
    expect(() => conferirReferencia(lista[2], c)).not.toThrow();
    expect(() => conferirReferencia(null, c)).toThrow(/não existe/);
    expect(() => conferirReferencia(lista[0], c)).toThrow();
  });

  it('só correções são conferidas: registro comum ignora a referência', async () => {
    const lista = await semear(new ArmazemEmMemoria(), 2);
    expect(() => conferirReferencia(null, lista[1])).not.toThrow();
    expect(() => conferirReferencia(lista[0], lista[1])).not.toThrow();
  });
});

describe('atomicidade e concorrência', () => {
  it('se a conferência falha depois de ler, o armazém fica exatamente como estava (rollback)', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const antes = [...armazem.dados.keys()].join('|');
    const c = await novoRegistro('correcao', 4, lista[2], { seq: 2, hash: 'f'.repeat(64) });
    await expect(anexar(armazem, c)).rejects.toThrow();
    expect([...armazem.dados.keys()].join('|')).toBe(antes);
    expect(armazem.transacoesConfirmadas).toBe(0);
  });

  it('a chave (cadeia, seq) com add recusa a repetição: segunda defesa', async () => {
    const armazem = new ArmazemEmMemoria();
    const [a] = await semear(armazem, 1);
    await expect(armazem.transacao((tx) => tx.adicionar(a))).rejects.toThrow(/ConstraintError/);
  });

  it('60 escritores concorrentes (resultados, exclusões e correções): cadeia íntegra e sem lacuna', async () => {
    const armazem = new ArmazemEmMemoria();
    await semear(armazem, 4);
    let recusasDeConflito = 0;

    const escritor = async (n: number): Promise<void> => {
      for (let tentativa = 0; tentativa < 2000; tentativa++) {
        const ponta = armazem.ponta('A');
        // a aba lê a ponta e o registro que quer corrigir FORA da transação (pode ficar velho)
        const alvo = armazem.lista('A')[(n * 7) % armazem.lista('A').length];
        const tipo: keyof typeof CORPOS =
          n % 3 === 0 ? 'correcao' : n % 3 === 1 ? 'resultado' : 'exclusao';
        const registro = await novoRegistro(
          tipo,
          n,
          ponta,
          tipo === 'correcao' ? { seq: alvo.cabecalho.seq, hash: alvo.hash } : undefined,
        );
        try {
          await anexar(armazem, registro);
          return;
        } catch (e) {
          if (!(e instanceof ConflitoDeCadeia)) throw e;
          recusasDeConflito++;
        }
      }
      throw new Error('escritor esgotou as tentativas');
    };

    await Promise.all(Array.from({ length: 60 }, (_, i) => escritor(i + 1)));

    const final = armazem.lista('A');
    expect(final).toHaveLength(64);
    expect(final.map((r) => r.cabecalho.seq)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
    const rel = await verificarCadeia(final);
    expect(rel.problemas).toEqual([]);
    expect(rel.estado).toBe('integra');
    // houve disputa de verdade: sem ela, o teste não provaria nada
    expect(recusasDeConflito).toBeGreaterThan(0);
    // 20 das 60 são correções, todas apontando para registros que existem com o hash certo
    expect(final.filter((r) => r.cabecalho.tipo === 'correcao')).toHaveLength(20);
  });

  it('correções inválidas no meio da disputa nunca são gravadas e não travam as demais', async () => {
    const armazem = new ArmazemEmMemoria();
    const base = await semear(armazem, 3);
    const recusadas: unknown[] = [];

    const bom = async (n: number) => {
      for (let t = 0; t < 2000; t++) {
        const r = await novoRegistro('resultado', n, armazem.ponta('A'));
        try {
          await anexar(armazem, r);
          return;
        } catch (e) {
          if (!(e instanceof ConflitoDeCadeia)) throw e;
        }
      }
    };
    const mau = async (n: number) => {
      for (let t = 0; t < 2000; t++) {
        const ponta = armazem.ponta('A');
        const r = await novoRegistro('correcao', n, ponta, { seq: 2, hash: base[0].hash });
        try {
          await anexar(armazem, r);
          return;
        } catch (e) {
          if (e instanceof ConflitoDeCadeia) continue;
          recusadas.push(e);
          return;
        }
      }
    };

    await Promise.all([
      ...Array.from({ length: 25 }, (_, i) => bom(i + 1)),
      ...Array.from({ length: 15 }, (_, i) => mau(i + 30)),
    ]);

    expect(recusadas).toHaveLength(15);
    for (const e of recusadas) expect((e as Error).message).toMatch(/hash/);
    const final = armazem.lista('A');
    expect(final).toHaveLength(3 + 25);
    expect(final.some((r) => r.cabecalho.tipo === 'correcao')).toBe(false);
    expect((await verificarCadeia(final)).estado).toBe('integra');
  });

  it('duas correções do mesmo registro ao mesmo tempo: as duas entram, em sequência', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const feita = async (n: number) => {
      for (let t = 0; t < 1000; t++) {
        const c = await novoRegistro('correcao', n, armazem.ponta('A'), {
          seq: 1,
          hash: lista[0].hash,
        });
        try {
          await anexar(armazem, c);
          return;
        } catch (e) {
          if (!(e instanceof ConflitoDeCadeia)) throw e;
        }
      }
    };
    await Promise.all([feita(10), feita(11)]);
    const final = armazem.lista('A');
    expect(final.map((r) => r.cabecalho.tipo)).toEqual([
      'resultado',
      'resultado',
      'resultado',
      'correcao',
      'correcao',
    ]);
    expect((await verificarCadeia(final)).estado).toBe('integra');
  });
});
