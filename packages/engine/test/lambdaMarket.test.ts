import { describe, expect, it } from 'vitest';
import { ajustarLambdaMercado, observacoesParaLambda } from '../src/lambdaMarket';
import { precificar } from '../src/precificacao';
import { oddsSinteticas, oddsVillaViking } from './helpers';

function fit(linhas: Parameters<typeof precificar>[0]) {
  const r = ajustarLambdaMercado(observacoesParaLambda(precificar(linhas).selecoes));
  if ('erro' in r) throw new Error(r.erro);
  return r;
}

describe('λ_market por mínimos quadrados (9.1)', () => {
  it('recupera o λ de uma casa que precifica pela própria Poisson+DC', () => {
    const r = fit(oddsSinteticas({ casa: 1.85, fora: 1.2 }));
    expect(r.casa).toBeCloseTo(1.85, 1);
    expect(r.fora).toBeCloseTo(1.2, 1);
    expect(Math.abs(r.casa - 1.85)).toBeLessThan(0.05);
    expect(Math.abs(r.fora - 1.2)).toBeLessThan(0.05);
  });

  it('Aston Villa × Viking (odds reais da 1win) → 3,00 × 0,96 (±0,05)', () => {
    const r = fit(oddsVillaViking());
    expect(Math.abs(r.casa - 3.0)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(r.fora - 0.96)).toBeLessThanOrEqual(0.05);
  });

  it('Villa × Viking: linhas do Villa implicam λ diferentes → coerência registrada', () => {
    const r = fit(oddsVillaViking());
    expect(r.coerencia.casa).not.toBeNull();
    expect(r.coerencia.fora).not.toBeNull();
    expect(r.coerencia.casa!.amplitude).toBeGreaterThan(r.coerencia.fora!.amplitude);
  });

  it('lição 1: nunca ajustar com uma linha só', () => {
    const umaLinha = oddsVillaViking().filter((l) => l.mercado === 'total' && l.linha === 2.5);
    const r = ajustarLambdaMercado(observacoesParaLambda(precificar(umaLinha).selecoes));
    expect('erro' in r).toBe(true);
  });
});
