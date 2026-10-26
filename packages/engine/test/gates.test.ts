import { describe, expect, it } from 'vitest';
import { ajustarLambdaModelo } from '../src/ajustesLambda';
import { blend, evMinimo, pesoModelo, priceGate } from '../src/gates';
import { calcularStake, fracaoKelly, kellyCheio, limitarLote } from '../src/kelly';
import { calcularLambdaModelo, classificarDesfalque, pesoAmostra } from '../src/lambdaModelo';
import { criarLiquidador } from '../src/mercados';
import { analisarSensibilidade } from '../src/sensibilidade';

describe('blend (seção 12)', () => {
  it('w por DQ, −0,10 em mercado muito líquido, nível 3 até 0,30', () => {
    expect(pesoModelo('A')).toBe(0.5);
    expect(pesoModelo('B')).toBe(0.4);
    expect(pesoModelo('C')).toBe(0.3);
    expect(pesoModelo('D')).toBe(0.2);
    expect(pesoModelo('E')).toBeNull();
    expect(pesoModelo('A', { mercadoMuitoLiquido: true })).toBe(0.4);
    expect(pesoModelo('A', { nivel3: true })).toBe(0.3);
  });
  it('P_final = w·P_modelo + (1−w)·P_market', () => {
    expect(blend(0.6, 0.5, 0.3)).toBeCloseTo(0.53, 12);
  });
});

describe('edge gate (seção 14)', () => {
  it('A 2% · B 3% · C 4% · D/E sem BET', () => {
    expect(evMinimo('A')).toBeCloseTo(0.02);
    expect(evMinimo('B')).toBeCloseTo(0.03);
    expect(evMinimo('C')).toBeCloseTo(0.04);
    expect(evMinimo('D')).toBeNull();
    expect(evMinimo('E')).toBeNull();
  });
  it('+1 pp por agravante, odd > 8 +3 pp', () => {
    expect(evMinimo('B', { escalacaoIncerta: true })).toBeCloseTo(0.04);
    expect(evMinimo('B', { odd: 9 })).toBeCloseTo(0.06);
    expect(evMinimo('C', { nivel3: true, mercadoPoucoLiquido: true })).toBeCloseTo(0.06);
  });
});

describe('price gate (seção 20)', () => {
  it('odd mínima = (1 + EV_mín) / P_final_inferior', () => {
    const pg = priceGate({ w: 0.4, pModeloInferior: 0.5, pMercado: 0.45, evMinimo: 0.03 });
    expect(pg.pFinalInferior).toBeCloseTo(0.47, 12);
    expect(pg.oddMinima).toBeCloseTo(1.03 / 0.47, 12);
  });
});

describe('Kelly (seção 21)', () => {
  it('f* = (b·p − q) / b', () => {
    expect(kellyCheio(0.55, 2)).toBeCloseTo(0.1, 12);
    expect(kellyCheio(0.4, 2)).toBeLessThan(0);
  });
  it('1/4 só com DQ A/B + ROBUSTA; senão 1/8', () => {
    expect(fracaoKelly('B', 'ROBUSTA')).toBe(0.25);
    expect(fracaoKelly('C', 'ROBUSTA')).toBe(0.125);
    expect(fracaoKelly('A', 'MODERADA')).toBe(0.125);
    expect(fracaoKelly('A', 'ROBUSTA', true)).toBe(0.125);
  });
  it('teto de 2% por aposta e sem edge → 0', () => {
    const s = calcularStake({ p: 0.6, odd: 2.2, dq: 'A', classe: 'ROBUSTA', banca: 1000 });
    expect(s.fracaoBanca).toBe(0.02);
    expect(s.limitadaPeloTeto).toBe(true);
    expect(s.valor).toBe(20);
    expect(calcularStake({ p: 0.4, odd: 2, dq: 'A', classe: 'ROBUSTA' }).fracaoBanca).toBe(0);
  });
  it('lote limitado a 5% da banca', () => {
    const r = limitarLote([0.02, 0.02, 0.02]);
    expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(0.05, 12);
    expect(limitarLote([0.01, 0.02])).toEqual([0.01, 0.02]);
  });
});

