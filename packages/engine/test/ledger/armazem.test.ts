/**
 * Gravação atômica em duas fases. As referências de um registro (`corrige` e `decisao`) são
 * verificadas com o hash RECALCULADO fora da transação (Fase A) e reconfirmadas, pela representação
 * canônica, DENTRO da transação que grava (Fase B).
 *
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
  verificarReferencias,
  type ArmazemLedger,
  type CorpoLedger,
  type RegistroLedger,
  type TipoRegistro,
  type TransacaoLedger,
} from '../../src/ledger';

const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
const clonar = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;
const HASH = 'a'.repeat(64);

class ArmazemEmMemoria implements ArmazemLedger {
  dados = new Map<string, RegistroLedger>();
  transacoesAbertas = 0;
  transacoesConfirmadas = 0;
  leituras = 0;
  /** gancho: roda quando a transação abre, DEPOIS da Fase A e antes de a Fase B ler */
  aoAbrirTransacao?: () => void;

  /** leitura fora da transação de escrita (Fase A) */
  async ler(cadeia: string, seq: number): Promise<RegistroLedger | null> {
    await Promise.resolve();
    this.leituras++;
    return this.dados.get(chave(cadeia, seq)) ?? null;
  }

  async transacao<T>(corpo: (tx: TransacaoLedger) => T): Promise<T> {
    // a transação só abre depois de alguns turnos: os outros escritores avançam nesse intervalo
    await Promise.resolve();
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

const STAKE_OK = {
  autorizada: true,
  kellyCheio: 0.2,
  fracaoKelly: 0.25,
  fracaoBanca: 0.02,
  limites: ['teto'],
  teto: 0.02,
  valor: 20,
};
const TRAVAS_OK = {
  bancaInicial: 1000,
  bancaAtual: 1000,
  pico: 1000,
  drawdown: 0,
  fatorKelly: 1,
  pausadoAte: null,
  perdasHoje: 0,
  diaEncerrado: false,
  expostoHoje: 0,
  motivos: [],
};

type TipoDeTeste = 'decisao' | 'aposta_registrada' | 'resultado' | 'exclusao' | 'correcao';

const corpoDe = (tipo: TipoDeTeste, decisao: { seq: number; hash: string } | null): CorpoLedger => {
  switch (tipo) {
    case 'decisao':
      return {
        entradaMotor: { v4: null, lista: null },
        saida: {},
        snapshot: { odds: [], estatisticas: {}, contexto: {}, prints: {} },
        impressao: 'abc',
      };
    case 'aposta_registrada':
      return {
        decisao,
        aposta: { odd: 2, casa: '1win', valor: 10, feitaEm: T(2) },
        stakeAutorizada: STAKE_OK,
        travas: TRAVAS_OK,
      };
    case 'resultado':
      return { decisao, resultado: { casa: 1, fora: 0, registradoEm: T(1) } };
    case 'exclusao':
      return { motivo: null };
    case 'correcao':
      return { motivo: 'placar digitado errado', novo: { casa: 2, fora: 1 } };
  }
};

async function novoRegistro(
  tipo: TipoDeTeste,
  n: number,
  ultimo: RegistroLedger | null,
  opcoes: {
    corrige?: { seq: number; hash: string };
    decisao?: { seq: number; hash: string };
    cadeia?: string;
  } = {},
): Promise<RegistroLedger> {
  return criarRegistro(
    {
      tipo: tipo as TipoRegistro,
      cadeia: opcoes.cadeia ?? 'A',
      criadoEm: T(n),
      corpo: corpoDe(tipo, opcoes.decisao ?? null),
      versaoMotor: 'teste',
      politicas: { x: 1 },
      ...(opcoes.corrige ? { corrige: opcoes.corrige } : {}),
    },
    ultimo,
  );
}

/** Semeia o armazém com `n` resultados, direto (como se já estivessem gravados). */
async function semear(armazem: ArmazemEmMemoria, n: number, cadeia = 'A') {
  let ultimo: RegistroLedger | null = null;
  const lista: RegistroLedger[] = [];
  for (let i = 1; i <= n; i++) {
    const r = await novoRegistro('resultado', i, ultimo, { cadeia });
    armazem.dados.set(chave(cadeia, i), r);
    lista.push(r);
    ultimo = r;
  }
  return lista;
}

/** Semeia [decisao, resultado, resultado]: o seq 1 é uma decisão. */
async function semearComDecisao(armazem: ArmazemEmMemoria, cadeia = 'A') {
  const d = await novoRegistro('decisao', 1, null, { cadeia });
  const r2 = await novoRegistro('resultado', 2, d, { cadeia });
  const r3 = await novoRegistro('resultado', 3, r2, { cadeia });
  for (const r of [d, r2, r3]) armazem.dados.set(chave(cadeia, r.cabecalho.seq), r);
  return [d, r2, r3];
}

/** Adultera o registro GRAVADO (o corpo muda; o campo `hash` guardado continua o antigo). */
const adulterarNoArmazem = (armazem: ArmazemEmMemoria, seq: number, cadeia = 'A') => {
  const r = armazem.dados.get(chave(cadeia, seq))!;
  const copia = clonar(r);
  (copia.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
  armazem.dados.set(chave(cadeia, seq), copia);
  return copia;
};

describe('anexar: registro comum (sem referências)', () => {
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
    // sem referência, a Fase A só lê o registro anterior: nenhum na gênese, um em cada seguinte
    expect(armazem.leituras).toBe(2);
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

describe('correção: a referência `corrige` é verificada na gravação', () => {
  it('correção com a referência certa é gravada (duas leituras na Fase A, uma transação na B)', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    await expect(anexar(armazem, c)).resolves.toBeUndefined();
    expect(armazem.lista('A')).toHaveLength(4);
    expect(armazem.leituras).toBe(2); // a referência (seq 2) e o registro anterior (seq 3)
    expect((await verificarCadeia(armazem.lista('A'))).estado).toBe('integra');
  });

  it('hash divergente (de outro registro): recusada, nada gravado', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[0].hash },
    });
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/hash/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('hash inventado: recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: 'f'.repeat(64) },
    });
    await expect(anexar(armazem, c)).rejects.toThrow(/hash/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('registro que NÃO existe no armazém: recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    // o armazém perdeu o seq 2 (cópia parcial/corrompida): a ponta (3) ainda é a certa
    armazem.dados.delete(chave('A', 2));
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/não existe/);
    expect(armazem.dados.has(chave('A', 4))).toBe(false);
  });

  it('registro de OUTRA cadeia com o mesmo seq não vale', async () => {
    const armazem = new ArmazemEmMemoria();
    const a = await semear(armazem, 3, 'A');
    const b = await semear(armazem, 3, 'B');
    // hash do registro 2 da cadeia B, apontado por uma correção da cadeia A
    const c = await novoRegistro('correcao', 4, a[2], { corrige: { seq: 2, hash: b[1].hash } });
    await expect(anexar(armazem, c)).rejects.toThrow(/hash/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('o armazém devolve, para (A, seq), um registro que na verdade é de outra cadeia: recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const a = await semear(armazem, 3, 'A');
    const b = await semear(armazem, 3, 'B');
    armazem.dados.set(chave('A', 2), b[1]); // posição de A ocupada por um registro de B
    const c = await novoRegistro('correcao', 4, a[2], { corrige: { seq: 2, hash: b[1].hash } });
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/cadeia e posição/);
  });

  it('seq igual ou superior ao do registro nunca chega à transação', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 3, hash: lista[2].hash },
    });
    const ruim = clonar(c);
    ruim.cabecalho.corrige = { seq: 4, hash: lista[2].hash }; // aponta para si mesmo
    ruim.hash = await hashDoRegistro(ruim.cabecalho, ruim.corpo);
    await expect(anexar(armazem, ruim)).rejects.toThrow(/estritamente menor/);
    expect(armazem.transacoesAbertas).toBe(0);
    expect(armazem.leituras).toBe(0);
  });

  it('campo adicional em `corrige` nunca chega à transação', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 3, hash: lista[2].hash },
    });
    const ruim = clonar(c);
    (ruim.cabecalho.corrige as unknown as Record<string, unknown>).extra = 1;
    ruim.hash = await hashDoRegistro(ruim.cabecalho, ruim.corpo);
    await expect(anexar(armazem, ruim)).rejects.toThrow(/corrige/);
    expect(armazem.transacoesAbertas).toBe(0);
  });

  it('só correções são conferidas por conferirReferencia: registro comum ignora', async () => {
    const lista = await semear(new ArmazemEmMemoria(), 2);
    expect(() => conferirReferencia(null, lista[1])).not.toThrow();
    expect(() => conferirReferencia(lista[0], lista[1])).not.toThrow();
  });
});

