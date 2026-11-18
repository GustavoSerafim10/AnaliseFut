/**
 * Leitura do resultado digitado (placar.ts): inteiros não negativos nos pares e odds finitas e
 * maiores que 1. O Ledger continua a última barreira: o teste final confere que tudo o que o
 * formulário aceita o Ledger aceita, e que o formulário recusa o que o Ledger recusaria.
 */
import { describe, expect, it } from 'vitest';
import { motivoCorpoIncompativel } from '@pe/engine';
import { lerInteiroNaoNegativo, lerOdd, lerOddsDosOutrosLados, lerParInteiro } from '../src/placar';

const ok = (valor: unknown) => ({ estado: 'ok', valor });

describe('lerInteiroNaoNegativo', () => {
  it('aceita inteiros não negativos, com espaços nas pontas', () => {
    for (const [texto, n] of [
      ['0', 0],
      ['1', 1],
      ['12', 12],
      ['007', 7],
      [' 3 ', 3],
      ['\t4\n', 4],
    ] as const)
      expect(lerInteiroNaoNegativo(texto)).toEqual(ok(n));
  });

  it('vazio e só espaços são "vazio", não erro', () => {
    for (const t of ['', '   ', '\n'])
      expect(lerInteiroNaoNegativo(t)).toEqual({ estado: 'vazio' });
  });

  it('recusa decimal, negativo, sinal, expoente, texto e misturas', () => {
    for (const t of [
      '1.5',
      '1,5',
      '0.0',
      '-1',
      '-0',
      '+1',
      '1e2',
      '2x',
      'x2',
      'dois',
      '1 2',
      '١٢', // dígitos de outro alfabeto
      'NaN',
      'Infinity',
      '0x10',
      '1_000',
      '２', // dígito de largura total
    ])
      expect(lerInteiroNaoNegativo(t), JSON.stringify(t)).toMatchObject({ estado: 'invalido' });
  });

  it('recusa número grande demais para ser inteiro seguro', () => {
    expect(lerInteiroNaoNegativo('9'.repeat(30))).toMatchObject({ estado: 'invalido' });
    expect(lerInteiroNaoNegativo(String(Number.MAX_SAFE_INTEGER))).toEqual(
      ok(Number.MAX_SAFE_INTEGER),
    );
  });
});

describe('lerParInteiro', () => {
  it('par completo e válido', () => {
    expect(lerParInteiro('2', '1')).toEqual(ok({ casa: 2, fora: 1 }));
    expect(lerParInteiro('0', '0')).toEqual(ok({ casa: 0, fora: 0 }));
  });

  it('os dois vazios = vazio', () => {
    expect(lerParInteiro('', '')).toEqual({ estado: 'vazio' });
    expect(lerParInteiro('  ', '')).toEqual({ estado: 'vazio' });
  });

  it('um lado só é inválido (não é descartado em silêncio)', () => {
    for (const [c, f] of [
      ['2', ''],
      ['', '1'],
    ] as const)
      expect(lerParInteiro(c, f)).toEqual({ estado: 'invalido', motivo: 'preencha os dois lados' });
  });

  it('um lado inválido invalida o par, e mostra o motivo do lado ruim', () => {
    for (const [c, f] of [
      ['1.5', '0'],
      ['2', '-1'],
      ['x', '1'],
      ['1', 'y'],
      ['1,5', ''],
    ] as const)
      expect(lerParInteiro(c, f), `${c}/${f}`).toMatchObject({ estado: 'invalido' });
  });
});

describe('lerOdd', () => {
  it('aceita decimal com ponto ou vírgula, maior que 1', () => {
    for (const [t, n] of [
      ['1.85', 1.85],
      ['1,85', 1.85],
      ['2', 2],
      ['10', 10],
      ['1.01', 1.01],
      [' 3,40 ', 3.4],
    ] as const)
      expect(lerOdd(t)).toEqual(ok(n));
  });

  it('1 e abaixo são recusados', () => {
    for (const t of ['1', '1.0', '1,00', '0.99', '0,5', '0'])
      expect(lerOdd(t), t).toMatchObject({
        estado: 'invalido',
        motivo: expect.stringMatching(/maior que 1/),
      });
  });

  it('recusa negativo, texto, expoente, Infinity e formatos estranhos', () => {
    for (const t of [
      '-2',
      'abc',
      '1e3',
      'Infinity',
      'NaN',
      '1.85x',
      '1..5',
      '1.',
      '.5',
      ',5',
      '1,5,5',
      '+2',
    ])
      expect(lerOdd(t), t).toMatchObject({ estado: 'invalido' });
  });

  it('vazio é vazio', () => {
    expect(lerOdd('')).toEqual({ estado: 'vazio' });
    expect(lerOdd('  ')).toEqual({ estado: 'vazio' });
  });
});

describe('lerOddsDosOutrosLados', () => {
  it('lista separada por espaço ou ponto e vírgula', () => {
    expect(lerOddsDosOutrosLados('3.4 5,2')).toEqual(ok([3.4, 5.2]));
    expect(lerOddsDosOutrosLados('2.05')).toEqual(ok([2.05]));
    expect(lerOddsDosOutrosLados('3.4;5.2')).toEqual(ok([3.4, 5.2]));
    expect(lerOddsDosOutrosLados(' 3.4 ;  5.2 ')).toEqual(ok([3.4, 5.2]));
  });

  it('vazio', () => {
    expect(lerOddsDosOutrosLados('')).toEqual({ estado: 'vazio' });
    expect(lerOddsDosOutrosLados(' ; ')).toEqual({ estado: 'vazio' });
  });

  it('um item inválido invalida o campo todo (antes era descartado em silêncio)', () => {
    for (const t of ['3.4 1', '3.4 x', '0.5 3.4', '3.4 -2', '2.05 1,0'])
      expect(lerOddsDosOutrosLados(t), t).toMatchObject({ estado: 'invalido' });
  });
});

describe('o formulário e o Ledger concordam', () => {
  const corpo = (resultado: unknown) => ({ decisao: null, resultado });
  const ledger = (casa: number, fora: number) =>
    motivoCorpoIncompativel(
      { tipo: 'resultado', seq: 2 },
      corpo({ casa, fora, registradoEm: '2026-11-13T15:00:00-03:00' }),
    );

  it('todo placar que o formulário aceita, o Ledger aceita', () => {
    for (const [c, f] of [
      ['0', '0'],
      ['3', '1'],
      ['10', '12'],
      ['007', '1'],
    ] as const) {
      const l = lerParInteiro(c, f);
      expect(l.estado).toBe('ok');
      if (l.estado === 'ok') expect(ledger(l.valor.casa, l.valor.fora)).toBeNull();
    }
  });

  it('todo placar que o Ledger recusaria, o formulário não deixa chegar lá', () => {
    for (const [c, f] of [
      ['1.5', '0'],
      ['2', '-1'],
      ['1e1', '0'],
      ['', ''],
      ['2', ''],
    ] as const) {
      const l = lerParInteiro(c, f);
      expect(l.estado === 'ok', `${c}/${f}`).toBe(false);
    }
    // e o Ledger continua recusando, como última barreira
    expect(ledger(1.5, 0)).toMatch(/casa/);
    expect(ledger(2, -1)).toMatch(/fora/);
    expect(ledger(Number.NaN, Number.NaN)).toMatch(/casa/);
  });
});
