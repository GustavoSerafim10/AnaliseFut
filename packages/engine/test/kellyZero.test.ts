/**
 * Regressão da correção de `zero()` em kelly.ts: uma recusa por pedido inválido NÃO repete o valor
 * inválido do pedido em `teto` e `fracaoKelly` (negativo ou não finito vira 0). Nada mais muda:
 * `kellyCheio`, o motivo, `fracaoBanca`, `limites`, `valor` e todas as autorizações de pedidos
 * válidos continuam exatamente como eram.
 *
 * A grade é a mesma que achou a divergência: 11 × 9 × 6 × 6 × 5 × 5 × 5 = 445.500 pedidos, válidos
 * e inválidos (NaN, Infinity, zero, negativos).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { autorizarStake, kellyCheio, type PedidoStake, type StakeAutorizada } from '../src/kelly';
import { motivoCorpoIncompativel } from '../src/ledger';
import type { DQ } from '../src/tipos';

const PS = [0.01, 0.2, 0.5, 0.55, 0.8, 0.99, 0, 1, Number.NaN, Number.POSITIVE_INFINITY, -0.1];
const ODDS = [1.01, 1.5, 2, 3.4, 10, 1, 0.5, Number.NaN, Number.POSITIVE_INFINITY];
const FRACOES = [0.25, 0.125, 0, -0.25, Number.NaN, Number.POSITIVE_INFINITY];
const DQS: (DQ | undefined)[] = ['A', 'B', 'C', 'D', 'E', undefined];
const BANCAS = [undefined, 1000, 0, -5, Number.NaN];
const TETOS = [undefined, 0.01, 0, -1, Number.NaN];
const FOLGAS_DIA = [undefined, 0.06, 0, -1, Number.NaN];

/** Digest (SHA-256 do JSON) das saídas dos pedidos VÁLIDOS da grade, calculado com o código ANTES da correção. */
const DIGEST_PEDIDOS_VALIDOS = 'a6c66c1e80d3e31d499a7c6e78d5f974f411ee703170e3ebb6e5000786812584';
const TOTAL_DE_PEDIDOS = 445_500;
const TOTAL_DE_VALIDOS = 12_960;

const ehPedidoValido = (p: PedidoStake): boolean =>
  p.p > 0 &&
  p.p < 1 &&
  Number.isFinite(p.odd) &&
  p.odd > 1 &&
  Number.isFinite(p.fracaoKelly) &&
  p.fracaoKelly >= 0 &&
  (p.teto === undefined || (Number.isFinite(p.teto) && p.teto >= 0)) &&
  (p.folgaDia === undefined || Number.isFinite(p.folgaDia)) &&
  (p.banca === undefined || (Number.isFinite(p.banca) && p.banca > 0));

const finitoNaoNegativo = (x: number | undefined) =>
  x === undefined || (Number.isFinite(x) && x >= 0);

/** corpo de uma aposta registrada em volta da stake, para a validação do Ledger */
const corpoComStake = (stake: StakeAutorizada) => ({
  decisao: null,
  aposta: { odd: 2, casa: 'x', feitaEm: '2026-11-13T15:00:00-03:00' },
  stakeAutorizada: stake,
  travas: {
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
  },
});

describe('zero(): grade de 445.500 pedidos', () => {
  it('toda saída tem teto e fracaoKelly finitos e não negativos, e o Ledger aceita todas', () => {
    const hash = createHash('sha256');
    let total = 0;
    let validos = 0;
    let recusadas = 0;
    for (const p of PS)
      for (const odd of ODDS)
        for (const fracaoKelly of FRACOES)
          for (const dq of DQS)
            for (const banca of BANCAS)
              for (const teto of TETOS)
                for (const folgaDia of FOLGAS_DIA) {
                  const pedido: PedidoStake = {
                    p,
                    odd,
                    fracaoKelly,
                    dq,
                    banca,
                    teto,
                    folgaDia,
                    reducoes: [0.5],
                  };
                  const s = autorizarStake(pedido);
                  total++;
                  // campos que nunca podem ser negativos ou não finitos, em qualquer saída
                  if (!(Number.isFinite(s.fracaoKelly) && s.fracaoKelly >= 0))
                    expect.fail('fracaoKelly');
                  if (!(Number.isFinite(s.teto) && s.teto >= 0)) expect.fail('teto');
                  if (!(Number.isFinite(s.fracaoBanca) && s.fracaoBanca >= 0))
                    expect.fail('fracaoBanca');
                  if (!Number.isFinite(s.kellyCheio)) expect.fail('kellyCheio');
                  if (!finitoNaoNegativo(s.valor)) expect.fail('valor');
                  if (!s.autorizada) recusadas++;
                  // a última barreira concorda com o produtor
                  const motivo = motivoCorpoIncompativel(
                    { tipo: 'aposta_registrada', seq: 2 },
                    corpoComStake(s),
                  );
                  if (motivo !== null) expect.fail(`${motivo} :: ${JSON.stringify(pedido)}`);
                  if (ehPedidoValido(pedido)) {
                    validos++;
                    hash.update(JSON.stringify(s) + '\n');
                  }
                }
    expect(total).toBe(TOTAL_DE_PEDIDOS);
    expect(validos).toBe(TOTAL_DE_VALIDOS);
    expect(recusadas).toBeGreaterThan(0);
    // pedidos VÁLIDOS: saída byte a byte idêntica à de antes da correção
    expect(hash.digest('hex')).toBe(DIGEST_PEDIDOS_VALIDOS);
  });
});