describe('Fase A: o hash do registro apontado é RECALCULADO', () => {
  it('registro apontado ADULTERADO (corpo mudou, o campo hash continua o antigo): recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    adulterarNoArmazem(armazem, 2);
    // o armazém guarda hash = corrige.hash, mas o conteúdo já não corresponde a esse hash
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/alterado/);
    expect(armazem.transacoesAbertas).toBe(0); // recusada na Fase A: nem abriu transação
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('hash armazenado que não corresponde ao conteúdo, igual ao declarado em `corrige`: recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const outro = 'b'.repeat(64);
    const trocado = clonar(lista[1]);
    trocado.hash = outro; // o campo hash do armazém foi trocado; o conteúdo é o original
    armazem.dados.set(chave('A', 2), trocado);
    const c = await novoRegistro('correcao', 4, lista[2], { corrige: { seq: 2, hash: outro } });
    await expect(anexar(armazem, c)).rejects.toThrow(/alterado/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('a conferência SÍNCRONA sozinha não vê a adulteração (a fraqueza que a Fase A fecha)', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const adulterado = adulterarNoArmazem(armazem, 2);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    // só existência + hash guardado: passa
    expect(() => conferirReferencia(adulterado, c)).not.toThrow();
    // a gravação completa recusa
    await expect(anexar(armazem, c)).rejects.toThrow(/alterado/);
  });

  it('referência a esquema que o verificador não suporta é recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const novo = clonar(lista[1]);
    novo.cabecalho.esquema = 99;
    novo.hash = 'c'.repeat(64);
    armazem.dados.set(chave('A', 2), novo);
    const c = await novoRegistro('correcao', 4, lista[2], { corrige: { seq: 2, hash: novo.hash } });
    await expect(anexar(armazem, c)).rejects.toThrow(/esquema não suportado/);
  });
});

