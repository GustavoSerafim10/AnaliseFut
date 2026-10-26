import { describe, expect, it } from 'vitest';
import {
  devigPotencia,
  devigProporcional,
  escolherMetodo,
  margem,
  removerMargem,
} from '../src/devig';

describe('margem e de-vig', () => {
  it('margem = Σ(1/odd) − 1', () => {
    expect(margem([1.9, 1.9])).toBeCloseTo(2 / 1.9 - 1, 12);
    expect(margem([1.24, 6.5, 11.2])).toBeCloseTo(0.0496, 3);
  });

  it('proporcional soma 1 e mantém a razão entre lados', () => {
    const p = devigProporcional([2.09, 1.73]);
    expect(p[0] + p[1]).toBeCloseTo(1, 12);
    expect(p[0] / p[1]).toBeCloseTo(1.73 / 2.09, 12);
  });

  it('potência soma 1', () => {
    const p = devigPotencia([1.24, 6.5, 11.2]);
    expect(p.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
  });

  it('lição 4: potência dá menos ao azarão de odd alta que o proporcional (Viking 11,2)', () => {
    const prop = devigProporcional([1.24, 6.5, 11.2]);
    const pot = devigPotencia([1.24, 6.5, 11.2]);
    expect(pot[2]).toBeLessThan(prop[2]);
    expect(pot[0]).toBeGreaterThan(prop[0]);
    // EV da vitória do Viking a 11,2 só com o mercado: pela potência o "valor" some
    expect(pot[2] * 11.2 - 1).toBeLessThan(prop[2] * 11.2 - 1);
  });

  it('escolhe potência com favorito < 1,40 ou azarão > 8,00', () => {
    expect(escolherMetodo([1.24, 6.5, 11.2])).toBe('potencia');
    expect(escolherMetodo([2.09, 1.73])).toBe('proporcional');
    expect(escolherMetodo([1.45, 8.5])).toBe('potencia');
    expect(removerMargem([2.09, 1.73]).metodo).toBe('proporcional');
  });

  it('rejeita odd ≤ 1 e mercado de um lado só', () => {
    expect(() => devigProporcional([1.0, 2])).toThrow();
    expect(() => devigProporcional([2])).toThrow();
  });
});
