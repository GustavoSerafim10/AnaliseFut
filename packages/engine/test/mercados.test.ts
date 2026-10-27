import { describe, expect, it } from 'vitest';
import { descreverAposta } from '../src/descricao';
import {
  distribuicaoVazia,
  evExato,
  evPorProbEfetiva,
  fracaoEmRisco,
  liquidarLinha,
  probEfetiva,
} from '../src/liquidacao';
import { criarLiquidador, criarModelo, distribuicaoModelo } from '../src/mercados';
import { probabilidades1X2 } from '../src/poisson';
import type { LinhaOdd } from '../src/tipos';

const ah = (diff: number, linha: number) => liquidarLinha(diff, linha);

describe('liquidação de AH (quartos e push)', () => {
  it('AH −0.25: vitória por 1 ganha, empate meia-perda, derrota perde', () => {
    expect(ah(1, -0.25)).toBe(1);
    expect(ah(0, -0.25)).toBe(-0.5);
    expect(ah(-1, -0.25)).toBe(-1);
  });
  it('AH −0.75: vitória por 1 meio-ganho, por 2 ganho', () => {
    expect(ah(1, -0.75)).toBe(0.5);
    expect(ah(2, -0.75)).toBe(1);
    expect(ah(0, -0.75)).toBe(-1);
  });
  it('AH +0.25: empate meio-ganho', () => {
    expect(ah(0, 0.25)).toBe(0.5);
    expect(ah(-1, 0.25)).toBe(-1);
  });
  it('AH −1: vitória por 1 devolve (push)', () => {
    expect(ah(1, -1)).toBe(0);
    expect(ah(2, -1)).toBe(1);
  });
  it('AH +1.25: derrota por 1 meio-ganho (metade +1 devolve, metade +1.5 ganha)', () => {
    expect(ah(-1, 1.25)).toBe(0.5);
    expect(ah(-2, 1.25)).toBe(-1);
  });
  it('AH +0.75: derrota por 1 meia-perda', () => {
    expect(ah(-1, 0.75)).toBe(-0.5);
  });
  it('totais: over 2.25, 2.75 e 3', () => {
    expect(liquidarLinha(2, -2.25)).toBe(-0.5);
    expect(liquidarLinha(3, -2.25)).toBe(1);
    expect(liquidarLinha(3, -2.75)).toBe(0.5);
    expect(liquidarLinha(3, -3)).toBe(0);
    expect(liquidarLinha(-3, 3)).toBe(0); // under 3 com 3 gols
  });
});

describe('EV com push e meios resultados', () => {
  it('EV exato = emRisco × (p_efetiva × odd − 1)', () => {
    const d = {
      ...distribuicaoVazia(),
      ganho: 0.35,
      meioGanho: 0.1,
      push: 0.15,
      meiaPerda: 0.1,
      perda: 0.3,
    };
    const odd = 2.05;
    expect(evPorProbEfetiva(probEfetiva(d), odd, fracaoEmRisco(d))).toBeCloseTo(
      evExato(d, odd),
      12,
    );
  });
});

const L = (o: Partial<LinhaOdd> & Pick<LinhaOdd, 'mercado' | 'lado'>): LinhaOdd => ({
  casa: 'x',
  odd: 2,
  periodo: 'FT',
  ...o,
});

function p(linha: LinhaOdd, lc = 1.6, lf = 1.1): number {
  const r = criarLiquidador(linha);
  if (!r.ok) throw new Error(r.motivo);
  return probEfetiva(distribuicaoModelo(r.liq, criarModelo({ casa: lc, fora: lf })));
}

