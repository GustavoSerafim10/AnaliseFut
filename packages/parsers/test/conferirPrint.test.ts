import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { conferirPrintEstatisticas, conferirPrintOdds } from '../src';

const D = new URL('./fixtures-reais/', import.meta.url);
const fx = (n: string) => readFileSync(new URL(n, D), 'utf8');
const milan = { jogo: { casa: 'Milan', fora: 'Ferencváros' }, data: '2026-11-05', hora: '14:45' };

describe('print de odds', () => {
  it('prints reais do jogo certo: sem aviso', () => {
    for (const n of readdirSync(D).filter((a) => a.startsWith('1win-milan')))
      expect(conferirPrintOdds(fx(n), { ...milan, oddsLidas: 5 })).toBeNull();
    for (const b of fx('99play-botafogo.txt').split(/^===== .* =====$/m))
      expect(
        conferirPrintOdds(b, {
          jogo: { casa: 'Botafogo-SP', fora: 'Londrina' },
          data: '2026-11-05',
          hora: '19:30',
          oddsLidas: 5,
        }),
      ).toBeNull();
  });
  it('outro dia', () => {
    expect(
      conferirPrintOdds(fx('1win-milan-handicap.txt'), {
        ...milan,
        data: '2026-11-06',
        oddsLidas: 5,
      }),
    ).toMatch(/outro dia \(05\/11\/2026\)/);
  });
  it('outro horário', () => {
    expect(
      conferirPrintOdds(fx('1win-milan-handicap.txt'), { ...milan, hora: '19:30', oddsLidas: 5 }),
    ).toMatch(/às 14:45/);
  });
  it('outros times', () => {
    const texto = 'Resultado do tempo regulamentar\nCorinthians 1.90 Empate 3.40 Santos 4.20';
    expect(conferirPrintOdds(texto, { ...milan, oddsLidas: 3 })).toMatch(/não batem/);
    expect(
      conferirPrintOdds('Corinthians Empate Santos\n1.90 3.40 4.20', { ...milan, oddsLidas: 3 }),
    ).toMatch(/não batem/);
  });
  it('um nome legível do jogo já basta (o outro pode vir com erro de OCR)', () => {
    expect(
      conferirPrintOdds('Milan 1.32 Empate 5.4 Frncvrs 9.6', { ...milan, oddsLidas: 3 }),
    ).toBeNull();
  });
  it('estatística na área de odds', () => {
    expect(conferirPrintOdds('Posse de bola 48.3% 49.3%', { ...milan, oddsLidas: 0 })).toMatch(
      /estatísticas/,
    );
  });
  it('print sem nome nem data: fica quieto', () => {
    expect(
      conferirPrintOdds('Total\nMais de 2,5 1,81 Menos de 2,5 1,81', { ...milan, oddsLidas: 2 }),
    ).toBeNull();
  });
});

describe('print de estatísticas', () => {
  it('odds na área de estatísticas', () => {
    expect(
      conferirPrintEstatisticas(
        'Mais de 1,5 1,14 Menos de 1,5 4,00\nMais de 2,5 1,60 Menos de 2,5 2,00',
      ),
    ).toMatch(/odds/);
  });
  it('estatística real: sem aviso', () => {
    expect(conferirPrintEstatisticas(fx('sofascore-vasco-1.txt'))).toBeNull();
  });
});
