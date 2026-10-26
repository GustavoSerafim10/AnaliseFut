import { describe, expect, it } from 'vitest';
import {
  matrizPlacares,
  placaresMaisProvaveis,
  poissonPmf,
  probabilidades1X2,
} from '../src/poisson';

const soma = (m: number[][]) => m.flat().reduce((s, p) => s + p, 0);

describe('poisson + Dixon-Coles', () => {
  it('pmf de Poisson soma 1', () => {
    let s = 0;
    for (let k = 0; k < 40; k++) s += poissonPmf(k, 2.7);
    expect(s).toBeCloseTo(1, 10);
    expect(poissonPmf(0, 1.5)).toBeCloseTo(Math.exp(-1.5), 12);
  });

  it('matriz normalizada', () => {
    expect(soma(matrizPlacares(2.93, 0.85))).toBeCloseTo(1, 12);
  });

  it('ρ = 0 reproduz Poisson independente', () => {
    const m = matrizPlacares(1.4, 1.1, 0, 15);
    expect(m[2][1]).toBeCloseTo(poissonPmf(2, 1.4) * poissonPmf(1, 1.1), 8);
  });

  it('ρ negativo sobe 0-0 e 1-1 e desce 1-0 e 0-1', () => {
    const dc = matrizPlacares(1.4, 1.1, -0.08);
    const ind = matrizPlacares(1.4, 1.1, 0);
    expect(dc[0][0]).toBeGreaterThan(ind[0][0]);
    expect(dc[1][1]).toBeGreaterThan(ind[1][1]);
    expect(dc[1][0]).toBeLessThan(ind[1][0]);
    expect(dc[0][1]).toBeLessThan(ind[0][1]);
  });

  it('placares mais prováveis em ordem', () => {
    const top = placaresMaisProvaveis(matrizPlacares(1.2, 1.0), 3);
    expect(top).toHaveLength(3);
    expect(top[0].p).toBeGreaterThanOrEqual(top[1].p);
    expect(top[1].p).toBeGreaterThanOrEqual(top[2].p);
  });

  // Casos do lote de 21/10/2026: 1X2 da matriz do λ_market ≈ tabela.
  // Tolerância 1,5 pp (não 1 pp): a coluna "1X2 sem margem" da tabela é um arredondamento
  // que nem o de-vig das odds reais da Villa reproduz a ±1 pp (proporcional 76,8/14,7/8,5;
  // potência 79,3/13,3/7,4). Com as odds 1X2 dos outros jogos dá para apertar para 1 pp.
  const TOL_PP = 1.5;
  const casos: [string, number, number, [number, number, number]][] = [
    ['Inter × Shakhtar', 2.93, 0.85, [78, 14, 8]],
    ['Aston Villa × Viking', 3.0, 0.96, [78, 14, 8]],
    ['Betis × Feyenoord', 2.36, 1.36, [58, 21, 21]],
    ['Sporting × LASK', 2.8, 0.92, [77, 14, 9]],
    ['Brugge × Lens', 2.22, 1.56, [51, 22, 27]],
  ];
  it.each(casos)('%s: 1X2 da matriz do λ_market ≈ tabela', (_, lc, lf, [c, e, f]) => {
    const p = probabilidades1X2(matrizPlacares(lc, lf));
    expect(Math.abs(p.casa * 100 - c)).toBeLessThanOrEqual(TOL_PP);
    expect(Math.abs(p.empate * 100 - e)).toBeLessThanOrEqual(TOL_PP);
    expect(Math.abs(p.fora * 100 - f)).toBeLessThanOrEqual(TOL_PP);
  });
});