describe('mercados derivados da matriz', () => {
  const m = criarModelo({ casa: 1.6, fora: 1.1 });
  const x = probabilidades1X2(m.ft);

  it('DC: P(1X) = P(1) + P(X)', () => {
    expect(p(L({ mercado: 'DC', lado: '1X' }))).toBeCloseTo(x.casa + x.empate, 10);
  });
  it('DNB: P(vitória) / (1 − P(empate))', () => {
    expect(p(L({ mercado: 'DNB', lado: '1' }))).toBeCloseTo(x.casa / (1 - x.empate), 10);
  });
  it('AH 0 = DNB e AH −0.5 = vitória', () => {
    expect(p(L({ mercado: 'AH', lado: 'casa', linha: 0 }))).toBeCloseTo(
      x.casa / (1 - x.empate),
      10,
    );
    expect(p(L({ mercado: 'AH', lado: 'casa', linha: -0.5 }))).toBeCloseTo(x.casa, 10);
    expect(p(L({ mercado: 'AH', lado: 'fora', linha: 0.5 }))).toBeCloseTo(x.empate + x.fora, 10);
  });
  it('lados opostos de AH de quarto somam 1 (prob. efetiva)', () => {
    const a = p(L({ mercado: 'AH', lado: 'casa', linha: -0.75 }));
    const b = p(L({ mercado: 'AH', lado: 'fora', linha: 0.75 }));
    expect(a + b).toBeCloseTo(1, 10);
  });
  it('over + under 2.5 = 1; ambas sim + não = 1', () => {
    expect(
      p(L({ mercado: 'total', lado: 'over', linha: 2.5 })) +
        p(L({ mercado: 'total', lado: 'under', linha: 2.5 })),
    ).toBeCloseTo(1, 10);
    expect(
      p(L({ mercado: 'ambas', lado: 'sim' })) + p(L({ mercado: 'ambas', lado: 'nao' })),
    ).toBeCloseTo(1, 10);
  });
  it('gols por time: under 0.5 do visitante = e^(−λ) (Poisson, ρ=0)', () => {
    const r = criarLiquidador(
      L({ mercado: 'total_time', lado: 'under', linha: 0.5, time: 'fora' }),
    );
    if (!r.ok) throw new Error();
    const d = distribuicaoModelo(r.liq, criarModelo({ casa: 1.6, fora: 1.1 }, 0));
    expect(probEfetiva(d)).toBeCloseTo(Math.exp(-1.1), 6);
  });
  it('1º tempo usa 45% dos gols: under 0.5 1T = e^(−0,45·λtotal)', () => {
    expect(p(L({ mercado: 'total', lado: 'under', linha: 0.5, periodo: '1T' }))).toBeCloseTo(
      Math.exp(-0.45 * 2.7),
      6,
    );
  });
  it('intervalo/final: as 9 combinações somam 1', () => {
    let s = 0;
    for (const a of ['1', 'X', '2'])
      for (const b of ['1', 'X', '2']) s += p(L({ mercado: 'intervalo_final', lado: `${a}/${b}` }));
    expect(s).toBeCloseTo(1, 4);
  });
  it('primeiro gol: casa + fora + nenhum = 1', () => {
    const s = ['casa', 'fora', 'nenhum'].reduce(
      (acc, lado) => acc + p(L({ mercado: 'primeiro_gol', lado })),
      0,
    );
    expect(s).toBeCloseTo(1, 10);
  });
  it('nível 3: escanteios têm liquidador; chutes e mercados sem modelo são recusados', () => {
    const r = criarLiquidador(L({ mercado: 'escanteios_total', lado: 'over', linha: 9.5 }));
    expect(r.ok).toBe(true);
    expect(r.nivel).toBe(3);
    const chutes = criarLiquidador(L({ mercado: 'chutes_ah', lado: 'casa', linha: -1.5 }));
    expect(chutes.ok).toBe(false);
    expect(criarLiquidador(L({ mercado: 'outro', lado: 'x' })).ok).toBe(false);
  });
});

describe('texto "a aposta ganha se…" (regra 0.10)', () => {
  const nomes = { casa: 'Roma', fora: 'Slovan' };
  it('azarão +2.5 ganha se o favorito NÃO vence por 3+', () => {
    expect(descreverAposta(L({ mercado: 'AH', lado: 'fora', linha: 2.5 }), nomes)).toBe(
      'Ganha se: Roma NÃO vencer por 3+ gols.',
    );
  });
  it('favorito −1.5 ganha se vencer por 2+', () => {
    expect(descreverAposta(L({ mercado: 'AH', lado: 'casa', linha: -1.5 }), nomes)).toBe(
      'Ganha se: Roma vencer por 2+ gols.',
    );
  });
  it('"Time X menos de 2.5" conta só os gols do time X', () => {
    expect(
      descreverAposta(L({ mercado: 'total_time', lado: 'under', linha: 2.5, time: 'casa' }), nomes),
    ).toContain('conta só os gols de Roma');
  });
});
