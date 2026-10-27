import { describe, expect, it } from 'vitest';
import { brier, clvJusto } from '../src/apuracao';
import { calcularTravas, type TravasBanca } from '../src/banca';
import { devigProporcional, devigShin } from '../src/devig';
import { detectarMovimentos } from '../src/movimento';
import { evApostaGratis, evBonusRollover, evOddTurbinada, evSemRisco } from '../src/promocoes';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, gateV4, oddEfetiva, type EntradaV4 } from '../src/v4';

const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2026-10-26T20:00:00-03:00' };
const AGORA = '2026-10-26T16:00:00-03:00';
const H = (hhmm: string) => `2026-10-26T${hhmm}:00-03:00`;

function ou(casa: string, over: number, under: number, hora = '16:00', linha = 2.5): LinhaOdd[] {
  const l = (lado: string, odd: number): LinhaOdd => ({
    casa,
    mercado: 'total' as TipoMercado,
    lado,
    odd,
    linha,
    periodo: 'FT',
    horarioColeta: H(hora),
  });
  return [l('over', over), l('under', under)];
}
const entrada = (linhas: LinhaOdd[], extra: Partial<EntradaV4> = {}): EntradaV4 => ({
  jogo: JOGO,
  agora: AGORA,
  linhas,
  ligaPrincipal: true,
  banca: 1000,
  ...extra,
});

describe('de-vig de Shin (1X2 da referência)', () => {
  it('soma 1 e tira mais margem do azarão que o proporcional', () => {
    const odds = [1.26, 5.7, 12.4];
    const shin = devigShin(odds);
    const prop = devigProporcional(odds);
    expect(shin.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 10);
    expect(shin[2]).toBeLessThan(prop[2]);
    expect(shin[0]).toBeGreaterThan(prop[0]);
  });
});

describe('gates da V4.0 (seção 5)', () => {
  const f = { ligaPrincipal: true, horasAteJogo: 4, odd: 2 };
  it('R1 2% · R1 liga menor/>24 h 3% · R2 3,5% · R3 5% · R4 sem BET', () => {
    expect(gateV4('R1', f)).toBeCloseTo(0.02, 12);
    expect(gateV4('R1', { ...f, ligaPrincipal: false })).toBeCloseTo(0.03, 12);
    expect(gateV4('R1', { ...f, horasAteJogo: 30 })).toBeCloseTo(0.03, 12);
    expect(gateV4('R2', f)).toBeCloseTo(0.035, 12);
    expect(gateV4('R3', f)).toBeCloseTo(0.05, 12);
    expect(gateV4('R4', f)).toBeNull();
  });
  it('odd > 4 +1 pp, odd > 8 +3 pp, escalação incerta +1 pp', () => {
    expect(gateV4('R1', { ...f, odd: 5 })).toBeCloseTo(0.03, 12);
    expect(gateV4('R1', { ...f, odd: 9 })).toBeCloseTo(0.05, 12);
    expect(gateV4('R2', { ...f, escalacaoIncerta: true })).toBeCloseTo(0.045, 12);
  });
  it('Betfair: comissão sai do lucro', () => {
    expect(oddEfetiva('Betfair Exchange', 2)).toBeCloseTo(1.935, 12);
    expect(oddEfetiva('1win', 2)).toBe(2);
  });
});

