import { describe, expect, it } from 'vitest';
import { apurarAposta, clv } from '../src/apuracao';
import type { LinhaOdd } from '../src/tipos';

const L = (o: Partial<LinhaOdd> & Pick<LinhaOdd, 'mercado' | 'lado'>): LinhaOdd => ({
  casa: '1win',
  odd: 2,
  periodo: 'FT',
  ...o,
});
const lucro = (l: LinhaOdd, p: Parameters<typeof apurarAposta>[1]) => {
  const a = apurarAposta(l, p);
  if (!a.ok) throw new Error(a.falta);
  return a.lucro;
};

describe('apuração depois do jogo (Fase 4)', () => {
  it('1X2 e totais pelo placar final', () => {
    expect(lucro(L({ mercado: '1X2', lado: '1', odd: 1.8 }), { casa: 2, fora: 1 })).toBeCloseTo(
      0.8,
      12,
    );
    expect(lucro(L({ mercado: 'total', lado: 'over', linha: 2.5 }), { casa: 1, fora: 1 })).toBe(-1);
  });
  it('AH de quarto: meio ganho e meia perda', () => {
    const ah = L({ mercado: 'AH', lado: 'casa', linha: -0.75, odd: 2.1 });
    const a = apurarAposta(ah, { casa: 1, fora: 0 });
    expect(a.ok && a.rotulo).toBe('meio ganho');
    expect(lucro(ah, { casa: 1, fora: 0 })).toBeCloseTo(0.55, 12);
    expect(lucro(L({ mercado: 'AH', lado: 'fora', linha: 0.25 }), { casa: 1, fora: 0 })).toBe(-1);
    expect(lucro(L({ mercado: 'AH', lado: 'casa', linha: -0.25 }), { casa: 0, fora: 0 })).toBe(
      -0.5,
    );
  });
  it('mercado de 1º tempo exige o intervalo; 2º tempo = final − intervalo', () => {
    const t1 = L({ mercado: 'total', lado: 'over', linha: 0.5, periodo: '1T' });
    expect(apurarAposta(t1, { casa: 2, fora: 0 })).toEqual({
      ok: false,
      falta: 'informar o placar do intervalo',
    });
    expect(lucro(t1, { casa: 2, fora: 0, intervalo: { casa: 0, fora: 0 } })).toBe(-1);
    const t2 = L({ mercado: 'total', lado: 'over', linha: 1.5, periodo: '2T' });
    expect(lucro(t2, { casa: 2, fora: 0, intervalo: { casa: 0, fora: 0 } })).toBe(1);
  });
  it('escanteios e cartões pela contagem informada', () => {
    const esc = L({ mercado: 'escanteios_total', lado: 'over', linha: 9.5, odd: 1.9 });
    expect(apurarAposta(esc, { casa: 1, fora: 0 }).ok).toBe(false);
    expect(lucro(esc, { casa: 1, fora: 0, escanteios: { casa: 7, fora: 4 } })).toBeCloseTo(0.9);
    const cart = L({ mercado: 'cartoes_1x2', lado: '2' });
    expect(lucro(cart, { casa: 0, fora: 0, cartoes: { casa: 2, fora: 3 } })).toBe(1);
  });
  it('CLV: odd pega acima da de fechamento é positivo', () => {
    expect(clv(2.1, 2.0)).toBeCloseTo(0.05, 12);
    expect(clv(1.9, 2.0)).toBeCloseTo(-0.05, 12);
  });
});
