/**
 * D1, ajustes aprovados na revisão independente:
 *  (1) fronteiras do centavo: a tolerância é ε × banca × 100 (proporcional ao ruído do ponto
 *      flutuante), nunca acima da anterior (5e-7 centavo);
 *  (2) jogo checado antes do dia: jogo esgotado → NO_BET; só o dia → WATCHLIST; os dois → NO_BET
 *      informando também o teto de 6%;
 *  (3) integridade numérica: NaN, Infinity ou centavos sem precisão nunca chegam à autorização nem
 *      viram BET; NO_BET com "falha numérica". Sem limite de banca.
 */
import { describe, expect, it } from 'vitest';
import { calcularTravas, type TravasBanca } from '../src/banca';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, type EntradaV4 } from '../src/v4';

const H = (hhmm: string) => `2026-10-26T${hhmm}:00-03:00`;
const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2026-10-26T20:00:00-03:00' };
const AGORA = '2026-10-26T16:00:00-03:00';
const HOJE = '2026-10-26T10:00:00-03:00';
const ou = (casa: string, over: number, under: number): LinhaOdd[] =>
  (
    [
      ['over', over],
      ['under', under],
    ] as const
  ).map(([lado, odd]) => ({
    casa,
    mercado: 'total' as TipoMercado,
    lado,
    odd,
    linha: 2.5,
    periodo: 'FT',
    horarioColeta: H('16:00'),
  }));
/** odd forte: o Kelly passa do teto de 2%, então quem decide a stake são os saldos testados */
const LINHAS = [...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.3, 1.65)];
const entrada = (banca: number | undefined, travas?: TravasBanca): EntradaV4 => ({
  jogo: JOGO,
  agora: AGORA,
  linhas: LINHAS,
  ligaPrincipal: true,
  banca,
  ...(travas ? { travas } : {}),
});
const vazias = (banca: number): TravasBanca => calcularTravas(banca, [], AGORA);
const centavos = (r: ReturnType<typeof analisarV4>) => {
  const v = r.melhor?.stake?.valor;
  return v === undefined ? 0 : Math.round(v * 100);
};

/** folga do DIA de `alvo` centavos (o jogo e o teto de 2% sobram) */
const comFolgaDia = (banca: number, alvo: number) =>
  analisarV4(entrada(banca, { ...vazias(banca), expostoHoje: 0.06 - alvo / (banca * 100) }));
/** folga do JOGO de `alvo` centavos (o dia sobra) */
const comFolgaJogo = (banca: number, alvo: number) =>
  analisarV4(entrada(banca, { ...vazias(banca), expostoJogo: 0.02 - alvo / (banca * 100) }));

