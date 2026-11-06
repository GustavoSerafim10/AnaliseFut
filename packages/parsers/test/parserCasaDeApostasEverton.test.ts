import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse1winVarios } from '../src';

// CasaDeApostas, Everton × Coventry (06/11/2026): print cortado com "mais de 3.5 1,65" no topo, sem o
// título, embaixo da aba ESCANTEIOS. É o total do Coventry, e virou total do jogo com EV falso
const textos = readFileSync(
  new URL('./fixtures-reais/casadeapostas-everton.txt', import.meta.url),
  'utf8',
)
  .split(/^===== .* =====$/m)
  .filter((t) => t.trim());
const jogo = { casa: 'Everton', fora: 'Coventry' };
const r = parse1winVarios(textos, { jogo, casa: 'CasaDeApostas', data: '2026-11-06' });
const odd = (m: string, lado: string, linha?: number, time?: string, periodo = 'FT') => [
  ...new Set(
    r.linhas
      .filter(
        (l) =>
          l.mercado === m &&
          l.lado === lado &&
          l.linha === linha &&
          l.periodo === periodo &&
          (!time || l.time === time),
      )
      .map((l) => l.odd),
  ),
];

describe('CasaDeApostas: aba da casa não é título de mercado', () => {
  it('o total de escanteios do jogo não ganha a linha 3.5 do Coventry', () => {
    expect(odd('escanteios_total', 'over', 3.5)).toEqual([]);
    expect(odd('escanteios_total', 'under', 3.5)).toEqual([]);
    expect(odd('escanteios_time', 'over', 3.5, 'fora')).toEqual([1.65]);
    expect(odd('escanteios_time', 'under', 3.5, 'fora')).toEqual([2.1]);
  });
  it('o total de escanteios do jogo fica só com as linhas certas', () => {
    expect(odd('escanteios_total', 'over', 8.5)).toEqual([1.51]);
    expect(odd('escanteios_total', 'under', 8.5)).toEqual([2.35]);
    expect(odd('escanteios_total', 'over', 9.5)).toEqual([1.82]);
    expect(odd('escanteios_total', 'under', 9.5)).toEqual([1.85]);
    expect(odd('escanteios_total', 'over', 10.5)).toEqual([2.29]);
    expect(odd('escanteios_total', 'under', 10.5)).toEqual([1.53]);
    expect(odd('escanteios_total', 'over', 3.5, undefined, '1T')).toEqual([1.43]);
    expect(odd('escanteios_total', 'under', 3.5, undefined, '1T')).toEqual([2.56]);
  });
  it('mercados principais', () => {
    expect([odd('1X2', '1'), odd('1X2', 'X'), odd('1X2', '2')]).toEqual([[1.59], [4.22], [5.38]]);
    expect(odd('total', 'under', 3.5)).toEqual([1.52]);
    expect(odd('total', 'over', 3.5)).toEqual([2.55]);
    expect(odd('total', 'over', 2.5)).toEqual([1.64]);
    expect(odd('total', 'under', 2.5)).toEqual([2.28]);
    expect([odd('ambas', 'sim'), odd('ambas', 'nao')]).toEqual([[1.71], [2.1]]);
    expect([odd('DNB', '1'), odd('DNB', '2')]).toEqual([[1.23], [3.86]]);
    expect([odd('DC', '1X'), odd('DC', '12'), odd('DC', 'X2')]).toEqual([[1.17], [1.23], [2.27]]);
    expect(odd('AH', 'casa', -0.5)).toEqual([1.57]);
    expect(odd('AH', 'fora', 1.5)).toEqual([1.53]);
    expect(odd('primeiro_gol', 'casa')).toEqual([1.49]);
  });
  it('cartões, escala de escanteios e par/ímpar ficam sem modelo', () => {
    const fora = r.linhas.filter((l) => [2.8, 5.01, 2.39, 2.73, 3.07, 7.05].includes(l.odd));
    expect(fora).toEqual([]);
  });
});
