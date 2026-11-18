/**
 * Fechamento da auditoria do Ledger:
 *  1. `serializarCanonico` lê o comprimento de um array e cada posição UMA vez, e serializa exatamente
 *     o valor capturado (getter e Proxy dinâmicos);
 *  2. o nome do tipo de um objeto recusado é lido sem executar getters;
 *  3. a descrição de um valor lançado (`descreverFalha`) nunca executa código dele, e cada ponto do
 *     Ledger que monta mensagem a partir de uma exceção (json, cadeia, validacao, reproducao, armazem)
 *     converte a falha no erro previsto pelo contrato, sem exceção crua.
 */
import { describe, expect, it } from 'vitest';
import {
  anexar,
  ConflitoDeCadeia,
  conferirRegistro,
  ErroDeCadeia,
  ErroSerializacao,
  motivoCorpoIncompativel,
  reproduzir,
  serializarCanonico,
  verificarCadeia,
  type CabecalhoLedger,
  type RegistroLedger,
} from '../../src/ledger';
import { descreverFalha } from '../../src/ledger/falha'; // módulo interno
import { cadeiaBase, clonar } from './apoioEsquema2';
import { ArmazemDeTeste } from './apoioGravacao';

type Objeto = Record<string, unknown>;
const TEXTO_FIXO = 'falha sem mensagem legível';

/** um valor lançado HOSTIL: `message` é getter que lança e a conversão para texto também lança */
function hostil() {
  let leituras = 0;
  const lanca = () => {
    leituras++;
    throw new Error('conversão hostil executada');
  };
  const obj = {
    get message(): string {
      return lanca();
    },
    toString: lanca,
    valueOf: lanca,
    [Symbol.toPrimitive]: lanca,
  };
  return { obj, leituras: () => leituras };
}

/** um Proxy lançado que lança em QUALQUER inspeção (protótipo, descritor, leitura) */
const proxyQueLancaEmTudo = () =>
  new Proxy(
    {},
    {
      get() {
        throw new Error('get');
      },
      getPrototypeOf() {
        throw new Error('getPrototypeOf');
      },
      getOwnPropertyDescriptor() {
        throw new Error('getOwnPropertyDescriptor');
      },
    },
  );

describe('json.ts: cada posição de array e o comprimento são lidos UMA vez', () => {
  it('getter numa posição: lido uma vez, e o valor serializado é o capturado', () => {
    for (const [primeiro, depois] of [
      [1, undefined],
      [1, 'trocado'],
      [undefined, 2],
    ] as const) {
      let leituras = 0;
      const arr: unknown[] = [0, 0];
      Object.defineProperty(arr, 1, {
        enumerable: true,
        get: () => (++leituras === 1 ? primeiro : depois),
      });
      if (primeiro === undefined)
        expect(() => serializarCanonico(arr)).toThrow(/undefined dentro de array/);
      else expect(serializarCanonico(arr)).toBe(`[0,${JSON.stringify(primeiro)}]`);
      expect(leituras, `${String(primeiro)} → ${String(depois)}`).toBe(1);
    }
  });

  it('Proxy de array dinâmico: `length` lido uma vez e cada índice lido uma vez', () => {
    const leituras = new Map<string, number>();
    const proxy = new Proxy([10, 20, 30], {
      get(t, k, r) {
        const chave = String(k);
        const n = (leituras.get(chave) ?? 0) + 1;
        leituras.set(chave, n);
        if (chave === 'length') return n === 1 ? 3 : 1; // encolhe depois da primeira leitura
        if (chave === '2') return n === 1 ? 30 : undefined; // some depois da primeira leitura
        return Reflect.get(t, k, r) as unknown;
      },
    });
    expect(serializarCanonico({ a: proxy })).toBe('{"a":[10,20,30]}');
    expect(leituras.get('length')).toBe(1);
    for (const i of ['0', '1', '2']) expect(leituras.get(i), `índice ${i}`).toBe(1);
  });

  it('arrays comuns continuam iguais (compatibilidade com os hashes gravados)', () => {
    expect(serializarCanonico([1, 'a', null, [true], { b: [2] }])).toBe(
      '[1,"a",null,[true],{"b":[2]}]',
    );
    expect(() => serializarCanonico([1, undefined])).toThrow(/undefined dentro de array/);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => serializarCanonico([1, , 3])).toThrow(/array esparso/);
  });
});