describe('sensibilidade (seção 15)', () => {
  const r = criarLiquidador({
    casa: 'x',
    mercado: 'total',
    lado: 'over',
    linha: 2.5,
    odd: 2.3,
    periodo: 'FT',
  });
  if (!r.ok) throw new Error();
  const base = { liq: r.liq, lambdaMercado: null, rho: -0.08, fracao1T: 0.45, w: 0.4 };
  it('vantagem grande → ROBUSTA', () => {
    const s = analisarSensibilidade({
      ...base,
      lambdas: { casa: 1.6, fora: 1.3 },
      pMercado: 0.5,
      odd: 2.3,
    });
    expect(s.classe).toBe('ROBUSTA');
  });
  it('vantagem que some com ajuste pequeno → FRÁGIL', () => {
    const s = analisarSensibilidade({
      ...base,
      lambdas: { casa: 1.5, fora: 1.2 },
      pMercado: 0.5,
      odd: 2.0,
    });
    expect(s.classe).toBe('FRÁGIL');
  });
  it('P_modelo inferior ≤ P_modelo base', () => {
    const s = analisarSensibilidade({
      ...base,
      lambdas: { casa: 1.6, fora: 1.3 },
      pMercado: 0.5,
      odd: 2.3,
    });
    expect(s.pModeloInferior).toBeLessThan(s.cenarios[0].pModelo + 1e-12);
  });
});

describe('λ do modelo (9.2)', () => {
  it('shrinkage n/(n+8)', () => {
    expect(pesoAmostra(8)).toBe(0.5);
    expect(pesoAmostra(12)).toBeCloseTo(0.6);
  });
  it('time médio com prior neutro dá média × mando', () => {
    const medio = { jogos: 10, golsPro: 1.3, golsContra: 1.3, xg: 1.3 };
    const r = calcularLambdaModelo(medio, medio);
    expect(r.lambdas.casa).toBeCloseTo(1.3 * 1.12, 10);
    expect(r.lambdas.fora).toBeCloseTo(1.3 / 1.12, 10);
    expect(r.priorNeutro).toBe(true);
  });
  it('matchup limitado a ±8% e desfalque classificado', () => {
    const medio = { jogos: 10, golsPro: 1.3, golsContra: 1.3 };
    const r = calcularLambdaModelo(medio, medio, {
      ajustes: [{ time: 'casa', tipo: 'matchup', fator: 1.2, descricao: 'teste' }],
    });
    expect(r.lambdas.casa).toBeCloseTo(1.3 * 1.12 * 1.08, 10);
    expect(classificarDesfalque(0.98)).toBe('BAIXO');
    expect(classificarDesfalque(0.95)).toBe('MÉDIO');
    expect(classificarDesfalque(0.9)).toBe('ALTO');
    expect(classificarDesfalque(0.85)).toBe('CRÍTICO');
  });
});

describe('λ_modelo × λ_market (9.4 e 16.3)', () => {
  const mercado = { casa: 2.93, fora: 0.85 };
  it('16.3: adota a supremacia do mercado e mantém o total do modelo', () => {
    const r = ajustarLambdaModelo({ casa: 2.27, fora: 1.46 }, mercado, {
      favoritoLigaMaisForte: true,
    });
    expect(r.lambdas.casa - r.lambdas.fora).toBeCloseTo(2.93 - 0.85, 10);
    expect(r.lambdas.casa + r.lambdas.fora).toBeCloseTo(2.27 + 1.46, 10);
  });
  it('9.4: sem explicação concreta, move até o limite de tolerância', () => {
    const r = ajustarLambdaModelo({ casa: 2.27, fora: 1.46 }, mercado);
    expect(Math.abs(r.lambdas.casa - mercado.casa)).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(Math.abs(r.lambdas.fora - mercado.fora)).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(r.alertas.length).toBeGreaterThan(0);
  });
  it('9.4: com fato concreto, mantém a divergência e registra', () => {
    const r = ajustarLambdaModelo({ casa: 2.27, fora: 1.46 }, mercado, {
      explicacaoDivergencia: 'artilheiro confirmado fora após o preço',
    });
    expect(r.lambdas).toEqual({ casa: 2.27, fora: 1.46 });
    expect(r.ajustes[0]).toContain('fato concreto');
  });
});
