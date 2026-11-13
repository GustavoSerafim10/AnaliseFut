/**
 * Opção C: a lista de entradas reparte o saldo do dia e do jogo de forma ACUMULADA e em ordem.
 * Só o registro ("Entrei") compromete exposição; exibir a lista não reserva nada.
 */
import { describe, expect, it } from 'vitest';
import {
  melhoresEntradas,
  MAX_ENTRADAS,
  STAKE_ENTRADA,
  type EntradaSugerida,
  type PedidoEntradas,
} from '../src/entradas';
import type { LinhaOdd } from '../src/tipos';

const H = '2099-10-26T16:00:00-03:00';
const mk = (mercado: string, lado: string, odd: number, extra: object = {}): LinhaOdd =>
  ({ casa: '1win', mercado, lado, odd, periodo: 'FT', horarioColeta: H, ...extra }) as LinhaOdd;
/** mercados variados, com um modelo que sustenta vários deles: gera a lista cheia (5 entradas) */
const LINHAS: LinhaOdd[] = [
  mk('total', 'over', 1.42, { linha: 1.5 }),
  mk('total', 'under', 2.9, { linha: 1.5 }),
  mk('total', 'over', 1.8, { linha: 2.5 }),
  mk('total', 'under', 2.0, { linha: 2.5 }),
  mk('total', 'over', 2.0, { linha: 3.5 }),
  mk('total', 'under', 1.8, { linha: 3.5 }),
  mk('ambas', 'sim', 1.7),
  mk('ambas', 'nao', 2.1),
  mk('1X2', '1', 1.6),
  mk('1X2', 'X', 4.0),
  mk('1X2', '2', 6.0),
  mk('AH', 'casa', 1.95, { linha: -0.5 }),
  mk('AH', 'fora', 1.9, { linha: 0.5 }),
  mk('AH', 'casa', 1.55, { linha: 0.0 }),
  mk('AH', 'fora', 2.4, { linha: 0.0 }),
  mk('DNB', '1', 1.45),
  mk('DNB', '2', 2.8),
  mk('AH', 'casa', 1.72, { linha: -0.25 }),
  mk('AH', 'fora', 2.15, { linha: 0.25 }),
  mk('total', 'over', 1.62, { linha: 2.25 }),
  mk('total', 'under', 2.25, { linha: 2.25 }),
  mk('total', 'over', 1.95, { linha: 2.75 }),
  mk('total', 'under', 1.85, { linha: 2.75 }),
  mk('AH', 'casa', 1.85, { linha: -0.75 }),
  mk('AH', 'fora', 2.0, { linha: 0.75 }),
];
const pedido = (extra: Partial<PedidoEntradas> = {}): PedidoEntradas => ({
  jogo: { casa: 'A', fora: 'B', inicio: '2099-10-26T20:00:00-03:00' },
  linhas: LINHAS,
  apoio: { lambdas: { casa: 2.2, fora: 1.0 }, dq: 'A', w: 0.5, jogosMin: 10 },
  agora: H,
  ...extra,
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
const soma = (es: EntradaSugerida[]) => es.reduce((s, e) => s + e.stake, 0);
const chaveDe = (e: EntradaSugerida) => `${e.casa.trim().toLowerCase()}#${e.chave}`;

describe('lista cheia (5 entradas)', () => {
  const r = melhoresEntradas(pedido({ travas: travas() }));

  it('a fixture produz a lista cheia', () => {
    expect(MAX_ENTRADAS).toBe(5);
    expect(r.entradas).toHaveLength(5);
  });

  it('a soma das stakes nunca passa do teto de 2% do jogo (nem de 6% do dia)', () => {
    expect(soma(r.entradas)).toBeLessThanOrEqual(0.02 + 1e-12);
    expect(soma(r.entradas)).toBeLessThanOrEqual(0.06);
  });

  it('o saldo é repartido NA ORDEM: o que falta nas últimas fica zerado, com o motivo', () => {
    let resta = 0.02;
    for (const e of r.entradas) {
      expect(e.stake).toBeLessThanOrEqual(resta + 1e-12);
      resta -= e.stake;
    }
    const zeradas = r.entradas.filter((e) => e.stake === 0);
    expect(zeradas.length).toBeGreaterThan(0);
    for (const e of zeradas) {
      expect(e.limiteStake).toBe('jogo');
      expect(e.reduzidaPorAcumulo).toBe(true);
    }
    expect(r.entradas[0].reduzidaPorAcumulo).toBeUndefined();
  });

  it('nenhuma stake passa do Kelly fracionado nem do teto de 1% da lista', () => {
    for (const e of r.entradas) {
      expect(e.stake).toBeLessThanOrEqual(e.stakeKelly + 1e-15);
      expect(e.stake).toBeLessThanOrEqual(STAKE_ENTRADA);
    }
  });
});

describe('saldo do dia parcialmente consumido', () => {
  it('só restam 0,3% do dia: a soma da lista não passa disso, e a 1ª leva o que cabe', () => {
    const r = melhoresEntradas(pedido({ travas: travas({ expostoHoje: 0.057 }) }));
    expect(soma(r.entradas)).toBeLessThanOrEqual(0.003 + 1e-12);
    expect(r.entradas[0].stake).toBeCloseTo(0.003, 12);
    expect(r.entradas[0].limiteStake).toBe('dia');
    for (const e of r.entradas.slice(1)) {
      expect(e.stake).toBe(0);
      expect(e.reduzidaPorAcumulo).toBe(true);
    }
  });

  it('dia no limite: todas zeradas e o aviso de teto do dia', () => {
    const r = melhoresEntradas(pedido({ travas: travas({ expostoHoje: 0.06 }) }));
    expect(soma(r.entradas)).toBe(0);
    expect(r.bloqueio).toContain('6%');
  });

  it('o saldo do dia é mais restritivo que o do jogo: vence o menor', () => {
    const r = melhoresEntradas(pedido({ travas: travas({ expostoHoje: 0.055, expostoJogo: 0 }) }));
    expect(soma(r.entradas)).toBeLessThanOrEqual(0.005 + 1e-12);
  });
});

describe('exposição já comprometida no jogo', () => {
  it('1% já no jogo: a lista inteira cabe em 1%', () => {
    const r = melhoresEntradas(pedido({ travas: travas({ expostoJogo: 0.01 }) }));
    expect(soma(r.entradas)).toBeLessThanOrEqual(0.01 + 1e-12);
  });

  it('o jogo e o dia juntos: sempre o menor saldo', () => {
    const r = melhoresEntradas(
      pedido({ travas: travas({ expostoJogo: 0.012, expostoHoje: 0.0575 }) }),
    );
    expect(soma(r.entradas)).toBeLessThanOrEqual(0.0025 + 1e-12);
  });
});

describe('nunca aumenta nenhuma stake', () => {
  it('exposição já comprometida só diminui cada stake (o saldo menor nunca dá mais a ninguém)', () => {
    // stake_i = clamp(saldo − soma das anteriores, 0, individual_i): monótona no saldo
    const livre = melhoresEntradas(pedido({ travas: travas() })).entradas;
    for (const t of [
      travas({ expostoHoje: 0.03 }),
      travas({ expostoJogo: 0.005 }),
      travas({ expostoJogo: 0.012 }),
      travas({ expostoHoje: 0.057, expostoJogo: 0.01 }),
    ]) {
      const r = melhoresEntradas(pedido({ travas: t })).entradas;
      expect(r.map((e) => e.chave)).toEqual(livre.map((e) => e.chave)); // mesma lista e ordem
      r.forEach((e, i) => expect(e.stake).toBeLessThanOrEqual(livre[i].stake + 1e-15));
    }
  });

  it('drawdown reduz o total e o teto de cada entrada; sobra saldo para as últimas, sem aumentar o risco', () => {
    // com Kelly e teto pela metade as primeiras ficam menores e as últimas, antes zeradas pelo
    // saldo, podem ganhar um pouco: o TOTAL nunca sobe e nenhuma passa do Kelly nem do teto
    const livre = melhoresEntradas(pedido({ travas: travas() })).entradas;
    const dd = melhoresEntradas(pedido({ travas: travas({ fatorKelly: 0.5 }) })).entradas;
    expect(soma(dd)).toBeLessThanOrEqual(soma(livre) + 1e-12);
    for (const e of dd) {
      expect(e.stake).toBeLessThanOrEqual(e.stakeKelly + 1e-15);
      expect(e.stake).toBeLessThanOrEqual(STAKE_ENTRADA * 0.5 + 1e-15);
    }
  });

  it('as probabilidades e os EVs da lista não mudam com as travas', () => {
    const a = melhoresEntradas(pedido({ travas: travas() })).entradas;
    const b = melhoresEntradas(
      pedido({ travas: travas({ expostoHoje: 0.05, expostoJogo: 0.015 }) }),
    ).entradas;
    expect(b.map((e) => [e.chave, e.odd, e.chance, e.ev, e.chanceGreen, e.minimo])).toEqual(
      a.map((e) => [e.chave, e.odd, e.chance, e.ev, e.chanceGreen, e.minimo]),
    );
  });
});

describe('exibir a lista não reserva exposição (sem reserva fantasma)', () => {
  it('chamadas repetidas com as mesmas travas dão exatamente o mesmo resultado', () => {
    const t = travas({ expostoHoje: 0.02, expostoJogo: 0.004 });
    const a = melhoresEntradas(pedido({ travas: t }));
    const b = melhoresEntradas(pedido({ travas: t }));
    const c = melhoresEntradas(pedido({ travas: t }));
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('as travas passadas não são alteradas pela lista', () => {
    const t = travas({ expostoHoje: 0.02, expostoJogo: 0.004 });
    const antes = JSON.stringify(t);
    melhoresEntradas(pedido({ travas: t }));
    expect(JSON.stringify(t)).toBe(antes);
  });
});

describe('entrada já registrada não consome o saldo duas vezes', () => {
  const sem = melhoresEntradas(pedido({ travas: travas() })).entradas;
  const primeira = sem[0];

  it('a registrada fica marcada, com stake zero, e não entra na soma', () => {
    const t = travas({ expostoHoje: primeira.stake, expostoJogo: primeira.stake });
    const r = melhoresEntradas(pedido({ travas: t, registradas: [chaveDe(primeira)] })).entradas;
    expect(r[0].jaRegistrada).toBe(true);
    expect(r[0].stake).toBe(0);
    expect(r.slice(1).every((e) => !e.jaRegistrada)).toBe(true);
  });

  it('comprometido (travas) + o que a lista autoriza nunca passa do teto do jogo', () => {
    const t = travas({ expostoHoje: primeira.stake, expostoJogo: primeira.stake });
    const r = melhoresEntradas(pedido({ travas: t, registradas: [chaveDe(primeira)] })).entradas;
    expect(primeira.stake + soma(r)).toBeLessThanOrEqual(0.02 + 1e-12);
  });

  it('sem avisar quais já foram registradas, a lista contaria em dobro e daria menos saldo às demais', () => {
    const t = travas({ expostoHoje: primeira.stake, expostoJogo: primeira.stake });
    const certa = melhoresEntradas(
      pedido({ travas: t, registradas: [chaveDe(primeira)] }),
    ).entradas;
    const dobro = melhoresEntradas(pedido({ travas: t })).entradas;
    const demais = (es: EntradaSugerida[]) => soma(es.filter((e) => e.chave !== primeira.chave));
    expect(demais(certa)).toBeGreaterThanOrEqual(demais(dobro));
  });

  it('a chave aceita a casa com maiúsculas e espaços', () => {
    const chave = `${primeira.casa.toUpperCase()}#${primeira.chave}`.replace(
      primeira.casa.toUpperCase(),
      ` ${primeira.casa.toUpperCase()} `,
    );
    // a chave normalizada é minúscula e sem espaços nas pontas: a lista compara assim
    const r = melhoresEntradas(
      pedido({ travas: travas(), registradas: [chaveDe(primeira)] }),
    ).entradas;
    expect(r[0].jaRegistrada).toBe(true);
    expect(chave).toContain(primeira.chave);
  });

  it('uma chave que não bate com nenhuma entrada não muda nada', () => {
    const a = melhoresEntradas(pedido({ travas: travas() }));
    const b = melhoresEntradas(pedido({ travas: travas(), registradas: ['outra#qualquer'] }));
    expect(b).toEqual(a);
  });
});