describe('referência afiada × casa mole', () => {
  it('R1: 1win acima do preço justo da Pinnacle vira BET com 1/4 Kelly', () => {
    const r = analisarV4(entrada([...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.1, 1.72)]));
    expect(r.referencia.nivel).toBe('R1');
    expect(r.decisao).toBe('BET');
    const m = r.melhor!;
    expect(m.casaMelhorOdd).toBe('1win');
    expect(m.pTrue).toBeCloseTo(0.5, 10);
    expect(m.ev).toBeCloseTo(0.05, 10);
    expect(m.estrategia).toBe('S1');
    // Kelly cheio (1,1·0,5 − 0,5)/1,1 = 4,55% → 1/4 = 1,14%
    expect(m.stake!.fracaoBanca).toBeCloseTo(0.25 * (0.05 / 1.1), 10);
    expect(m.stake!.valor).toBeCloseTo(11.36, 2);
    expect(m.oddMinima).toBeCloseTo(1.02 / 0.5, 10);
  });

  it('a própria referência nunca é a "casa mole"', () => {
    const r = analisarV4(entrada(ou('Pinnacle', 1.95, 1.95)));
    expect(r.avaliadas).toHaveLength(0);
    expect(r.descartados.some((d) => d.motivo.includes('falta casa mole'))).toBe(true);
  });

  it('odds com mais de 10 min de diferença não são comparadas', () => {
    const r = analisarV4(
      entrada([...ou('Pinnacle', 1.95, 1.95, '15:40'), ...ou('1win', 2.1, 1.72, '16:00')]),
    );
    expect(r.avaliadas).toHaveLength(0);
    expect(r.descartados[0].motivo).toContain('não comparáveis');
  });

  it('EV > 15% contra a referência → INVESTIGAR', () => {
    const r = analisarV4(entrada([...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.4, 1.55)]));
    expect(r.decisao).toBe('INVESTIGAR');
  });

  it('R2: consenso de 4 casas, gate 3,5% e 1/6 Kelly', () => {
    const casas = [
      ...ou('Bet365', 1.9, 1.9),
      ...ou('Superbet', 1.9, 1.9),
      ...ou('1win', 1.9, 1.9),
      ...ou('Betano', 2.12, 1.8),
    ];
    const r = analisarV4(entrada(casas));
    expect(r.referencia.nivel).toBe('R2');
    expect(r.melhor?.casaMelhorOdd).toBe('Betano');
    expect(r.melhor?.evMinimo).toBeCloseTo(0.035, 12);
    expect(r.decisao).toBe('BET');
    expect(r.melhor!.stake!.fracaoKelly).toBeCloseTo(1 / 6, 12);
  });

  it('uma casa só e sem modelo: R4, nunca BET', () => {
    const r = analisarV4(entrada(ou('1win', 2.1, 1.72)));
    expect(r.decisao).toBe('NO_BET');
    expect(r.descartados.every((d) => d.motivo.includes('sem referência'))).toBe(true);
  });
});

describe('filtro do modelo V3.3 (passo 6)', () => {
  const linhas = [...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.1, 1.72)];
  // λ baixos: o modelo dá ~10% para o over 2.5, muito abaixo dos 50% da referência
  const apoio = { lambdas: { casa: 0.6, fora: 0.5 }, dq: 'B' as const, w: 0.4, jogosMin: 10 };
  it('discorda sem fato novo e sem viés conhecido: stake pela metade', () => {
    const r = analisarV4(entrada(linhas, { apoio }));
    expect(r.melhor?.filtro).toBe('discorda');
    expect(r.decisao).toBe('BET');
    expect(r.melhor!.stake!.fracaoKelly).toBeCloseTo(0.125, 12);
  });
  it('discorda com fato novo que a referência pode não ter: PASS', () => {
    const r = analisarV4(
      entrada(linhas, { apoio, fatoNovo: 'artilheiro fora, escalação saiu agora' }),
    );
    expect(r.decisao).toBe('NO_BET');
    expect(r.motivos[0]).toContain('PASS');
  });
  it('discordância pelo viés 16.3 é ignorada', () => {
    const r = analisarV4(entrada(linhas, { apoio: { ...apoio, favoritoLigaMaisForte: true } }));
    expect(r.melhor!.stake!.fracaoKelly).toBeCloseTo(0.25, 12);
    expect(r.avisos.join()).toContain('ignorado');
  });
  it('liga principal sem referência: mercado principal fica R4 (lição 3)', () => {
    const r = analisarV4(
      entrada(ou('1win', 1.55, 2.6), {
        apoio: { lambdas: { casa: 2.0, fora: 1.4 }, dq: 'C', w: 0.3, jogosMin: 10 },
      }),
    );
    expect(r.avaliadas).toHaveLength(0);
    expect(r.descartados[0].motivo).toContain('R4');
  });
  it('liga pequena sem referência, o modelo vira preço (R3): gate 5% e red team obrigatório', () => {
    const r = analisarV4(
      entrada(ou('1win', 1.55, 2.6), {
        apoio: { lambdas: { casa: 2.0, fora: 1.4 }, dq: 'C', w: 0.3, jogosMin: 10 },
        ligaPrincipal: false,
      }),
    );
    const over = r.avaliadas.find((a) => a.linha.lado === 'over')!;
    expect(over.nivel).toBe('R3');
    expect(over.evMinimo).toBeCloseTo(0.05, 12);
    expect(over.estrategia).toBe('S3');
  });
});

