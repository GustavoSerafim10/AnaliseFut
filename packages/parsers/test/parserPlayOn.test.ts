import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerOddsCasa } from '../src';

// PlayOn, Sabadell × Real Sociedad B (09/11/2026). Texto montado a partir dos prints do celular,
// com os erros de OCR vistos na tela do site ("0,5" → "05"); as odds foram conferidas nos prints
const textos = readFileSync(
  new URL('./fixtures-reais/playon-sabadell.txt', import.meta.url),
  'utf8',
)
  .split(/^===== .* =====$/m)
  .filter((t) => t.trim());
const r = lerOddsCasa(textos, {
  jogo: { casa: 'Sabadell', fora: 'Real Sociedad B' },
  casa: 'PlayOn',
  data: '2026-11-09',
});
const odd = (m: string, lado: string, linha?: number, time?: string, periodo = 'FT') =>
  r.linhas
    .filter(
      (l) =>
        l.mercado === m &&
        l.lado === lado &&
        l.linha === linha &&
        l.periodo === periodo &&
        l.time === time,
    )
    .map((l) => l.odd);

describe('PlayOn', () => {
  it('a barra de abas e as Dicas não viram handicap', () => {
    expect(r.linhas.filter((l) => l.mercado === 'AH' && l.linha === 1.71)).toEqual([]);
  });
  it('"0,5" lido como "05" é 0,5, não 5', () => {
    expect(odd('total_time', 'under', 0.5, 'casa')).toEqual([4.41]);
    expect(odd('total_time', 'under', 5, 'casa')).toEqual([]);
    expect(odd('total', 'under', 0.5)).toEqual([9.57]);
  });
  it('resultado, dupla chance e 1º a marcar', () => {
    expect([odd('1X2', '1'), odd('1X2', 'X'), odd('1X2', '2')]).toEqual([[1.71], [3.59], [4.49]]);
    expect([odd('DC', '1X'), odd('DC', '12'), odd('DC', 'X2')]).toEqual([[1.13], [1.23], [2.02]]);
    expect(odd('primeiro_gol', 'nenhum')).toEqual([9.79]);
    expect(odd('1X2', '1', undefined, undefined, '1T')).toEqual([2.3]);
  });
  it('handicap com a linha colada no número do time', () => {
    expect(odd('AH', 'casa', -1)).toEqual([2.22]);
    expect(odd('AH', 'fora', 1)).toEqual([1.56]);
    expect(odd('AH', 'casa', -0.75)).toEqual([1.87]);
    expect(odd('AH', 'fora', 0.25)).toEqual([2.47]);
    expect(odd('AH', 'casa', 0)).toEqual([1.25]);
    expect(odd('AH', 'fora', 0)).toEqual([3.4]);
  });
  it('totais de cada time e do 1º tempo', () => {
    expect(odd('total_time', 'over', 2.5, 'casa')).toEqual([3.66]);
    expect(odd('total_time', 'over', 0.5, 'fora')).toEqual([1.55]);
    expect(odd('total', 'over', 2.75)).toEqual([2.19]);
    expect(odd('total', 'under', 1.25, undefined, '1T')).toEqual([1.51]);
  });
  it('escanteios: a linha vem no selo do título', () => {
    expect(odd('escanteios_total', 'over', 9.5)).toEqual([1.88]);
    expect(odd('escanteios_total', 'under', 4.5, undefined, '1T')).toEqual([1.7]);
    expect(odd('escanteios_time', 'over', 5.5, 'casa')).toEqual([1.83]);
    expect(odd('escanteios_time', 'under', 3.5, 'fora')).toEqual([1.78]);
    expect([odd('escanteios_1x2', '1'), odd('escanteios_1x2', '2')]).toEqual([[1.42], [3.56]]);
  });
  it('mercado combinado e "não sofre gol" não viram Ambas nem total', () => {
    expect(r.linhas.filter((l) => l.mercado === 'ambas')).toEqual([]);
    expect(r.linhas.some((l) => l.odd === 10.64 || (l.odd === 2.23 && l.linha === undefined))).toBe(
      false,
    );
  });
});
