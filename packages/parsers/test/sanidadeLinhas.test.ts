import type { LinhaOdd } from '@pe/engine';
import { describe, expect, it } from 'vitest';
import { checarSanidade } from '../src';

const linha = (mercado: string, lado: string, n: number, odd: number, time?: string) =>
  ({
    casa: 'PlayOn',
    mercado,
    lado,
    linha: n,
    odd,
    periodo: 'FT',
    time,
    horarioColeta: '2026-11-09T13:38:00-03:00',
  }) as LinhaOdd;
const erros = (ls: LinhaOdd[]) =>
  checarSanidade(ls)
    .filter((p) => p.nivel === 'erro')
    .map((p) => p.indice);

describe('linha que não existe (PlayOn, Sabadell × Real Sociedad B)', () => {
  it('2,15 e +1,71 são outros números lidos como linha', () => {
    expect(erros([linha('total', 'over', 2.15, 2.19)])).toEqual([0]);
    expect(erros([linha('AH', 'casa', 1.71, 2.5)])).toEqual([0]);
  });
  it('linhas de 0,25 em 0,25 passam', () => {
    for (const n of [0.5, 2.25, 2.5, 2.75, 3])
      expect(erros([linha('total', 'over', n, 1.9)])).toEqual([]);
    expect(erros([linha('AH', 'casa', -0.25, 1.9)])).toEqual([]);
  });
});

describe('escada de linhas', () => {
  const time = (lado: string, n: number, odd: number) =>
    linha('total_time', lado, n, odd, 'Sabadell');
  it('"menos de 5" a 4,41 sai; as coerentes ficam', () => {
    const ls = [
      time('under', 0.5, 3),
      time('under', 1.5, 1.7),
      time('under', 2.5, 1.22),
      time('under', 5, 4.41),
    ];
    expect(erros(ls)).toEqual([3]);
  });
  it('com duas linhas contraditórias, as duas saem', () => {
    expect(erros([time('under', 2.5, 1.22), time('under', 5, 4.41)]).sort()).toEqual([0, 1]);
  });
  it('vale para mais de também', () => {
    const ls = [
      linha('total', 'over', 1.5, 1.3),
      linha('total', 'over', 2.5, 1.9),
      linha('total', 'over', 3.5, 1.05),
    ];
    expect(erros(ls)).toEqual([2]);
  });
  it('inversão pequena é só alerta', () => {
    const ls = [linha('total', 'under', 2.5, 1.9), linha('total', 'under', 3, 1.95)];
    expect(erros(ls)).toEqual([]);
    expect(checarSanidade(ls).some((p) => p.mensagem.startsWith('linhas fora de ordem'))).toBe(
      true,
    );
  });
});