describe('travas da banca (seção 6)', () => {
  const aposta = (dia: string, lucro: number, stake = 20) => ({
    feitaEm: `${dia}T15:00:00-03:00`,
    apuradaEm: `${dia}T22:00:00-03:00`,
    stake,
    lucro,
  });
  it('drawdown de 20% corta Kelly pela metade; 30% pausa 7 dias', () => {
    const t20 = calcularTravas(1000, [aposta('2026-10-01', -1, 210)], '2026-10-02T10:00:00-03:00');
    expect(t20.drawdown).toBeCloseTo(0.21, 12);
    expect(t20.fatorKelly).toBe(0.5);
    expect(t20.pausadoAte).toBeNull();
    const t30 = calcularTravas(1000, [aposta('2026-10-01', -1, 310)], '2026-10-03T10:00:00-03:00');
    expect(t30.pausadoAte).not.toBeNull();
    const depois = calcularTravas(
      1000,
      [aposta('2026-10-01', -1, 310)],
      '2026-10-09T10:00:00-03:00',
    );
    expect(depois.pausadoAte).toBeNull();
  });
  it('5 perdas no dia encerram o dia; exposição do dia conta as apostas feitas hoje', () => {
    const t = calcularTravas(
      1000,
      Array.from({ length: 5 }, () => aposta('2026-10-26', -1, 5)),
      '2026-10-26T23:00:00-03:00',
    );
    expect(t.diaEncerrado).toBe(true);
    expect(t.expostoHoje).toBeCloseTo(25 / 975, 12);
  });
  it('na decisão: pausa vira NO BET e o teto diário limita a stake', () => {
    const linhas = [...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.1, 1.72)];
    const base: TravasBanca = calcularTravas(1000, [], AGORA);
    const pausado = analisarV4(
      entrada(linhas, { travas: { ...base, pausadoAte: '2026-11-01', motivos: ['pausa'] } }),
    );
    expect(pausado.decisao).toBe('NO_BET');
    const quaseNoTeto = analisarV4(entrada(linhas, { travas: { ...base, expostoHoje: 0.055 } }));
    expect(quaseNoTeto.melhor!.stake!.fracaoBanca).toBeCloseTo(0.005, 12);
  });
});

describe('movimento de linha e atraso da casa mole', () => {
  it('Pinnacle encurtou o over e a 1win ainda paga o preço antigo', () => {
    const versoes = [
      ...ou('Pinnacle', 1.95, 1.95, '15:00'),
      ...ou('Pinnacle', 1.85, 2.05, '15:30'),
      ...ou('1win', 1.95, 1.85, '15:31'),
    ];
    const { movimentos, atrasos } = detectarMovimentos(versoes, JOGO);
    expect(movimentos.map((m) => [m.casa, m.de, m.para])).toContainEqual(['Pinnacle', 1.95, 1.85]);
    expect(atrasos).toHaveLength(1);
    expect(atrasos[0].casaMole).toBe('1win');
  });
});

describe('promoções (S4)', () => {
  it('odd turbinada: EV = P_true × odd − 1', () => {
    expect(evOddTurbinada(0.5, 2.2).ev).toBeCloseTo(0.1, 12);
    expect(evOddTurbinada(0.5, 1.9).aceitar).toBe(false);
  });
  it('freebet e aposta sem risco', () => {
    expect(evApostaGratis(50, 3, 0.35).ev).toBeCloseTo(35, 10);
    expect(evSemRisco(100, 2, 0.5, 1).ev).toBeCloseTo(50, 10);
    expect(evSemRisco(100, 2, 0.45, 0).ev).toBeCloseTo(-10, 10);
  });
  it('bônus com rollover: custo pela margem dos mercados usados', () => {
    const r = evBonusRollover({
      bonus: 100,
      deposito: 100,
      multiplicador: 10,
      base: 'bonus',
      margem: 0.04,
    });
    expect(r.volume).toBe(1000);
    expect(r.custo).toBeCloseTo(40 / 1.04, 10);
    expect(r.aceitar).toBe(true);
    const caro = evBonusRollover({
      bonus: 100,
      deposito: 100,
      multiplicador: 30,
      base: 'deposito+bonus',
      margem: 0.06,
    });
    expect(caro.aceitar).toBe(false);
  });
});

describe('CLV justo e Brier (seção 8)', () => {
  it('CLV contra o fechamento sem margem da referência', () => {
    const r = clvJusto(2.1, 1.95, [1.95]);
    expect(r.oddJustaFechamento).toBeCloseTo(2, 10);
    expect(r.clv).toBeCloseTo(0.05, 10);
    expect(clvJusto(2.1, 2.0).semMargem).toBe(false);
  });
  it('Brier: previsão perfeita = 0', () => {
    expect(brier([1, 0, 0], 0)).toBe(0);
    expect(brier([0.5, 0.3, 0.2], 0)).toBeCloseTo(0.25 + 0.09 + 0.04, 12);
  });
});
