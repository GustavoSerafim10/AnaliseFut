import { describe, expect, it } from 'vitest';
import { ajustarDQ, analisarJogo, type EntradaAnalise } from '../src/decisao';
import { MAX_POR_APOSTA } from '../src/kelly';
import type { LinhaOdd } from '../src/tipos';
import { HORARIO_VILLA, INICIO_VILLA, oddsSinteticas, oddsVillaViking } from './helpers';

const AGORA = '2026-10-21T10:00:00-03:00';

// Lote de 21/10/2026: [jogo, λ_market esperado, λ_modelo V3.3, favorito de liga mais forte?]
const LOTE: [string, [number, number], [number, number], boolean][] = [
  ['Inter × Shakhtar', [2.93, 0.85], [2.27, 1.46], true],
  ['Aston Villa × Viking', [3.0, 0.96], [2.5, 1.15], true],
  ['Betis × Feyenoord', [2.36, 1.36], [2.18, 1.36], false],
  ['Sporting × LASK', [2.8, 0.92], [2.33, 1.15], true],
  ['Brugge × Lens', [2.22, 1.56], [2.5, 1.71], false],
];

function entradaLote(
  nome: string,
  lm: [number, number],
  lmod: [number, number],
  fav: boolean,
): EntradaAnalise {
  const [casa, fora] = nome.split(' × ');
  return {
    jogo: { casa, fora, inicio: INICIO_VILLA },
    agora: AGORA,
    dq: 'B',
    lambdaModelo: { casa: lmod[0], fora: lmod[1] },
    linhas: oddsSinteticas({ casa: lm[0], fora: lm[1] }),
    contexto: { favoritoLigaMaisForte: fav },
  };
}

describe('casos de teste do lote de 21/10/2026', () => {
  it.each(LOTE)('%s → λ_market ≈ tabela (±0,05) e ⛔ NO BET', (nome, lm, lmod, fav) => {
    const r = analisarJogo(entradaLote(nome, lm, lmod, fav));
    expect(r.lambdaMercado).not.toBeNull();
    expect(Math.abs(r.lambdaMercado!.casa - lm[0])).toBeLessThanOrEqual(0.05);
    expect(Math.abs(r.lambdaMercado!.fora - lm[1])).toBeLessThanOrEqual(0.05);
    expect(r.decisao).toBe('NO_BET');
    expect(r.dq.efetiva).toBe('C'); // odds de uma casa só
  });

  it('Villa × Viking com as odds reais da 1win → ⛔ NO BET', () => {
    const r = analisarJogo({
      jogo: { casa: 'Aston Villa', fora: 'Viking', inicio: INICIO_VILLA },
      agora: AGORA,
      dq: 'B',
      lambdaModelo: { casa: 2.5, fora: 1.15 },
      linhas: oddsVillaViking(),
      contexto: { favoritoLigaMaisForte: true },
    });
    expect(r.decisao).toBe('NO_BET');
    expect(r.previsao?.placares).toHaveLength(3);
  });

  it('lição 3: sem a correção 16.3 o "valor" aparece no azarão (Sporting × LASK) e não vira BET', () => {
    const r = analisarJogo(entradaLote('Sporting × LASK', [2.8, 0.92], [2.33, 1.15], false));
    expect(r.melhor?.tese).toBe('fora_resiste');
    expect(r.decisao).not.toBe('BET');
    const corrigido = analisarJogo(entradaLote('Sporting × LASK', [2.8, 0.92], [2.33, 1.15], true));
    expect(corrigido.lambdaModelo.ajustes.some((a) => a.startsWith('16.3'))).toBe(true);
    expect(corrigido.decisao).toBe('NO_BET');
  });
});

// Cenário com valor real: 2 casas, uma com over 2.5 "mole".
const LAMBDA_MERCADO = { casa: 1.5, fora: 1.2 };
function linhasComValor(
  overB = 2.3,
  underB = 1.66,
  horario: string | null = HORARIO_VILLA,
): LinhaOdd[] {
  const a = oddsSinteticas(LAMBDA_MERCADO, { casa: '1win', margem: 0.04 });
  const b = oddsSinteticas(LAMBDA_MERCADO, { casa: 'Bet365', margem: 0.04 }).map((l) =>
    l.mercado === 'total' && l.periodo === 'FT' && l.linha === 2.5
      ? { ...l, odd: l.lado === 'over' ? overB : underB, horarioColeta: horario ?? undefined }
      : l,
  );
  return [...a, ...b];
}
const REDTEAM_OK = {
  argumentos: [
    'árbitro deixa o jogo correr pouco',
    'chuva prevista',
    'λ do modelo pode estar alto (amostra de 8 jogos)',
  ],
  atacaPremissa: true,
  sobreviveu: true,
};
function entradaValor(extra: Partial<EntradaAnalise> = {}): EntradaAnalise {
  return {
    jogo: { casa: 'Time A', fora: 'Time B', inicio: INICIO_VILLA },
    agora: AGORA,
    dq: 'B',
    lambdaModelo: { casa: 1.55, fora: 1.25 },
    linhas: linhasComValor(),
    redTeam: REDTEAM_OK,
    banca: 1000,
    ...extra,
  };
}