describe('(1) fronteiras do centavo: imediatamente abaixo, exatamente no limite e acima', () => {
  // deficits REAIS: 1e-10 centavo já é ~50× o ruído medido na banca de R$ 1.000 (2e-12 centavo).
  // 5e-7 e 4,9e-7 eram arredondados PARA CIMA pela tolerância anterior (toFixed(6)).
  const ABAIXO = [1e-2, 1e-4, 1e-6, 5.1e-7, 5e-7, 4.9e-7, 1e-7, 1e-8, 1e-9, 1e-10];
  const ACIMA = [1e-9, 1e-6, 1e-2];

  for (const [nome, comFolga] of [
    ['dia', comFolgaDia],
    ['jogo', comFolgaJogo],
  ] as const)
    describe(`saldo do ${nome}, banca R$ 1.000`, () => {
      it.each([1, 2, 5, 100, 1999])(
        '%i centavo(s): logo abaixo nunca dá o centavo de cima',
        (k) => {
          for (const d of ABAIXO) {
            const r = comFolga(1000, k - d);
            expect(centavos(r), `k=${k} δ=${d}`).toBe(k - 1);
            if (k === 1) expect(r.decisao, `δ=${d}`).not.toBe('BET');
          }
        },
      );
      it.each([1, 2, 5, 100, 1999])('%i centavo(s): no limite e acima dá exatamente k', (k) => {
        expect(centavos(comFolga(1000, k))).toBe(k);
        for (const d of ACIMA) expect(centavos(comFolga(1000, k + d)), `δ=${d}`).toBe(k);
      });
    });

  it('R$ 0,01: imediatamente abaixo NÃO é BET, exatamente R$ 0,01 e acima é BET de R$ 0,01', () => {
    expect(comFolgaDia(1000, 1 - 1e-10).decisao).toBe('WATCHLIST');
    expect(comFolgaJogo(1000, 1 - 1e-10).decisao).toBe('NO_BET');
    for (const alvo of [1, 1 + 1e-9, 1.5]) {
      for (const r of [comFolgaDia(1000, alvo), comFolgaJogo(1000, alvo)]) {
        expect(r.decisao, `alvo=${alvo}`).toBe('BET');
        expect(r.melhor!.stake!.valor, `alvo=${alvo}`).toBe(0.01);
      }
    }
  });

  it('a margem proporcional fica abaixo da anterior: deficit de 5e-7 centavo (que a anterior arredondava para cima) é recusado de R$ 1 a R$ 10 milhões', () => {
    for (const banca of [1, 14.5, 1000, 1234.56, 1e5, 1e6, 1e7])
      for (const k of [1, 100]) {
        if (banca * 6 < k) continue; // o teto do dia nem chega a k centavos
        expect(centavos(comFolgaDia(banca, k - 5e-7)), `banca=${banca} k=${k}`).toBe(k - 1);
        expect(centavos(comFolgaDia(banca, k)), `banca=${banca} k=${k}`).toBe(k);
      }
  });

  it('em banca grande a margem para na anterior (5e-7): com R$ 100 milhões, deficit de 1e-6 é recusado', () => {
    // sem o teto da margem, ε × 1e8 × 100 = 2,2e-6 centavo aceitaria esse deficit
    for (const k of [1, 100, 1999]) {
      expect(centavos(comFolgaDia(1e8, k - 1e-6)), `k=${k}`).toBe(k - 1);
      expect(centavos(comFolgaDia(1e8, k)), `k=${k}`).toBe(k);
    }
  });

  it('o ruído real continua absorvido: R$ 0,30 + 7,30 + 52,39 deixa R$ 0,01 (BET de R$ 0,01)', () => {
    const tr = calcularTravas(
      1000,
      [0.3, 7.3, 52.39].map((stake) => ({ feitaEm: HOJE, stake })),
      AGORA,
    );
    // não é vácuo: em ponto flutuante essa folga sai ABAIXO de 1 centavo (0,99999999999961…)
    expect((0.06 - tr.expostoHoje) * 1000 * 100).toBeLessThan(1);
    const r = analisarV4(entrada(1000, tr));
    expect(r.decisao).toBe('BET');
    expect(r.melhor!.stake!.valor).toBe(0.01);
  });
});

describe('(2) precedência: o jogo é checado antes do dia', () => {
  const caso = (dia: number[], jogoRs: number) => {
    const tr = calcularTravas(
      1000,
      dia.map((stake) => ({ feitaEm: HOJE, stake })),
      AGORA,
    );
    return analisarV4(entrada(1000, { ...tr, expostoJogo: jogoRs / 1000 }));
  };
  const DIAS_ESGOTADOS = [
    [20, 20, 20],
    [7.3, 33.3, 19.4],
  ];
  const JOGOS_ESGOTADOS = [20, 7.3 + 33.3 - 20.6];

  it('dia esgotado, jogo disponível: WATCHLIST, sem prometer a mesma partida amanhã', () => {
    for (const dia of DIAS_ESGOTADOS) {
      const r = caso(dia, 5);
      expect(r.decisao).toBe('WATCHLIST');
      expect(r.gatilho).toBe('só amanhã');
      expect(r.motivos).toContain('teto de 6% da banca no dia já atingido');
      expect(r.motivos).toContain(
        'o saldo do dia renova amanhã; isso não garante que esta partida ainda estará disponível',
      );
    }
  });
  it('jogo esgotado, dia disponível: NO_BET pelo jogo, sem menção ao dia', () => {
    for (const jogo of JOGOS_ESGOTADOS) {
      const r = caso([10], jogo);
      expect(r.decisao).toBe('NO_BET');
      expect(r.motivos.join(' ')).toMatch(/neste jogo já comprometido/);
      expect(r.motivos.join(' ')).not.toMatch(/teto de 6%/);
    }
  });
  it('jogo e dia esgotados (exatos ou com poeira): NO_BET, informando também o teto de 6%', () => {
    for (const dia of DIAS_ESGOTADOS)
      for (const jogo of JOGOS_ESGOTADOS) {
        const r = caso(dia, jogo);
        expect(r.decisao).toBe('NO_BET');
        expect(r.gatilho).toBeUndefined();
        expect(r.motivos.join(' ')).toMatch(/neste jogo já comprometido/);
        expect(r.motivos).toContain('teto de 6% da banca no dia também atingido');
        expect(r.motivos.join(' ')).not.toMatch(/renova amanhã/);
        expect(r.melhor?.stake ?? null).toBeNull();
      }
  });
});

