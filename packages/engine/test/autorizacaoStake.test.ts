/** Etapa 3A: toda exposição passa por autorizarStake; a lista de entradas usa min(1%, Kelly). */
import { describe, expect, it } from 'vitest';
import { melhoresEntradas, STAKE_ENTRADA, type PedidoEntradas } from '../src/entradas';
import { autorizarStake, kellyCheio } from '../src/kelly';
import type { LinhaOdd } from '../src/tipos';
import type { ApoioModelo } from '../src/v4';

const H = '2099-10-26T16:00:00-03:00';
const ou = (casa: string, linha: number, over: number, under: number): LinhaOdd[] =>
  (['over', 'under'] as const).map((lado, i) => ({
    casa,
    mercado: 'total' as const,
    lado,
    linha,
    odd: i ? under : over,
    periodo: 'FT' as const,
    horarioColeta: H,
  }));
const apoio = (m: Partial<ApoioModelo> = {}): ApoioModelo => ({
  lambdas: { casa: 2.0, fora: 0.8 },
  dq: 'A',
  w: 0.5,
  jogosMin: 10,
  ...m,
});
const pedido = (m: Partial<PedidoEntradas> = {}): PedidoEntradas => ({
  jogo: { casa: 'Casa', fora: 'Fora', inicio: '2099-10-26T20:00:00-03:00' },
  linhas: ou('1win', 1.5, 1.4, 3.0),
  apoio: apoio(),
  agora: H,
  ...m,
});
const travas = (extra: object = {}) => ({
  bancaInicial: 1000,
  bancaAtual: 1000,
  pico: 1000,
  drawdown: 0,
  fatorKelly: 1,
  pausadoAte: null,
  perdasHoje: 0,
  diaEncerrado: false,
  expostoHoje: 0,
  motivos: [],
  ...extra,
});

describe('autorizarStake: regra mais restritiva vence', () => {
  const base = { p: 0.85, odd: 1.4, fracaoKelly: 0.25 };
  it('Kelly fracionado, teto específico, teto geral de 2% e o que resta do dia', () => {
    expect(kellyCheio(0.85, 1.4) * 0.25).toBeGreaterThan(0.02);
    expect(autorizarStake({ ...base, teto: 0.5 }).fracaoBanca).toBe(0.02); // teto geral de 2%
    expect(autorizarStake({ ...base, teto: 0.01 }).fracaoBanca).toBe(0.01); // teto da lista
    expect(autorizarStake({ ...base, teto: 0.01 }).limites).toEqual(['teto']);
    const dia = autorizarStake({ ...base, teto: 0.01, folgaDia: 0.004 });
    expect(dia.fracaoBanca).toBe(0.004);
    expect(dia.limites).toEqual(['teto', 'dia']);
    const kelly = autorizarStake({ p: 0.53, odd: 2, fracaoKelly: 0.125, teto: 0.01 });
    expect(kelly.fracaoBanca).toBeCloseTo(kellyCheio(0.53, 2) * 0.125, 12);
    expect(kelly.limites).toEqual([]);
  });

  it('as reduções (filtro, drawdown) só diminuem; valor acima de 1 não aumenta', () => {
    const a = autorizarStake({ p: 0.53, odd: 2, fracaoKelly: 0.25 });
    const b = autorizarStake({ p: 0.53, odd: 2, fracaoKelly: 0.25, reducoes: [0.5, 0.5] });
    const c = autorizarStake({ p: 0.53, odd: 2, fracaoKelly: 0.25, reducoes: [3] });
    expect(b.fracaoBanca).toBeCloseTo(a.fracaoBanca / 4, 12);
    expect(c.fracaoBanca).toBe(a.fracaoBanca);
  });

  it('DQ D e E: exposição zero e motivo, mesmo com vantagem enorme e sem nenhum teto', () => {
    for (const dq of ['D', 'E'] as const) {
      const s = autorizarStake({ p: 0.9, odd: 3, fracaoKelly: 0.25, dq, banca: 1000 });
      expect(s.autorizada).toBe(false);
      expect(s.fracaoBanca).toBe(0);
      expect(s.valor).toBe(0);
      expect(s.motivo).toContain(`DQ ${dq}`);
    }
    for (const dq of ['A', 'B', 'C'] as const)
      expect(autorizarStake({ p: 0.9, odd: 3, fracaoKelly: 0.25, dq }).autorizada).toBe(true);
  });

  it('sem folga no dia, a stake é zero', () => {
    expect(autorizarStake({ ...base, folgaDia: 0 }).fracaoBanca).toBe(0);
    expect(autorizarStake({ ...base, folgaDia: -0.01 }).fracaoBanca).toBe(0);
  });
});