describe('Fase B: só aceita referência verificada na Fase A, reconfirmada na transação', () => {
  it('alteração ENTRE as fases: a Fase B recusa (ConflitoDeCadeia), nada é gravado', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    // a Fase A vai passar (o registro 2 está íntegro agora); ao abrir a transação, ele é adulterado
    armazem.aoAbrirTransacao = () => {
      armazem.aoAbrirTransacao = undefined;
      adulterarNoArmazem(armazem, 2);
    };
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/mudou entre a verificação e a gravação/);
    expect(armazem.lista('A')).toHaveLength(3); // rollback
    expect(armazem.transacoesConfirmadas).toBe(0);
    // reverificar (como o chamador faz depois de um conflito) agora recusa na Fase A, de vez
    const depois = await anexar(armazem, c).catch((e: unknown) => e);
    expect(depois).toBeInstanceOf(ErroDeCadeia);
    expect(depois).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((depois as Error).message).toMatch(/alterado/);
  });

  it('o registro apontado SUMIU entre as fases: recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    armazem.aoAbrirTransacao = () => {
      armazem.aoAbrirTransacao = undefined;
      armazem.dados.delete(chave('A', 2));
    };
    await expect(anexar(armazem, c)).rejects.toThrow(/não existe/);
    expect(armazem.dados.has(chave('A', 4))).toBe(false);
  });

  it('referências verificadas para OUTRO registro não servem', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c1 = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 1, hash: lista[0].hash },
    });
    const c2 = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    const deC1 = await verificarReferencias(armazem, c1);
    await expect(armazem.transacao((tx) => anexarNaTransacao(tx, c2, deC1))).rejects.toThrow(
      /não foram verificadas/,
    );
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('correção com a verificação de um registro SEM referências (lista vazia) é recusada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const comum = await novoRegistro('resultado', 4, lista[2]);
    const vazia = await verificarReferencias(armazem, comum);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    await expect(armazem.transacao((tx) => anexarNaTransacao(tx, c, vazia))).rejects.toThrow(
      /não foram verificadas/,
    );
  });

  it('um valor forjado à mão (sem passar pela Fase A) é recusado', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: lista[1].hash },
    });
    const forjadas = [
      { registro: c.hash, itens: [] },
      { registro: c.hash, itens: [{ campo: 'corrige', seq: 2, hash: HASH, canonico: '{}' }] },
      undefined,
      null,
    ];
    for (const f of forjadas)
      await expect(armazem.transacao((tx) => anexarNaTransacao(tx, c, f as never))).rejects.toThrow(
        /não foram verificadas/,
      );
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('a leitura da referência e a gravação acontecem na MESMA transação, nesta ordem', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 3, hash: lista[2].hash },
    });
    const verificadas = await verificarReferencias(armazem, c);
    const chamadas: string[] = [];
    const donos = new Set<TransacaoLedger>();
    await armazem.transacao((tx) => {
      const espiao: TransacaoLedger = {
        ponta: (cadeia) => (chamadas.push('ponta'), tx.ponta(cadeia)),
        ler: (cadeia, seq) => (chamadas.push(`ler:${seq}`), tx.ler(cadeia, seq)),
        adicionar: (r) => (chamadas.push('adicionar'), tx.adicionar(r)),
      };
      donos.add(espiao);
      anexarNaTransacao(espiao, c, verificadas);
    });
    expect(chamadas).toEqual(['ponta', 'ler:3', 'adicionar']);
    expect(donos.size).toBe(1);
    expect(armazem.transacoesConfirmadas).toBe(1);
  });

  it('a Fase B é SÍNCRONA (cabe numa transação de IndexedDB)', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 3, hash: lista[2].hash },
    });
    const verificadas = await verificarReferencias(armazem, c);
    await armazem.transacao((tx) => {
      const retorno: unknown = anexarNaTransacao(tx, c, verificadas);
      expect(retorno).toBeUndefined(); // nada de Promise
    });
    expect(() => conferirReferencia(lista[2], c)).not.toThrow();
    expect(() => conferirReferencia(null, c)).toThrow(/não existe/);
    expect(() => conferirReferencia(lista[0], c)).toThrow();
  });
});