describe('(3) integridade numérica: falha segura, sem limite de banca', () => {
  const falhaNumerica = (r: ReturnType<typeof analisarV4>, rotulo: string) => {
    expect(r.decisao, rotulo).toBe('NO_BET');
    expect(r.motivos.join(' '), rotulo).toMatch(/falha numérica/);
    expect(r.melhor?.stake ?? null, rotulo).toBeNull();
  };

  it('bancas grandes mas representáveis: BET normal de exatamente 2% (não há teto de banca)', () => {
    for (const b of [1e6, 1e7, 1e9, 1e13]) {
      for (const r of [analisarV4(entrada(b)), analisarV4(entrada(b, vazias(b)))]) {
        expect(r.decisao, String(b)).toBe('BET');
        expect(r.melhor!.stake!.valor, String(b)).toBe(b * 0.02);
      }
    }
  });

  it.each([2e15, 1e20, 1e300, 3e307, Number.MAX_VALUE])(
    'banca R$ %d (centavos não finitos ou acima de 2^53): NO_BET por falha numérica, com e sem travas',
    (b) => {
      falhaNumerica(analisarV4(entrada(b)), 'sem travas');
      falhaNumerica(analisarV4(entrada(b, vazias(b))), 'com travas');
    },
  );

  it.each([NaN, Infinity, -Infinity])('banca %d: NO_BET por falha numérica', (b) => {
    falhaNumerica(analisarV4(entrada(b)), 'sem travas');
    falhaNumerica(analisarV4(entrada(1000, { ...vazias(1000), bancaAtual: b })), 'bancaAtual');
  });

  it.each([NaN, Infinity, -0.01])(
    'exposição do dia %d: NO_BET por falha numérica (não chega à autorização)',
    (x) => {
      falhaNumerica(analisarV4(entrada(1000, { ...vazias(1000), expostoHoje: x })), 'com banca');
      falhaNumerica(
        analisarV4(entrada(undefined, { ...vazias(1000), expostoHoje: x })),
        'sem banca',
      );
    },
  );

  it('nenhum BET sai com stake não finita, fora de [R$ 0,01, 2% da banca] ou acima do saldo', () => {
    const bancas = [0.5, 1, 14.5, 1000, 1e6, 1e9, 1e13, 1e15, 2e15, 1e300, Number.MAX_VALUE];
    for (const b of bancas)
      for (const exposto of [0, 0.03, 0.0599, 0.06])
        for (const jogo of [0, 0.019, 0.02]) {
          const r = analisarV4(
            entrada(b, { ...vazias(b), expostoHoje: exposto, expostoJogo: jogo }),
          );
          if (r.decisao !== 'BET') continue;
          const v = r.melhor!.stake!.valor!;
          const rotulo = `banca=${b} dia=${exposto} jogo=${jogo}`;
          expect(Number.isFinite(v), rotulo).toBe(true);
          expect(v, rotulo).toBeGreaterThanOrEqual(0.01);
          expect(v, rotulo).toBeLessThanOrEqual(b * 0.02);
          expect(v, rotulo).toBeLessThanOrEqual(b * (0.06 - exposto) + 1e-9 * b);
          expect(v, rotulo).toBeLessThanOrEqual(b * (0.02 - jogo) + 1e-9 * b);
        }
  });
});
