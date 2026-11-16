/** Serialização canônica: determinística, independente da ordem das propriedades, sem "adivinhar". */
import { describe, expect, it } from 'vitest';
import { ErroSerializacao, serializarCanonico } from '../../src/ledger';

const S = serializarCanonico;

describe('objetos: chaves ordenadas por unidade de código UTF-16', () => {
  it('a ordem de inserção não importa', () => {
    expect(S({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(S({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('em todos os níveis', () => {
    expect(S({ z: { y: 1, x: [{ d: 1, c: 2 }] }, a: 0 })).toBe(
      '{"a":0,"z":{"x":[{"c":2,"d":1}],"y":1}}',
    );
  });

  it('maiúsculas antes de minúsculas (ordem de unidade de código, não alfabética local)', () => {
    expect(S({ a: 1, B: 2, A: 3, b: 4 })).toBe('{"A":3,"B":2,"a":1,"b":4}');
  });

  it('chaves não-ASCII pela unidade de código UTF-16 (não pelo ponto de código)', () => {
    // U+FF5E (BMP) < U+D83D U+DE00 (par substituto) em UTF-16, ao contrário da ordem por ponto de código
    const r = S({ '～': 1, '😀': 2 });
    expect(r.indexOf('😀')).toBeLessThan(r.indexOf('～'));
  });

  it('objeto vazio', () => {
    expect(S({})).toBe('{}');
  });

  it('protótipo nulo é aceito', () => {
    const o = Object.create(null) as Record<string, number>;
    o.b = 1;
    o.a = 2;
    expect(S(o)).toBe('{"a":2,"b":1}');
  });

  it('a chave "__proto__" como dado é preservada', () => {
    const o = JSON.parse('{"__proto__": 1, "a": 2}') as unknown;
    expect(S(o)).toBe('{"__proto__":1,"a":2}');
  });
});

describe('campos ausentes: undefined é omitido, null é um valor', () => {
  it('undefined em objeto = campo ausente', () => {
    expect(S({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(S({ a: 1, b: undefined })).toBe(S({ a: 1 }));
  });
  it('null é preservado e difere de ausente', () => {
    expect(S({ a: null })).toBe('{"a":null}');
    expect(S({ a: null })).not.toBe(S({}));
  });
  it('undefined no topo ou em array é recusado (não vira null)', () => {
    expect(() => S(undefined)).toThrow(ErroSerializacao);
    expect(() => S([1, undefined, 3])).toThrow(/undefined dentro de array/);
  });
  it('array esparso (buraco) é recusado', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(() => S([1, , 3])).toThrow(/esparso/);
  });
});

describe('arrays: a ordem é parte do significado', () => {
  it('preservada', () => {
    expect(S([3, 1, 2])).toBe('[3,1,2]');
    expect(S([3, 1, 2])).not.toBe(S([1, 2, 3]));
  });
  it('aninhados e vazios', () => {
    expect(S([[], [[]], {}])).toBe('[[],[[]],{}]');
  });
  it('objetos dentro do array têm as chaves ordenadas, o array não é reordenado', () => {
    expect(
      S([
        { b: 1, a: 2 },
        { d: 1, c: 2 },
      ]),
    ).toBe('[{"a":2,"b":1},{"c":2,"d":1}]');
  });
});

describe('números', () => {
  it('algoritmo Number::toString do ECMAScript (o mesmo do JCS)', () => {
    expect(S(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(S(100)).toBe('100');
    expect(S(1e21)).toBe('1e+21');
    expect(S(1e-7)).toBe('1e-7');
    expect(S(123456789012345680000)).toBe('123456789012345680000');
    expect(S(-1.5)).toBe('-1.5');
    expect(S(2 ** 53)).toBe('9007199254740992');
  });
  it('-0 é escrito como 0', () => {
    expect(S(-0)).toBe('0');
    expect(S({ a: -0 })).toBe(S({ a: 0 }));
  });
  it('NaN e Infinity são recusados', () => {
    for (const n of [NaN, Infinity, -Infinity]) expect(() => S(n)).toThrow(/não finito/);
    expect(() => S({ a: { b: [NaN] } })).toThrow(/\.a\.b\[0\]/);
  });
  it('BigInt é recusado', () => {
    expect(() => S(10n)).toThrow(/BigInt/);
  });
  it('1 e 1.0 são o mesmo número', () => {
    expect(S(1.0)).toBe('1');
  });
});

describe('strings e Unicode: sem normalização', () => {
  it('escapes padrão do JSON', () => {
    expect(S('a"b\\c\nd\te')).toBe('"a\\"b\\\\c\\nd\\te"');
    expect(S('\u0000\u001f')).toBe('"\\u0000\\u001f"');
  });
  it('caracteres não-ASCII ficam literais', () => {
    expect(S('Atlético × São Paulo 日本')).toBe('"Atlético × São Paulo 日本"');
    expect(S('😀')).toBe('"😀"');
  });
  it('U+2028 e U+2029 ficam literais', () => {
    expect(S('  ')).toBe('"  "');
  });
  it('NÃO normaliza: "é" composto e decomposto são diferentes', () => {
    expect(S('é')).not.toBe(S('é'));
    expect(S('é')).toBe('"é"');
    expect(S('é')).toBe('"é"');
  });
  it('NÃO apara espaços nem troca quebras de linha', () => {
    expect(S('  x  ')).toBe('"  x  "');
    expect(S('a\r\nb')).toBe('"a\\r\\nb"');
    expect(S('a\r\nb')).not.toBe(S('a\nb'));
  });
  it('surrogate solitário é escapado (preservado, nunca vira U+FFFD)', () => {
    expect(S('\uD800')).toBe('"\\ud800"');
    expect(S('x\uDFFFy')).toBe('"x\\udfffy"');
    expect(S('\uD800')).not.toBe(S('�'));
  });
  it('par substituto válido não é escapado', () => {
    expect(S('😀')).toBe('"😀"');
  });
  it('chaves também são escapadas', () => {
    expect(S({ 'a"b': 1 })).toBe('{"a\\"b":1}');
  });
});

describe('o que é recusado (nada é convertido em silêncio)', () => {
  it('Date: use uma string ISO', () => {
    expect(() => S({ quando: new Date() })).toThrow(/objeto não puro \(Date\)/);
    expect(S({ quando: '2026-11-13T15:10:00-03:00' })).toBe(
      '{"quando":"2026-11-13T15:10:00-03:00"}',
    );
  });
  it('Map, Set, RegExp e instâncias de classe', () => {
    expect(() => S(new Map())).toThrow(/Map/);
    expect(() => S(new Set())).toThrow(/Set/);
    expect(() => S(/x/)).toThrow(/RegExp/);
    class Coisa {
      a = 1;
    }
    expect(() => S(new Coisa())).toThrow(/Coisa/);
  });
  it('funções e símbolos', () => {
    expect(() => S({ f: () => 1 })).toThrow(/function/);
    expect(() => S(Symbol('x'))).toThrow(/symbol/);
  });
  it('não usa toJSON: o método é uma função e função é recusada', () => {
    expect(() => S({ toJSON: () => 'x' })).toThrow(/function/);
    expect(() => S({ quando: new Date() })).toThrow(/Date/);
  });
  it('referência circular', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => S(a)).toThrow(/circular/);
    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => S(arr)).toThrow(/circular/);
  });
  it('profundidade excessiva', () => {
    let o: unknown = 1;
    for (let i = 0; i < 300; i++) o = [o];
    expect(() => S(o)).toThrow(/profundidade/);
  });
  it('o erro informa o caminho', () => {
    try {
      S({ a: [1, { b: NaN }] });
      throw new Error('deveria falhar');
    } catch (e) {
      expect((e as ErroSerializacao).caminho).toBe('.a[1].b');
    }
  });
  it('a mesma referência repetida (não circular) é aceita', () => {
    const x = { v: 1 };
    expect(S({ a: x, b: x })).toBe('{"a":{"v":1},"b":{"v":1}}');
  });
});

describe('determinismo', () => {
  it('mil embaralhamentos de propriedades dão a mesma saída', () => {
    const chaves = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'];
    const esperado = S(Object.fromEntries(chaves.map((k, i) => [k, i])));
    let semente = 12345;
    const aleatorio = () => (semente = (semente * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let n = 0; n < 1000; n++) {
      const ordem = [...chaves].sort(() => aleatorio() - 0.5);
      expect(S(Object.fromEntries(ordem.map((k) => [k, chaves.indexOf(k)])))).toBe(esperado);
    }
  });

  it('a saída é JSON válido e volta ao mesmo valor', () => {
    const v = { a: [1, 2.5, 'x', null, true], b: { c: 'é', d: [] } };
    expect(JSON.parse(S(v))).toEqual(v);
  });

  it('serializar duas vezes o mesmo valor dá a mesma string', () => {
    const v = { n: 0.1 + 0.2, t: 'ç', a: [{ z: 1, y: 2 }] };
    expect(S(v)).toBe(S(v));
  });

  it('valor que passou por JSON.parse(JSON.stringify(...)) mantém a saída', () => {
    const v = { b: 1, a: [1, { d: 4, c: 3 }], s: 'ã' };
    expect(S(JSON.parse(JSON.stringify(v)))).toBe(S(v));
  });
});