describe('json.ts: o nome do tipo de um objeto recusado é lido sem executar getters', () => {
  it('tipos comuns continuam nomeados', () => {
    class Aposta {}
    expect(() => serializarCanonico(new Date(0))).toThrow(/objeto não puro \(Date\)/);
    expect(() => serializarCanonico(new Map())).toThrow(/objeto não puro \(Map\)/);
    expect(() => serializarCanonico(new Aposta())).toThrow(/objeto não puro \(Aposta\)/);
  });

  it('getter em `constructor`, `name` estático hostil e Proxy que lança: "desconhecido", nada executado', () => {
    let executados = 0;
    const proto = {};
    Object.defineProperty(proto, 'constructor', {
      get: () => {
        executados++;
        throw new Error('constructor hostil');
      },
    });
    class NomeHostil {
      static get name(): string {
        executados++;
        throw new Error('name hostil');
      }
    }
    const semConstrutor = Object.create(Object.create(null) as object) as object;
    for (const v of [Object.create(proto) as object, new NomeHostil(), semConstrutor]) {
      expect(() => serializarCanonico(v)).toThrow(ErroSerializacao);
      expect(() => serializarCanonico(v)).toThrow(/objeto não puro \(desconhecido\)/);
    }
    expect(executados).toBe(0);
  });
});

describe('descreverFalha: nunca executa código do valor lançado', () => {
  it('erros comuns e primitivos mantêm a mensagem', () => {
    expect(descreverFalha(new Error('disco cheio'))).toBe('disco cheio');
    expect(descreverFalha(new TypeError('x é undefined'))).toBe('x é undefined');
    expect(descreverFalha(new ErroSerializacao('referência circular', '.a'))).toBe(
      'referência circular (em .a)',
    );
    expect(descreverFalha('texto')).toBe('texto');
    expect(descreverFalha(42)).toBe('42');
    expect(descreverFalha(null)).toBe('null');
    expect(descreverFalha(undefined)).toBe('undefined');
    expect(descreverFalha(Symbol('s'))).toBe('Symbol(s)');
  });

  it('getter hostil em `message`, conversão maliciosa e Proxy que lança: texto fixo, nada executado', () => {
    const h = hostil();
    expect(descreverFalha(h.obj)).toBe(TEXTO_FIXO);
    expect(h.leituras()).toBe(0);
    expect(descreverFalha(proxyQueLancaEmTudo())).toBe(TEXTO_FIXO);
    expect(descreverFalha({ message: 42 })).toBe(TEXTO_FIXO); // mensagem que não é texto
    expect(descreverFalha({})).toBe(TEXTO_FIXO);
  });
});

/** valor que, ao ser serializado, lança `lancado` (getter numa chave livre de `saida`) */
function saidaQueLanca(lancado: () => unknown): Objeto {
  const saida: Objeto = {};
  Object.defineProperty(saida, 'x', {
    enumerable: true,
    get: () => {
      throw lancado();
    },
  });
  return saida;
}

/** a decisão do seq 1 da cadeia base com a `saida` trocada (o hash gravado continua o antigo) */
async function decisaoComSaida(saida: Objeto): Promise<RegistroLedger> {
  const d = clonar((await cadeiaBase())[0]) as unknown as { corpo: Objeto };
  d.corpo.saida = saida;
  return d as unknown as RegistroLedger;
}

const LANCADOS: [string, () => unknown][] = [
  ['erro comum', () => new Error('getter explodiu')],
  ['objeto hostil', () => hostil().obj],
  ['Proxy que lança em tudo', () => proxyQueLancaEmTudo()],
  ['null', () => null],
];

describe('cadeia.ts: falha de serialização vira o erro do contrato', () => {
  it.each(LANCADOS)(
    'verificarCadeia, %s lançado ao serializar: problema hash_invalido',
    async (_, l) => {
      const r = await decisaoComSaida(saidaQueLanca(l));
      const rel = await verificarCadeia([r]);
      expect(rel.estado).toBe('adulterada');
      const p = rel.problemas.find((x) => x.codigo === 'hash_invalido');
      expect(p?.detalhe).toMatch(/^conteúdo não serializável: /);
    },
  );

  it.each(LANCADOS)('conferirRegistro, %s lançado ao serializar: ErroDeCadeia', async (_, l) => {
    const r = await decisaoComSaida(saidaQueLanca(l));
    const erro = await conferirRegistro(r).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/registro recusado: conteúdo não serializável \(/);
  });

  it('o objeto hostil não é tocado (nem `message`, nem conversão)', async () => {
    const h = hostil();
    const r = await decisaoComSaida(saidaQueLanca(() => h.obj));
    await verificarCadeia([r]);
    await conferirRegistro(r).catch(() => undefined);
    expect(h.leituras()).toBe(0);
  });
});

