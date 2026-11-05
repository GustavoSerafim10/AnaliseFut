import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectarTituloMercado, parse1winVarios } from '../src';

// 99Play, Botafogo-SP × Londrina (05/11/2026): OCR dos prints reais; odds conferidas no print
const textos = readFileSync(
  new URL('./fixtures-reais/99play-botafogo.txt', import.meta.url),
  'utf8',
)
  .split(/^===== .* =====$/m)
  .filter((t) => t.trim());
const jogo = { casa: 'Botafogo-SP', fora: 'Londrina' };
const r = parse1winVarios(textos, { jogo, casa: '99Play', data: '2026-11-05' });
const odd = (m: string, lado: string, linha?: number, time?: string) =>
  r.linhas
    .filter(
      (l) => l.mercado === m && l.lado === lado && l.linha === linha && (!time || l.time === time),
    )
    .map((l) => l.odd)
    // a mesma linha em dois prints (rolagem) é juntada depois, em juntarLinhas
    .filter((o, i, xs) => xs.indexOf(o) === i);

describe('99Play: mercados com modelo', () => {
  it('1X2, primeiro gol, ambas', () => {
    expect([odd('1X2', '1'), odd('1X2', 'X'), odd('1X2', '2')]).toEqual([[1.57], [3.75], [5.33]]);
    expect(odd('primeiro_gol', 'casa')).toEqual([1.46]);
    expect(odd('primeiro_gol', 'nenhum')).toEqual([11]);
    expect(odd('primeiro_gol', 'fora')).toEqual([2.9]);
    expect([odd('ambas', 'sim'), odd('ambas', 'nao')]).toEqual([[1.88], [1.81]]);
  });
  it('total de gols e handicap', () => {
    expect([odd('total', 'over', 2.5), odd('total', 'under', 2.5)]).toEqual([[1.81], [1.81]]);
    expect(odd('AH', 'casa', -0.75)).toEqual([1.75]);
    expect(odd('AH', 'fora', 0.75)).toEqual([2]);
  });
  it('dupla chance com rótulo cortado e empate anula', () => {
    expect([odd('DC', '1X'), odd('DC', '12'), odd('DC', 'X2')]).toEqual([[1.15], [1.23], [2.08]]);
    expect([odd('DNB', '1'), odd('DNB', '2')]).toEqual([[1.22], [3.8]]);
  });
  it('gols de cada time', () => {
    expect(odd('total_time', 'over', 1.5, 'casa')).toEqual([1.7]);
    expect(odd('total_time', 'under', 1.5, 'casa')).toEqual([1.95]);
    expect(odd('total_time', 'over', 2.5, 'casa')).toEqual([3.1]);
    expect(odd('total_time', 'under', 2.5, 'casa')).toEqual([1.28]);
    expect(odd('total_time', 'over', 0.5, 'fora')).toEqual([1.6]);
    expect(odd('total_time', 'under', 0.5, 'fora')).toEqual([2.1]);
    expect(odd('total_time', 'over', 1.5, 'fora')).toEqual([3.8]);
    expect(odd('total_time', 'under', 1.5, 'fora')).toEqual([1.18]);
  });
  it('escanteios: total e por time, com a linha colada ("Menosde45")', () => {
    expect(odd('escanteios_total', 'over', 10.5)).toEqual([1.66]);
    expect(odd('escanteios_total', 'under', 10.5)).toEqual([2]);
    expect(odd('escanteios_time', 'over', 6.5, 'casa')).toEqual([1.75]);
    expect(odd('escanteios_time', 'under', 6.5, 'casa')).toEqual([1.9]);
    expect(odd('escanteios_time', 'over', 4.5, 'fora')).toEqual([2.1]);
    expect(odd('escanteios_time', 'under', 4.5, 'fora')).toEqual([1.6]);
  });
});

describe('99Play: o que não tem modelo fica fora', () => {
  it('nenhuma linha impossível', () => {
    for (const l of r.linhas) {
      if (l.linha !== undefined) expect(Math.abs(l.linha) % 0.25).toBe(0);
      expect(l.odd).toBeGreaterThan(1);
    }
  });
  it('impedimentos e chutes não viram gols nem total', () => {
    expect(odd('total', 'over', 28.5)).toEqual([]);
    expect(odd('total', 'over', 7.5)).toEqual([]);
    expect(odd('total_time', 'over', 1.5, 'fora')).not.toContain(2.14);
  });
  it('cartão vermelho não vira cartão amarelo', () => {
    expect(r.linhas.filter((l) => l.mercado.startsWith('cartoes'))).toEqual([]);
  });
  it.each([
    'vy Handicap 1x2 El + -',
    'Handicap 1×2',
    'Yr Botafogo SP devolve aposta =',
    '¥¢ Qual equipe vai marcar -',
    'vy Botafogo SP para marcar -',
    'vr Londrina PR total de impedimentos -',
    'Y¢ Botafogo SP total de impedimentos -',
    'sy Totais chutes -',
    'Total de cartões vermelhos',
  ])('%s = sem modelo', (t) => expect(detectarTituloMercado(t, jogo)?.mercado).toBe('outro'));
  it.each([
    ['vv Empate devolve aposta -', 'DNB'],
    ['Yr Total Ho -', 'total'],
    ['vy Handicap nº -', 'AH'],
    ['Yr Botafogo SP total -', 'total_time'],
  ])('%s continua %s', (t, m) => expect(detectarTituloMercado(t, jogo)?.mercado).toBe(m));
});

describe('Jogou: vírgula e linha antes dos rótulos', () => {
  // formato anotado dos prints de 04/11 (texto montado à mão: os prints não ficaram salvos)
  const j = parse1winVarios(
    [
      'Total de gols\n2,5 Mais 1,77 Menos 1,97\nHandicap asiático\n1 -0,25 1,86 2 +0,25 1,87\nTotal de escanteios\n9,5 Mais 1,81 Menos 1,91',
    ],
    { jogo, casa: 'Jogou', data: '2026-11-05' },
  ).linhas.map((l) => [l.mercado, l.linha, l.lado, l.odd]);
  it('as duas colunas, com a linha certa', () => {
    expect(j).toEqual([
      ['total', 2.5, 'over', 1.77],
      ['total', 2.5, 'under', 1.97],
      ['AH', -0.25, 'casa', 1.86],
      ['AH', 0.25, 'fora', 1.87],
      ['escanteios_total', 9.5, 'over', 1.81],
      ['escanteios_total', 9.5, 'under', 1.91],
    ]);
  });
});
