import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dataDoPrint, parse1winVarios } from '../src';

// CasaDeApostas, Toulouse × Strasbourg (06/11/2026): OCR dos prints reais do celular; odds conferidas no print
const textos = readFileSync(
  new URL('./fixtures-reais/casadeapostas-toulouse.txt', import.meta.url),
  'utf8',
)
  .split(/^===== .* =====$/m)
  .filter((t) => t.trim());
const jogo = { casa: 'Toulouse', fora: 'Strasbourg' };
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

describe('CasaDeApostas: mercados com modelo', () => {
  it('1X2, inclusive a odd sem vírgula do mandante ("Toulouse FC 211")', () => {
    expect([odd('1X2', '1'), odd('1X2', 'X'), odd('1X2', '2')]).toEqual([[2.11], [3.77], [3.21]]);
  });
  it('1X2 do 1º tempo não se mistura com o do jogo', () => {
    expect(odd('1X2', '1', undefined, undefined, '1T')).toEqual([2.57]);
    expect(odd('1X2', 'X', undefined, undefined, '1T')).toEqual([2.43]);
    expect(odd('1X2', '2', undefined, undefined, '1T')).toEqual([3.57]);
  });
  it('dupla chance, ambas e empate devolve', () => {
    expect([odd('DC', '1X'), odd('DC', '12'), odd('DC', 'X2')]).toEqual([[1.35], [1.27], [1.7]]);
    expect([odd('ambas', 'sim'), odd('ambas', 'nao')]).toEqual([[1.5], [2.53]]);
    expect([odd('DNB', '1'), odd('DNB', '2')]).toEqual([[1.56], [2.33]]);
  });
  it('gols, em todas as linhas', () => {
    expect(odd('total', 'over', 0.5)).toEqual([1.03]);
    expect(odd('total', 'under', 0.5)).toEqual([13.1]);
    expect(odd('total', 'over', 1.5)).toEqual([1.17]);
    expect(odd('total', 'under', 1.5)).toEqual([5.07]);
    expect(odd('total', 'over', 2.5)).toEqual([1.56]);
    expect(odd('total', 'under', 2.5)).toEqual([2.46]);
    expect(odd('total', 'over', 3.5)).toEqual([2.34]);
    expect(odd('total', 'under', 3.5)).toEqual([1.6]);
    expect(odd('total', 'over', 4.5)).toEqual([4.06]);
    expect(odd('total', 'under', 4.5)).toEqual([1.24]);
    expect(odd('total', 'over', 5.5)).toEqual([7.4]);
    expect(odd('total', 'under', 5.5)).toEqual([1.09]);
  });
  it('handicap asiático com a linha entre parênteses', () => {
    expect(odd('AH', 'casa', -1.5)).toEqual([3.57]);
    expect(odd('AH', 'fora', 1.5)).toEqual([1.28]);
    expect(odd('AH', 'casa', -0.5)).toEqual([2.06]);
    expect(odd('AH', 'fora', 0.5)).toEqual([1.74]);
    expect(odd('AH', 'casa', 0.5)).toEqual([1.37]);
    expect(odd('AH', 'fora', -0.5)).toEqual([3.05]);
    expect(odd('AH', 'casa', 1.5)).toEqual([1.12]);
    expect(odd('AH', 'fora', -1.5)).toEqual([6]);
  });
  it('próximo gol antes do jogo é o primeiro gol', () => {
    expect(odd('primeiro_gol', 'casa')).toEqual([1.75]);
    expect(odd('primeiro_gol', 'nenhum')).toEqual([19.2]);
    expect(odd('primeiro_gol', 'fora')).toEqual([2.18]);
  });
  it('escanteios: resultado, total, handicap e de cada time', () => {
    expect([
      odd('escanteios_1x2', '1'),
      odd('escanteios_1x2', 'X'),
      odd('escanteios_1x2', '2'),
    ]).toEqual([[1.63], [7.7], [2.65]]);
    expect(odd('escanteios_total', 'over', 7.5)).toEqual([1.44]);
    expect(odd('escanteios_total', 'under', 7.5)).toEqual([2.52]);
    expect(odd('escanteios_total', 'over', 8.5)).toEqual([1.75]);
    expect(odd('escanteios_total', 'under', 8.5)).toEqual([1.93]);
    expect(odd('escanteios_total', 'over', 9.5)).toEqual([2.2]);
    expect(odd('escanteios_total', 'under', 9.5)).toEqual([1.57]);
    expect(odd('escanteios_ah', 'casa', -0.5)).toEqual([1.63]);
    expect(odd('escanteios_ah', 'fora', 2.5)).toEqual([1.41]);
    expect(odd('escanteios_time', 'over', 4.5, 'casa')).toEqual([1.73]);
    expect(odd('escanteios_time', 'under', 4.5, 'casa')).toEqual([1.99]);
    expect(odd('escanteios_time', 'over', 3.5, 'fora')).toEqual([1.76]);
    expect(odd('escanteios_time', 'under', 3.5, 'fora')).toEqual([1.96]);
  });
  it('vencer sem sofrer: o time vem do título', () => {
    expect(odd('vencer_sem_sofrer', 'sim', undefined, 'casa')).toEqual([4.16]);
    expect(odd('vencer_sem_sofrer', 'nao', undefined, 'casa')).toEqual([1.19]);
  });
});

describe('CasaDeApostas: o que não tem modelo fica fora', () => {
  it('nada de handicap 3 vias, pagamento antecipado ou cartões virando mercado com modelo', () => {
    expect(r.linhas.some((l) => [7.6, 16.9, 15.2, 1.98, 2.9].includes(l.odd))).toBe(false);
    expect(r.linhas.some((l) => l.mercado === 'AH' && !Number.isFinite(l.linha))).toBe(false);
    // cartões: 2,18 só no 1º gol do visitante; 2,43 só no empate do 1º tempo
    expect(r.linhas.filter((l) => l.odd === 2.18).every((l) => l.mercado === 'primeiro_gol')).toBe(
      true,
    );
    expect(r.linhas.filter((l) => l.odd === 2.43).every((l) => l.periodo === '1T')).toBe(true);
  });
  it('vencer um dos tempos e sem sofrer gols não herdam o mercado de cima', () => {
    expect(r.linhas.some((l) => [5.31, 7.9, 1.52, 3.51].includes(l.odd))).toBe(false);
  });
});

describe('data do jogo no print', () => {
  it('lê "06/11/26" abaixo da hora', () => {
    expect(dataDoPrint(textos[0])).toBe('2026-11-06');
    expect(dataDoPrint(textos[1])).toBeNull();
  });
});