describe('validacao.ts: `correcao.novo` não serializável', () => {
  it.each(LANCADOS)('%s lançado: motivo de texto, sem exceção', (_, l) => {
    const cab = { tipo: 'correcao', esquema: 1 } as unknown as CabecalhoLedger;
    const motivo = motivoCorpoIncompativel(cab, {
      motivo: 'x',
      novo: saidaQueLanca(l),
    } as never);
    expect(motivo).toMatch(/correcao\.novo não é serializável: /);
  });
});

describe('reproducao.ts: o executor do motor lança', () => {
  it.each(LANCADOS)('%s lançado: nao_reproduzivel / erro_ao_executar', async (_, l) => {
    const d = clonar((await cadeiaBase())[0]) as unknown as { corpo: Objeto };
    d.corpo.entradaMotor = { v4: {}, lista: null };
    const r = await reproduzir(d as unknown as RegistroLedger, () => {
      throw l();
    });
    expect(r.situacao).toBe('nao_reproduzivel');
    expect(r.causa).toBe('erro_ao_executar');
    expect(typeof r.detalhe).toBe('string');
  });
});

describe('armazem.ts: falhas do armazém e do registro novo nunca escapam cruas', () => {
  it.each(LANCADOS)('armazem.ler lança %s: ErroDeCadeia, nada gravado', async (_, l) => {
    const base = await cadeiaBase();
    const armazem = new ArmazemDeTeste(base.slice(0, 2));
    armazem.ler = () => Promise.reject(l());
    const antes = armazem.foto();
    const erro = await anexar(armazem, base[2]).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/a leitura do armazém falhou/);
    expect(armazem.foto()).toBe(antes);
    expect(armazem.transacoesConfirmadas).toBe(0);
  });

  it.each(LANCADOS)('tx.ponta lança %s: ErroDeCadeia, nada gravado', async (_, l) => {
    const base = await cadeiaBase();
    const armazem = new ArmazemDeTeste(base.slice(0, 2));
    const transacao = armazem.transacao.bind(armazem);
    armazem.transacao = (corpo) =>
      transacao((tx) =>
        corpo({
          ...tx,
          ponta: () => {
            throw l();
          },
        }),
      );
    const antes = armazem.foto();
    const erro = await anexar(armazem, base[2]).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/a leitura na transação falhou/);
    expect(armazem.foto()).toBe(antes);
  });

  it('ConflitoDeCadeia lançado pelo armazém continua ConflitoDeCadeia', async () => {
    const base = await cadeiaBase();
    const armazem = new ArmazemDeTeste(base.slice(0, 2));
    const conflito = new ConflitoDeCadeia('outro escritor');
    armazem.ler = () => Promise.reject(conflito);
    expect(await anexar(armazem, base[2]).catch((e: unknown) => e)).toBe(conflito);
  });

  it.each(LANCADOS)(
    'registro NOVO com getter que lança %s: ErroDeCadeia de `anexar` (antes: exceção crua), nada gravado',
    async (_, l) => {
      const base = await cadeiaBase();
      const r = clonar(base[0]) as unknown as Objeto;
      Object.defineProperty(r, 'corpo', {
        enumerable: true,
        get: () => {
          throw l();
        },
      });
      const armazem = new ArmazemDeTeste([]);
      const erro = await anexar(armazem, r as unknown as RegistroLedger).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroDeCadeia);
      expect((erro as Error).message).toMatch(/registro recusado/);
      expect(armazem.dados.size).toBe(0);
      expect(armazem.transacoesAbertas).toBe(0);
    },
  );

  it('registro novo cujo getter lança ConflitoDeCadeia: continua ConflitoDeCadeia', async () => {
    const base = await cadeiaBase();
    const r = clonar(base[0]) as unknown as Objeto;
    const conflito = new ConflitoDeCadeia('conflito');
    Object.defineProperty(r, 'corpo', {
      enumerable: true,
      get: () => {
        throw conflito;
      },
    });
    const erro = await anexar(new ArmazemDeTeste([]), r as unknown as RegistroLedger).catch(
      (e: unknown) => e,
    );
    expect(erro).toBe(conflito);
  });

  it('cadeia legítima continua gravando', async () => {
    const base = await cadeiaBase();
    const armazem = new ArmazemDeTeste([]);
    for (const r of base) await anexar(armazem, r);
    expect(armazem.lista().map((r) => r.hash)).toEqual(base.map((r) => r.hash));
  });
});