describe('decisao: aposta_registrada.decisao e resultado.decisao na gravação', () => {
  it('aposta com a decisão certa é gravada, e o resultado também', async () => {
    const armazem = new ArmazemEmMemoria();
    const [d, , r3] = await semearComDecisao(armazem);
    const aposta = await novoRegistro('aposta_registrada', 4, r3, {
      decisao: { seq: 1, hash: d.hash },
    });
    await expect(anexar(armazem, aposta)).resolves.toBeUndefined();
    const resultado = await novoRegistro('resultado', 5, aposta, {
      decisao: { seq: 1, hash: d.hash },
    });
    await expect(anexar(armazem, resultado)).resolves.toBeUndefined();
    expect((await verificarCadeia(armazem.lista('A'))).estado).toBe('integra');
    expect(armazem.leituras).toBe(4); // em cada gravação: a decisão apontada e o registro anterior
  });

  it('decisao null é permitida (sem referência: só a leitura do registro anterior)', async () => {
    const armazem = new ArmazemEmMemoria();
    const [, , r3] = await semearComDecisao(armazem);
    const aposta = await novoRegistro('aposta_registrada', 4, r3);
    await anexar(armazem, aposta);
    expect(armazem.leituras).toBe(1);
  });

  it('tipo INCORRETO: aponta para um resultado, não para uma decisão', async () => {
    const armazem = new ArmazemEmMemoria();
    const [, r2, r3] = await semearComDecisao(armazem);
    const aposta = await novoRegistro('aposta_registrada', 4, r3, {
      decisao: { seq: 2, hash: r2.hash },
    });
    const erro = await anexar(armazem, aposta).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/tipo "resultado".*"decisao"/);
    expect(armazem.lista('A')).toHaveLength(3);
  });

  it('hash divergente, inventado e ausente', async () => {
    const armazem = new ArmazemEmMemoria();
    const [d, r2, r3] = await semearComDecisao(armazem);
    const divergente = await novoRegistro('aposta_registrada', 4, r3, {
      decisao: { seq: 1, hash: r2.hash },
    });
    await expect(anexar(armazem, divergente)).rejects.toThrow(/hash/);
    const inventado = await novoRegistro('aposta_registrada', 4, r3, {
      decisao: { seq: 1, hash: 'f'.repeat(64) },
    });
    await expect(anexar(armazem, inventado)).rejects.toThrow(/hash/);
    armazem.dados.delete(chave('A', 1));
    const ausente = await novoRegistro('aposta_registrada', 4, r3, {
      decisao: { seq: 1, hash: d.hash },
    });
    await expect(anexar(armazem, ausente)).rejects.toThrow(/não existe/);
    expect(armazem.lista('A')).toHaveLength(2);
  });

  it('decisão de OUTRA cadeia não vale', async () => {
    const armazem = new ArmazemEmMemoria();
    await semearComDecisao(armazem, 'A');
    const [dB] = await semearComDecisao(armazem, 'B');
    const ultimoA = armazem.ponta('A')!;
    const aposta = await novoRegistro('aposta_registrada', 4, ultimoA, {
      decisao: { seq: 1, hash: dB.hash },
    });
    await expect(anexar(armazem, aposta)).rejects.toThrow(/hash/);
  });

  it('seq igual ou superior ao do registro: recusada sem ler o armazém', async () => {
    const armazem = new ArmazemEmMemoria();
    const [d, , r3] = await semearComDecisao(armazem);
    for (const seq of [4, 5, 99]) {
      const aposta = await novoRegistro('aposta_registrada', 4, r3, {
        decisao: { seq, hash: d.hash },
      });
      await expect(anexar(armazem, aposta)).rejects.toThrow(/não é anterior/);
    }
    expect(armazem.leituras).toBe(0);
    expect(armazem.transacoesAbertas).toBe(0);
  });

  it('decisão ADULTERADA no armazém: recusada na Fase A', async () => {
    const armazem = new ArmazemEmMemoria();
    const [d, , r3] = await semearComDecisao(armazem);
    const alterada = clonar(d);
    (alterada.corpo as unknown as { impressao: string }).impressao = 'outra';
    armazem.dados.set(chave('A', 1), alterada); // hash guardado continua o antigo
    const aposta = await novoRegistro('aposta_registrada', 4, r3, {
      decisao: { seq: 1, hash: d.hash },
    });
    await expect(anexar(armazem, aposta)).rejects.toThrow(/alterado/);
    expect(armazem.transacoesAbertas).toBe(0);
  });

  it('decisão alterada ENTRE as fases: ConflitoDeCadeia, nada gravado', async () => {
    const armazem = new ArmazemEmMemoria();
    const [d, , r3] = await semearComDecisao(armazem);
    const aposta = await novoRegistro('aposta_registrada', 4, r3, {
      decisao: { seq: 1, hash: d.hash },
    });
    armazem.aoAbrirTransacao = () => {
      armazem.aoAbrirTransacao = undefined;
      const alterada = clonar(d);
      (alterada.corpo as unknown as { impressao: string }).impressao = 'outra';
      armazem.dados.set(chave('A', 1), alterada);
    };
    await expect(anexar(armazem, aposta)).rejects.toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.lista('A')).toHaveLength(3);
  });
});