describe('lista de entradas: stake = min(1%, Kelly fracionado)', () => {
  it('nunca passa de 1% e é a própria stake do Kelly quando ele é menor', () => {
    const r = melhoresEntradas(pedido({ travas: travas() }));
    expect(r.entradas.length).toBeGreaterThan(0);
    for (const e of r.entradas) {
      expect(e.stake).toBeLessThanOrEqual(STAKE_ENTRADA);
      expect(e.stake).toBeLessThanOrEqual(e.stakeKelly + 1e-15);
      expect(e.limiteStake).toBe(e.stake < STAKE_ENTRADA ? 'kelly' : 'teto');
    }
  });

  it('a fração é 1/4 ou 1/8 do Kelly cheio da própria chance e odd (mesma função do motor)', () => {
    const r = melhoresEntradas(pedido());
    for (const e of r.entradas) {
      const razao = e.stakeKelly / kellyCheio(e.chance, e.odd);
      expect([0.25, 0.125].some((f) => Math.abs(razao - f) < 1e-9)).toBe(true);
    }
  });

  it('escalação incerta derruba a fração para 1/8 (nunca aumenta a stake)', () => {
    const normal = melhoresEntradas(pedido()).entradas[0];
    const incerta = melhoresEntradas(pedido({ escalacaoIncerta: true })).entradas[0];
    expect(incerta.stake).toBeLessThanOrEqual(normal.stake);
    expect(incerta.stakeKelly / kellyCheio(incerta.chance, incerta.odd)).toBeCloseTo(0.125, 9);
  });

  it('DQ C usa 1/8', () => {
    const c = melhoresEntradas(pedido({ apoio: apoio({ dq: 'C' }) })).entradas[0];
    expect(c.stakeKelly / kellyCheio(c.chance, c.odd)).toBeCloseTo(0.125, 9);
  });

  it('DQ D e E não geram entrada nem stake', () => {
    for (const dq of ['D', 'E'] as const) {
      const r = melhoresEntradas(pedido({ apoio: apoio({ dq, w: dq === 'D' ? 0.2 : null }) }));
      expect(r.entradas).toEqual([]);
      expect(r.status).toBe('dados_fracos');
    }
  });

  it('drawdown reduz o teto da lista e o Kelly; o dia quase cheio limita pelo que resta', () => {
    const normal = melhoresEntradas(pedido({ travas: travas() })).entradas[0];
    const dd = melhoresEntradas(pedido({ travas: travas({ fatorKelly: 0.5 }) })).entradas[0];
    expect(dd.stake).toBeLessThanOrEqual(normal.stake / 2 + 1e-15);
    const dia = melhoresEntradas(pedido({ travas: travas({ expostoHoje: 0.058 }) })).entradas[0];
    expect(dia.stake).toBeLessThanOrEqual(0.002 + 1e-12);
    expect(dia.limiteStake).toBe('dia');
  });

  it('valor em R$ acompanha a banca', () => {
    const e = melhoresEntradas(pedido({ banca: 2000 })).entradas[0];
    expect(e.stakeValor).toBe(Math.round(2000 * e.stake * 100) / 100);
  });
});
