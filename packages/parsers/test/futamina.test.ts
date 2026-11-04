import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerOddsCasa } from '../src';

// Futamina (futamina.com), tema claro, Athletico-PR × Vasco (04/11/2026): odds conferidas no print
const fx = (n: number) =>
  readFileSync(new URL(`./fixtures-reais/futamina-athletico-${n}.txt`, import.meta.url), 'utf8');
const ctx = {
  casa: 'Futamina',
  jogo: { casa: 'Athletico Paranaense', fora: 'Vasco da Gama' },
  data: '2026-11-04',
};
const ls = lerOddsCasa([16, 17, 18, 19, 20, 21, 22].map(fx), ctx).linhas;
const odd = (f: Record<string, unknown>) =>
  ls
    .filter((l) => Object.entries(f).every(([k, v]) => l[k as keyof typeof l] === v))
    .map((l) => l.odd);

describe('Futamina — tema claro', () => {
  it('1X2 com o rótulo "1" apagado: a primeira odd é a do mandante', () => {
    expect(odd({ mercado: '1X2', lado: '1' })).toEqual([2.17]);
    expect(odd({ mercado: '1X2', lado: 'X' })).toEqual([3.36]);
    expect(odd({ mercado: '1X2', lado: '2' })).toEqual([3.26]);
  });
  it('"Pagamento antecipado" e "Resultado + ambas" não viram 1X2 nem ambas', () => {
    expect(odd({ mercado: '1X2' })).not.toContain(2.06);
    expect(odd({ mercado: 'ambas' }).sort()).toEqual([1.68, 2.12]);
  });
  it('totais de gols com o rótulo lido depois da curva do tema claro', () => {
    expect(odd({ mercado: 'total', lado: 'over', linha: 2.5 })).toEqual([1.78]);
    expect(odd({ mercado: 'total', lado: 'under', linha: 1.5 })).toEqual([3.95]);
  });
  it('"+05" / "-05" são ±0.5 no handicap', () => {
    expect(odd({ mercado: 'cartoes_ah', lado: 'casa', linha: 0.5 })).toEqual([1.9]);
    expect(odd({ mercado: 'AH', periodo: '1T', lado: 'casa', linha: -0.5 })).toEqual([2.6]);
  });
  it('nenhuma linha de handicap absurda', () => {
    expect(
      ls.filter((l) => l.linha !== undefined && Math.abs(l.linha) > 4 && l.mercado === 'AH'),
    ).toEqual([]);
  });
});