describe('atomicidade e concorrência', () => {
  it('se a conferência falha depois de ler, o armazém fica exatamente como estava (rollback)', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const antes = [...armazem.dados.keys()].join('|');
    const c = await novoRegistro('correcao', 4, lista[2], {
      corrige: { seq: 2, hash: 'f'.repeat(64) },
    });
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
    let tentativasDeCorrecao = 0;
    let tentativas = 0;

    const escritor = async (n: number): Promise<void> => {
      for (let tentativa = 0; tentativa < 2000; tentativa++) {
        tentativas++;
        const ponta = armazem.ponta('A');
        // a aba lê a ponta e o registro que quer corrigir FORA da transação (pode ficar velho)
        const alvo = armazem.lista('A')[(n * 7) % armazem.lista('A').length];
        const tipo: TipoDeTeste = n % 3 === 0 ? 'correcao' : n % 3 === 1 ? 'resultado' : 'exclusao';
        const registro = await novoRegistro(tipo, n, ponta, {
          corrige: tipo === 'correcao' ? { seq: alvo.cabecalho.seq, hash: alvo.hash } : undefined,
        });
        if (tipo === 'correcao') tentativasDeCorrecao++;
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
    // 20 das 60 são correções. Cada tentativa fez uma Fase A: uma leitura do registro anterior (todas
    // têm seq > 1) e, nas correções, mais uma da referência, ambas com hash recalculado
    expect(final.filter((r) => r.cabecalho.tipo === 'correcao')).toHaveLength(20);
    expect(armazem.leituras).toBe(tentativas + tentativasDeCorrecao);
  });

  it('60 escritores com referências `decisao` e `corrige` ao mesmo tempo: íntegra', async () => {
    const armazem = new ArmazemEmMemoria();
    const [d] = await semearComDecisao(armazem);
    const escritor = async (n: number): Promise<void> => {
      for (let t = 0; t < 2000; t++) {
        const ponta = armazem.ponta('A')!;
        const tipo: TipoDeTeste =
          n % 3 === 0 ? 'correcao' : n % 3 === 1 ? 'aposta_registrada' : 'resultado';
        const alvo = armazem.lista('A')[(n * 5) % armazem.lista('A').length];
        const r = await novoRegistro(tipo, n, ponta, {
          decisao: tipo === 'correcao' ? undefined : { seq: 1, hash: d.hash },
          corrige: tipo === 'correcao' ? { seq: alvo.cabecalho.seq, hash: alvo.hash } : undefined,
        });
        try {
          await anexar(armazem, r);
          return;
        } catch (e) {
          if (!(e instanceof ConflitoDeCadeia)) throw e;
        }
      }
      throw new Error('escritor esgotou as tentativas');
    };
    await Promise.all(Array.from({ length: 60 }, (_, i) => escritor(i + 1)));
    const final = armazem.lista('A');
    expect(final).toHaveLength(63);
    const rel = await verificarCadeia(final);
    expect(rel.problemas).toEqual([]);
    expect(rel.estado).toBe('integra');
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
        const r = await novoRegistro('correcao', n, ponta, {
          corrige: { seq: 2, hash: base[0].hash },
        });
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

  it('adulteração do registro apontado DURANTE a disputa: nenhuma correção verificada depois dela é gravada', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    let adulterado = false;
    armazem.aoAbrirTransacao = () => {
      if (adulterado) return;
      adulterado = true;
      adulterarNoArmazem(armazem, 2);
    };
    const resultados: string[] = [];
    const escritores = Array.from({ length: 10 }, (_, n) =>
      (async () => {
        for (let t = 0; t < 500; t++) {
          const c = await novoRegistro('correcao', n + 4, armazem.ponta('A'), {
            corrige: { seq: 2, hash: lista[1].hash },
          });
          try {
            await anexar(armazem, c);
            resultados.push('gravada');
            return;
          } catch (e) {
            if (e instanceof ConflitoDeCadeia) continue;
            resultados.push('recusada');
            return;
          }
        }
      })(),
    );
    await Promise.all(escritores);
    // a adulteração ocorre quando a PRIMEIRA transação abre: nenhuma correção pode ter sido gravada
    // com a referência adulterada, nem as que verificaram (Fase A) antes dela e gravam depois (Fase B)
    const corrigidas = armazem.lista('A').filter((r) => r.cabecalho.tipo === 'correcao').length;
    expect(corrigidas).toBe(0);
    expect(resultados).toHaveLength(10);
    expect(resultados.every((r) => r === 'recusada')).toBe(true);
  });

  it('duas correções do mesmo registro ao mesmo tempo: as duas entram, em sequência', async () => {
    const armazem = new ArmazemEmMemoria();
    const lista = await semear(armazem, 3);
    const feita = async (n: number) => {
      for (let t = 0; t < 1000; t++) {
        const c = await novoRegistro('correcao', n, armazem.ponta('A'), {
          corrige: { seq: 1, hash: lista[0].hash },
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
