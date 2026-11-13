/**
 * Etapa 3C: a política de exposição é única e conservadora. Este teste TRAVA os valores de
 * hoje: mudar qualquer limite exige autorização expressa e a atualização explícita daqui.
 */
import { describe, expect, it } from 'vitest';
import { STAKE_ENTRADA } from '../src/entradas';
import { autorizarStake, fracaoKelly, MAX_POR_APOSTA, MAX_POR_LOTE } from '../src/kelly';
import { POLITICA_EXPOSICAO, tetoDaAposta } from '../src/politicaExposicao';
import { KELLY_V4, TETO_APOSTA_V4 } from '../src/v4';

describe('valores da política (travados)', () => {
  it('limites e frações são exatamente os que já valiam', () => {
    expect(POLITICA_EXPOSICAO.tetoGeralPorAposta).toBe(0.02);
    expect(POLITICA_EXPOSICAO.tetoPorNivel).toEqual({ R1: 0.02, R2: 0.02, R3: 0.01 });
    expect(POLITICA_EXPOSICAO.tetoListaEntradas).toBe(0.01);
    expect(POLITICA_EXPOSICAO.tetoPorLote).toBe(0.05);
    expect(POLITICA_EXPOSICAO.kellyPorNivel).toEqual({ R1: 1 / 4, R2: 1 / 6, R3: 1 / 8 });
    expect(POLITICA_EXPOSICAO.kellyForte).toBe(0.25);
    expect(POLITICA_EXPOSICAO.kellyPadrao).toBe(0.125);
    expect(POLITICA_EXPOSICAO.dqSemExposicao).toEqual(['D', 'E']);
  });

  it('os nomes antigos apontam para a política única (nenhuma segunda fonte)', () => {
    expect(MAX_POR_APOSTA).toBe(POLITICA_EXPOSICAO.tetoGeralPorAposta);
    expect(MAX_POR_LOTE).toBe(POLITICA_EXPOSICAO.tetoPorLote);
    expect(STAKE_ENTRADA).toBe(POLITICA_EXPOSICAO.tetoListaEntradas);
    expect(KELLY_V4).toEqual(POLITICA_EXPOSICAO.kellyPorNivel);
    expect(TETO_APOSTA_V4).toEqual(POLITICA_EXPOSICAO.tetoPorNivel);
  });

  it('o teto de cada nível nunca passa do geral', () => {
    for (const n of ['R1', 'R2', 'R3'] as const) {
      expect(tetoDaAposta(n)).toBeLessThanOrEqual(POLITICA_EXPOSICAO.tetoGeralPorAposta);
      expect(TETO_APOSTA_V4[n]).toBeLessThanOrEqual(MAX_POR_APOSTA);
    }
    expect(tetoDaAposta('R3')).toBe(0.01);
    expect(tetoDaAposta()).toBe(0.02);
  });

  it('fração por DQ e robustez usa a política (1/4 só com A/B, ROBUSTA e escalação certa)', () => {
    expect(fracaoKelly('A', 'ROBUSTA')).toBe(POLITICA_EXPOSICAO.kellyForte);
    expect(fracaoKelly('C', 'ROBUSTA')).toBe(POLITICA_EXPOSICAO.kellyPadrao);
    expect(fracaoKelly('A', 'ROBUSTA', true)).toBe(POLITICA_EXPOSICAO.kellyPadrao);
    expect(fracaoKelly('B', 'MODERADA')).toBe(POLITICA_EXPOSICAO.kellyPadrao);
  });
});

describe('a regra mais restritiva sempre prevalece', () => {
  it('em uma grade grande, a stake nunca passa de nenhum dos limites aplicáveis', () => {
    let n = 0;
    for (const nivel of ['R1', 'R2', 'R3'] as const)
      for (const p of [0.2, 0.35, 0.5, 0.65, 0.8, 0.95])
        for (const odd of [1.2, 1.6, 2, 3, 5, 9])
          for (const folgaDia of [undefined, 0, 0.003, 0.02, 0.06])
            for (const reducao of [1, 0.5, 0.25]) {
              const s = autorizarStake({
                p,
                odd,
                fracaoKelly: POLITICA_EXPOSICAO.kellyPorNivel[nivel],
                reducoes: [reducao],
                teto: tetoDaAposta(nivel),
                folgaDia,
              });
              expect(s.fracaoBanca).toBeLessThanOrEqual(POLITICA_EXPOSICAO.tetoGeralPorAposta);
              expect(s.fracaoBanca).toBeLessThanOrEqual(POLITICA_EXPOSICAO.tetoPorNivel[nivel]);
              expect(s.fracaoBanca).toBeLessThanOrEqual(
                Math.max(0, s.kellyCheio) * s.fracaoKelly + 1e-15,
              );
              if (folgaDia !== undefined)
                expect(s.fracaoBanca).toBeLessThanOrEqual(Math.max(0, folgaDia));
              n++;
            }
    expect(n).toBe(3 * 6 * 6 * 5 * 3);
  });

  it('o teto específico (R3 e lista) pode apertar, mas nunca afrouxar o geral', () => {
    const afrouxa = autorizarStake({ p: 0.95, odd: 3, fracaoKelly: 0.25, teto: 0.5 });
    expect(afrouxa.fracaoBanca).toBe(0.02);
    expect(afrouxa.teto).toBe(0.02);
    const aperta = autorizarStake({ p: 0.95, odd: 3, fracaoKelly: 0.25, teto: 0.01 });
    expect(aperta.fracaoBanca).toBe(0.01);
    expect(aperta.teto).toBe(0.01);
  });

  it('o limite aplicado é informado (teto ou dia), para auditoria', () => {
    const dia = autorizarStake({ p: 0.95, odd: 3, fracaoKelly: 0.25, teto: 0.01, folgaDia: 0.004 });
    expect(dia.limites).toEqual(['teto', 'dia']);
    expect(dia.fracaoBanca).toBe(0.004);
  });
});
