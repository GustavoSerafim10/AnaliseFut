import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectarTituloMercado, parse1win, reconhecerTime } from '../src';

// Milan × Ferencváros (05/11/2026): a 1win escreve "Milão"; sem reconhecer, "Milão total" virava
// total do JOGO (2.5 @ 1.74/2.08 contra 2.61/1.49) e o lado do Milan sumia dos handicaps
const fx = (n: string) =>
  readFileSync(new URL(`./fixtures-reais/1win-milan-${n}.txt`, import.meta.url), 'utf8');
const jogo = { casa: 'Milan', fora: 'Ferencváros' };
const ctx = { jogo, casa: '1win', data: '2026-11-05' };
const ler = (n: string) => parse1win(fx(n), ctx).linhas;

describe('nome aportuguesado', () => {
  it('Milão = Milan, sem confundir com o adversário', () => {
    expect(reconhecerTime('Milão', jogo)).toBe('casa');
    expect(reconhecerTime('Ferencvárosi Torna Club', jogo)).toBe('fora');
  });

  it('"Milão total" e irmãos são do time, em gols, escanteios e cartões', () => {
    const gols = ler('totais-times').filter((l) => l.mercado === 'total_time' && l.time === 'casa');
    expect(gols.find((l) => l.linha === 2.5 && l.lado === 'under')?.odd).toBe(1.74);
    expect(ler('totais-times').some((l) => l.mercado === 'total')).toBe(false);
    expect(
      ler('escanteios').find((l) => l.mercado === 'escanteios_time' && l.time === 'casa')?.linha,
    ).toBe(5.5);
    expect(ler('escanteios').some((l) => l.mercado === 'escanteios_total' && l.linha === 5.5)).toBe(
      false,
    );
    expect(
      ler('cartoes').find((l) => l.mercado === 'cartoes_time' && l.time === 'casa')?.linha,
    ).toBe(1.5);
  });

  it('handicap traz os dois lados', () => {
    const ah = ler('handicap').filter((l) => l.mercado === 'AH');
    expect(ah.find((l) => l.lado === 'casa' && l.linha === -1.5)?.odd).toBe(1.88);
    expect(ah.find((l) => l.lado === 'fora' && l.linha === 1.5)?.odd).toBe(1.93);
  });

  it('total de gols do jogo vem do quadro "Totais", intacto', () => {
    const t = ler('principal').filter((l) => l.mercado === 'total' && l.linha === 2.5);
    expect(t.map((l) => [l.lado, l.odd]).sort()).toEqual([
      ['over', 1.49],
      ['under', 2.61],
    ]);
  });
});

describe('"<nome desconhecido> total" nunca é total do jogo', () => {
  const j = { casa: 'Milan', fora: 'Ferencváros' };
  it.each(['Lazio total', 'Escanteios. Lazio total', 'Cartões amarelos. Lazio total A'])(
    '%s',
    (t) => expect(detectarTituloMercado(t, j)?.mercado).toBe('outro'),
  );
  it.each([
    ['Totais', 'total'],
    ['Total de gols', 'total'],
    ['Escanteios. Total', 'escanteios_total'],
    ['Total. Cartões amarelos', 'cartoes_total'],
  ])('%s continua %s', (t, m) => expect(detectarTituloMercado(t, j)?.mercado).toBe(m));
});