describe('caminho até BET e cada portão', () => {
  it('🟢 BET com EV acima do gate, sensibilidade ok, red team e price gate; stake ≤ 2%', () => {
    const r = analisarJogo(entradaValor());
    expect(r.decisao).toBe('BET');
    expect(r.melhor?.linha.mercado).toBe('total');
    expect(r.melhor?.linha.lado).toBe('over');
    expect(r.melhor?.casaMelhorOdd).toBe('Bet365');
    expect(r.melhor!.melhorOdd).toBeGreaterThanOrEqual(r.melhor!.priceGate!.oddMinima);
    expect(r.melhor!.stake!.fracaoBanca).toBeGreaterThan(0);
    expect(r.melhor!.stake!.fracaoBanca).toBeLessThanOrEqual(MAX_POR_APOSTA);
    expect(r.melhor!.stake!.valor).toBeLessThanOrEqual(20);
  });

  it('sem red team → 🟡 WATCHLIST', () => {
    const r = analisarJogo(entradaValor({ redTeam: undefined }));
    expect(r.decisao).toBe('WATCHLIST');
  });

  it('red team derrubou → ⛔ NO BET', () => {
    const r = analisarJogo(entradaValor({ redTeam: { ...REDTEAM_OK, sobreviveu: false } }));
    expect(r.decisao).toBe('NO_BET');
  });

  it('odd sem horário de coleta → 🟡 WATCHLIST', () => {
    const r = analisarJogo(entradaValor({ linhas: linhasComValor(2.3, 1.66, null) }));
    expect(r.decisao).toBe('WATCHLIST');
  });

  it('price gate: odd abaixo da mínima → PASS (🟡 WATCHLIST com gatilho)', () => {
    const r = analisarJogo(entradaValor({ linhas: linhasComValor(2.16, 1.75) }));
    expect(['WATCHLIST', 'NO_BET']).toContain(r.decisao);
    expect(r.decisao).not.toBe('BET');
  });

  it('EV > 25% → 🔍 INVESTIGAR', () => {
    const r = analisarJogo(entradaValor({ linhas: linhasComValor(3.5, 1.3) }));
    expect(r.decisao).toBe('INVESTIGAR');
  });

  it('DQ D nunca vira BET', () => {
    const r = analisarJogo(entradaValor({ dq: 'D' }));
    expect(r.decisao).not.toBe('BET');
  });

  it('jogo iniciado → EXCLUÍDO', () => {
    const r = analisarJogo(entradaValor({ agora: '2026-10-21T16:05:00-03:00' }));
    expect(r.decisao).toBe('EXCLUIDO');
  });

  it('sem base para λ_market (uma linha só) → DQ E e ⛔ NO BET', () => {
    const umaLinha = oddsVillaViking().filter((l) => l.mercado === 'total' && l.linha === 2.5);
    const r = analisarJogo(entradaValor({ linhas: umaLinha }));
    expect(r.dq.efetiva).toBe('E');
    expect(r.decisao).toBe('NO_BET');
  });
});

describe('Data Quality pelas odds', () => {
  const uma = oddsSinteticas(LAMBDA_MERCADO);
  const duas = [...uma, ...oddsSinteticas(LAMBDA_MERCADO, { casa: 'Betano' })];
  it('uma casa só limita em C', () => expect(ajustarDQ('A', uma).dq).toBe('C'));
  it('A sem casa referência vira B', () => expect(ajustarDQ('A', duas).dq).toBe('B'));
  it('A com Pinnacle continua A', () => {
    expect(
      ajustarDQ('A', [...duas, ...oddsSinteticas(LAMBDA_MERCADO, { casa: 'Pinnacle' })]).dq,
    ).toBe('A');
  });
});

describe('validação de lado (regra 0.10, lição 2)', () => {
  it('handicap com odds trocadas gera aviso', () => {
    const linhas = oddsSinteticas({ casa: 2.6, fora: 0.8 }).map((l) => {
      if (l.mercado !== 'AH' || Math.abs(l.linha ?? 0) !== 2.5) return l;
      // troca as odds dos dois lados do AH ±2.5 (erro de leitura, como em Roma/Slovan)
      return { ...l, lado: l.lado === 'casa' ? 'fora' : 'casa', linha: -(l.linha as number) };
    });
    const r = analisarJogo({
      jogo: { casa: 'Roma', fora: 'Slovan', inicio: INICIO_VILLA },
      agora: AGORA,
      dq: 'C',
      lambdaModelo: { casa: 2.6, fora: 0.8 },
      linhas,
    });
    expect(r.avisos.some((a) => a.includes('invertido'))).toBe(true);
  });
});
