import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OddLine } from '@pe/schemas';
import { aplicarLeitura, oddsDefasadas } from '../src/oddsDaCasa';
import { podeSalvarSozinho } from '../src/historico';
import { rascunhoNovo } from '../src/estado';
import type { Derivado } from '../src/dados';

const odd = (lado: string, valor: number, m: Partial<OddLine> = {}): OddLine => ({
  casa: '99Play',
  mercado: '1X2',
  periodo: 'FT',
  lado,
  odd: valor,
  fonte: 'ocr',
  ...m,
});

describe('odds saem dos prints', () => {
  it('print apagado leva as odds junto', () => {
    expect(aplicarLeitura([odd('1', 1.57), odd('X', 3.75)], '99Play', [])).toEqual([]);
  });
  it('leitura nova troca o lixo antigo', () => {
    const lixo = odd('casa', 5.33, { mercado: 'AH', linha: 4.75 });
    const r = aplicarLeitura([odd('1', 1.57), lixo], '99Play', [odd('1', 1.6)]);
    expect(r).toHaveLength(1);
    expect(r[0].odd).toBe(1.6);
  });
  it('corrigida à mão ou importada fica, e ganha da leitura', () => {
    const mao = odd('1', 1.7, { fonte: 'manual' });
    const json = odd('2', 5.0, { fonte: 'json' });
    const r = aplicarLeitura([mao, json], '99Play', [odd('1', 1.57), odd('X', 3.75)]);
    expect(r.map((o) => [o.lado, o.odd]).sort()).toEqual([
      ['1', 1.7],
      ['2', 5],
      ['X', 3.75],
    ]);
  });
  it('outras casas não mudam', () => {
    const outra = odd('1', 1.5, { casa: '1win' });
    expect(aplicarLeitura([outra], '99Play', [])).toEqual([outra]);
  });
  it('a mesma odd em dois prints conta uma vez', () => {
    expect(aplicarLeitura([], '99Play', [odd('1', 1.57), odd('1', 1.57)])).toHaveLength(1);
  });
});

describe('odds defasadas', () => {
  it('avisa do que não sai mais dos prints', () => {
    const lixo = odd('casa', 5.33, { mercado: 'AH', linha: 4.75 });
    expect(oddsDefasadas([odd('1', 1.57), lixo], '99Play', [odd('1', 1.57)])).toBe(1);
    expect(oddsDefasadas([odd('1', 1.4)], '99Play', [odd('1', 1.14)])).toBe(1);
  });
  it('tudo igual, ou odd à mão: nada a avisar', () => {
    expect(oddsDefasadas([odd('1', 1.57)], '99Play', [odd('1', 1.57)])).toBe(0);
    expect(oddsDefasadas([odd('1', 2, { fonte: 'manual' })], '99Play', [])).toBe(0);
  });
  it('odd removida de propósito não fica pedindo releitura', () => {
    expect(oddsDefasadas([], '99Play', [odd('1', 1.57)])).toBe(0);
  });
});

describe('análise apagada do histórico', () => {
  const d = {
    oddsValidas: [{}],
    v4: { decisao: 'NO_BET' },
    pendenciasV4: [],
  } as unknown as Derivado;
  const r = {
    ...rascunhoNovo(),
    jogo: { casa: 'A', fora: 'B', competicao: '', data: '2026-11-05', hora: '19:30' },
  };
  const antes = Date.parse('2026-11-05T12:00:00-03:00');
  it('não volta sozinha', () => {
    expect(podeSalvarSozinho(r, d, antes)).toBe(true);
    expect(podeSalvarSozinho({ ...r, naoSalvarSozinho: true }, d, antes)).toBe(false);
  });
});

describe('data de um cadastro novo', () => {
  afterEach(() => vi.useRealTimers());
  it('às 22h30 ainda é hoje (em UTC já seria amanhã)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 5, 22, 30));
    expect(rascunhoNovo().jogo.data).toBe('2026-11-05');
  });
});
