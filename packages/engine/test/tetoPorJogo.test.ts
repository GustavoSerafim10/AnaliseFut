/** Teto agregado de 2% por jogo no motor: a aposta nova recebe só o saldo, e sempre vale o menor limite. */
import { describe, expect, it } from 'vitest';
import { melhoresEntradas, type PedidoEntradas } from '../src/entradas';
import { autorizarStake } from '../src/kelly';
import { folgaDoJogo, POLITICA_EXPOSICAO } from '../src/politicaExposicao';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, type ApoioModelo } from '../src/v4';

const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2099-10-26T20:00:00-03:00' };
const AGORA = '2099-10-26T16:00:00-03:00';
const par = (casa: string, o: number, u: number, linha = 2.5): LinhaOdd[] =>
  (['over', 'under'] as const).map((lado, i) => ({
    casa,
    mercado: 'total' as TipoMercado,
    lado,
    odd: i === 0 ? o : u,
    linha,
    periodo: 'FT',
    horarioColeta: AGORA,
  }));
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
const v4 = (t?: object) =>
  analisarV4({
    jogo: JOGO,
    agora: AGORA,
    ligaPrincipal: true,
    banca: 1000,
    linhas: [...par('Pinnacle', 1.95, 1.95), ...par('1win', 2.1, 1.72)],
    travas: t ? (t as never) : undefined,
  });

describe('folgaDoJogo', () => {
  it('teto de 2% menos o comprometido', () => {
    expect(POLITICA_EXPOSICAO.tetoPorJogo).toBe(0.02);
    expect(folgaDoJogo()).toBe(0.02);
    expect(folgaDoJogo(0)).toBe(0.02);
    expect(folgaDoJogo(0.005)).toBeCloseTo(0.015, 12);
    expect(folgaDoJogo(0.02)).toBe(0);
    expect(folgaDoJogo(0.05)).toBe(0);
  });
  it('valor inválido conta como jogo cheio (nunca autoriza por engano)', () => {
    for (const x of [NaN, Infinity, -0.01]) expect(folgaDoJogo(x)).toBe(0);
  });
});

describe('autorizarStake com saldo do jogo', () => {
  const base = { p: 0.9, odd: 2.5, fracaoKelly: 0.25 };
  it('recebe só o saldo e registra que o jogo limitou', () => {
    const s = autorizarStake({ ...base, folgaJogo: 0.007 });
    expect(s.fracaoBanca).toBe(0.007);
    expect(s.limites).toEqual(['teto', 'jogo']);
  });
  it('sem saldo, stake zero', () => {
    expect(autorizarStake({ ...base, folgaJogo: 0 }).fracaoBanca).toBe(0);
  });
  it('o saldo do jogo nunca aumenta a stake (saldo grande não muda nada)', () => {
    const livre = autorizarStake(base);
    const folgado = autorizarStake({ ...base, folgaJogo: 0.5 });
    expect(folgado.fracaoBanca).toBe(livre.fracaoBanca);
    expect(folgado.limites).toEqual(livre.limites);
  });
  it('a regra mais restritiva prevalece entre kelly, teto, jogo e dia', () => {
    const s = autorizarStake({ ...base, teto: 0.01, folgaJogo: 0.008, folgaDia: 0.003 });
    expect(s.fracaoBanca).toBe(0.003);
    expect(s.limites).toEqual(['teto', 'jogo', 'dia']);
    expect(
      autorizarStake({ ...base, teto: 0.01, folgaJogo: 0.002, folgaDia: 0.05 }).fracaoBanca,
    ).toBe(0.002);
  });
  it('saldo inválido zera com motivo', () => {
    const s = autorizarStake({ ...base, folgaJogo: NaN });
    expect(s.fracaoBanca).toBe(0);
    expect(s.motivo).toContain('folga do jogo');
  });
});

describe('V4: saldo do jogo', () => {
  it('sem exposição no jogo, nada muda', () => {
    const sem = v4(travas());
    const zero = v4(travas({ expostoJogo: 0 }));
    expect(zero.decisao).toBe(sem.decisao);
    expect(zero.melhor!.stake!.fracaoBanca).toBe(sem.melhor!.stake!.fracaoBanca);
    expect(zero.melhor!.stake!.ajustes).toEqual(sem.melhor!.stake!.ajustes);
  });

  it('exposição parcial: a aposta recebe só o saldo e o ajuste explica', () => {
    const livre = v4(travas()).melhor!.stake!.fracaoBanca; // ~1,1%
    const r = v4(travas({ expostoJogo: 0.015 }));
    expect(r.decisao).toBe('BET');
    const st = r.melhor!.stake!;
    expect(st.fracaoBanca).toBeCloseTo(0.005, 12);
    expect(st.fracaoBanca).toBeLessThan(livre);
    expect(st.ajustes.join(' ')).toContain('saldo do jogo');
  });

  it('jogo cheio (2% ou mais já comprometidos): NO_BET sem stake e com o motivo', () => {
    for (const exposto of [0.02, 0.03, 0.5]) {
      const r = v4(travas({ expostoJogo: exposto }));
      expect(r.decisao).toBe('NO_BET');
      expect(r.melhor?.stake ?? null).toBeNull();
      expect(r.motivos.join(' ')).toContain('neste jogo já comprometido');
    }
  });

  it('o saldo do jogo não altera preço, P_true nem EV', () => {
    const a = v4(travas());
    const b = v4(travas({ expostoJogo: 0.02 }));
    expect(b.avaliadas.map((x) => [x.chave, x.ev, x.pTrue])).toEqual(
      a.avaliadas.map((x) => [x.chave, x.ev, x.pTrue]),
    );
  });

  it('exposição do jogo inválida (NaN) não autoriza: NO_BET', () => {
    expect(v4(travas({ expostoJogo: NaN })).decisao).toBe('NO_BET');
  });
});

describe('lista de entradas: saldo do jogo', () => {
  const apoio: ApoioModelo = { lambdas: { casa: 2.0, fora: 0.8 }, dq: 'A', w: 0.5, jogosMin: 10 };
  const pedido = (t?: object): PedidoEntradas => ({
    jogo: JOGO,
    linhas: [...par('1win', 1.4, 3.0, 1.5)],
    apoio,
    agora: AGORA,
    travas: t ? (t as never) : undefined,
  });

  it('sem exposição no jogo, a lista é a mesma', () => {
    const a = melhoresEntradas(pedido(travas()));
    const b = melhoresEntradas(pedido(travas({ expostoJogo: 0 })));
    expect(b.entradas.map((e) => e.stake)).toEqual(a.entradas.map((e) => e.stake));
  });

  it('jogo cheio: stake zero em todas, com o limite "jogo" e o aviso', () => {
    const r = melhoresEntradas(pedido(travas({ expostoJogo: 0.02 })));
    expect(r.entradas.length).toBeGreaterThan(0);
    for (const e of r.entradas) {
      expect(e.stake).toBe(0);
      expect(e.limiteStake).toBe('jogo');
    }
    expect(r.bloqueio).toContain('neste jogo já atingido');
  });

  it('exposição parcial limita a stake ao saldo', () => {
    const livre = melhoresEntradas(pedido(travas())).entradas[0].stake;
    const e = melhoresEntradas(pedido(travas({ expostoJogo: 0.0185 }))).entradas[0];
    expect(e.stake).toBeLessThanOrEqual(0.0015 + 1e-12);
    expect(e.stake).toBeLessThan(livre);
    expect(e.limiteStake).toBe('jogo');
  });
});