describe('zero(): casos nomeados', () => {
  it('teto negativo: recusa com o MESMO motivo, teto 0, kellyCheio preservado', () => {
    const s = autorizarStake({ p: 0.5, odd: 2, fracaoKelly: 0.25, dq: 'A', teto: -1 });
    expect(s).toMatchObject({
      autorizada: false,
      motivo: 'teto inválido (-1)',
      teto: 0,
      fracaoBanca: 0,
      limites: [],
    });
    expect(s.kellyCheio).toBe(kellyCheio(0.5, 2));
  });

  it('fração de Kelly negativa: recusa com o MESMO motivo, fração 0', () => {
    const s = autorizarStake({ p: 0.5, odd: 2, fracaoKelly: -0.25, dq: 'A' });
    expect(s).toMatchObject({
      autorizada: false,
      motivo: 'fração de Kelly inválida (-0.25)',
      fracaoKelly: 0,
      fracaoBanca: 0,
      limites: [],
    });
  });

  it('com redução, a fração negativa também não vaza (negativa × redução continua negativa)', () => {
    const s = autorizarStake({ p: 0.5, odd: 2, fracaoKelly: -0.5, reducoes: [0.5, 1] });
    expect(s.autorizada).toBe(false);
    expect(s.fracaoKelly).toBe(0);
  });

  it('não finitos: fração NaN/Infinity e teto NaN/Infinity viram 0', () => {
    for (const fracaoKelly of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const s = autorizarStake({ p: 0.5, odd: 2, fracaoKelly });
      expect(s.autorizada).toBe(false);
      expect(s.fracaoKelly).toBe(0);
    }
    for (const teto of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const s = autorizarStake({ p: 0.5, odd: 2, fracaoKelly: 0.25, teto });
      expect(s.autorizada).toBe(false);
      expect(s.teto).toBe(0);
    }
  });

  it('kellyCheio NEGATIVO é preservado quando matematicamente correto (EV negativo)', () => {
    const s = autorizarStake({ p: 0.01, odd: 1.01, fracaoKelly: 0.25, dq: 'A', teto: -1 });
    expect(s.kellyCheio).toBeLessThan(0);
    expect(s.kellyCheio).toBe(kellyCheio(0.01, 1.01));
    expect(s.motivo).toBe('teto inválido (-1)');
    expect(s.teto).toBe(0);
  });

  it('pedido de EV negativo sem erro de entrada: continua "sem vantagem", kellyCheio negativo', () => {
    const s = autorizarStake({ p: 0.4, odd: 2, fracaoKelly: 0.25, dq: 'A', banca: 1000 });
    expect(s).toMatchObject({ autorizada: false, motivo: 'sem vantagem: EV nulo ou negativo' });
    expect(s.kellyCheio).toBeLessThan(0);
    expect(s.teto).toBeGreaterThan(0); // teto válido do pedido segue intacto
    expect(s.fracaoKelly).toBe(0.25); // fração válida segue intacta
  });

  it('teto zero VÁLIDO segue como antes (não é erro de entrada)', () => {
    const s = autorizarStake({ p: 0.55, odd: 2, fracaoKelly: 0.25, dq: 'A', teto: 0 });
    expect(s.autorizada).toBe(false);
    expect(s.teto).toBe(0);
  });

  it('autorização válida não muda: valores conhecidos', () => {
    const s = autorizarStake({ p: 0.55, odd: 2, fracaoKelly: 0.25, dq: 'A', banca: 1000 });
    expect(s.autorizada).toBe(true);
    expect(s.kellyCheio).toBeCloseTo(0.1, 12);
    expect(s.fracaoKelly).toBe(0.25);
    expect(s.fracaoBanca).toBeCloseTo(0.02, 12); // Kelly 2,5% limitado pelo teto geral de 2%
    expect(s.limites).toEqual(['teto']);
    expect(s.teto).toBeCloseTo(0.02, 12);
  });
});
