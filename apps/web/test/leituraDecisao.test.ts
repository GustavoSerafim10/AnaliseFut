/**
 * Leitura da decisão (só exibição): "EV só pelo mercado" no R3 e aviso de liga principal sem a
 * caixinha "Liga bem coberta". Cenário real pelo motor: o jogo de exemplo com UMA casa só.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { blend } from '@pe/engine';
import { describe, expect, it, vi } from 'vitest';
import { CentroDecisao } from '../src/componentes/CentroDecisao';
import { derivar } from '../src/dados';
import type { Rascunho } from '../src/estado';
import { rascunhoExemplo } from '../src/exemplo';
import { avisoLigaPrincipal, evSoMercado, pareceLigaPrincipal } from '../src/leituraDecisao';

/** o exemplo só com a Superbet (sem casa afiada, sem 4+ casas) e a competição dada */
function umaCasa(competicao: string, ligaTop: boolean): Rascunho {
  vi.useFakeTimers({ now: new Date('2026-11-24T15:00:00Z'), toFake: ['Date'] });
  const r = rascunhoExemplo();
  vi.useRealTimers();
  return {
    ...r,
    jogo: { ...r.jogo, competicao },
    casas: ['Superbet'],
    odds: r.odds.filter((o) => o.casa === 'Superbet'),
    config: { ...r.config, ligaTop },
  };
}
const derivarEm = (r: Rascunho) => {
  vi.useFakeTimers({ now: new Date('2026-11-24T15:00:00Z'), toFake: ['Date'] });
  try {
    return derivar(r);
  } finally {
    vi.useRealTimers();
  }
};

describe('EV só pelo mercado', () => {
  it('conta à mão: 6,6 × 13,7% − 1 = −9,6% (o caso do Dortmund)', () => {
    const ev = evSoMercado({
      nivel: 'R3',
      wModelo: 0.3,
      pConsenso: 0.137,
      oddEfetiva: 6.6,
      emRisco: 1,
    });
    expect(ev).toBeCloseTo(6.6 * 0.137 - 1, 12);
  });

  it('só existe quando o modelo entrou no preço (R3 com peso)', () => {
    const base = { pConsenso: 0.5, oddEfetiva: 2, emRisco: 1 };
    expect(evSoMercado({ ...base, nivel: 'R1', wModelo: null })).toBeNull();
    expect(evSoMercado({ ...base, nivel: 'R2', wModelo: null })).toBeNull();
    expect(evSoMercado({ ...base, nivel: 'R3', wModelo: 0 })).toBeNull();
    expect(evSoMercado({ ...base, nivel: 'R3', wModelo: null })).toBeNull();
  });

  it('pelo motor: é exatamente o EV da V4 com o peso do modelo zerado', () => {
    const d = derivarEm(umaCasa('Exemplo', false));
    const r3 = d.v4!.avaliadas.filter((a) => a.nivel === 'R3' && a.wModelo);
    expect(r3.length).toBeGreaterThan(0);
    for (const a of r3) {
      // o EV do motor é a mistura; o "só mercado" é a mesma conta com w = 0
      expect(a.ev).toBeCloseTo(
        a.emRisco * (blend(a.pModelo!, a.pConsenso, a.wModelo!) * a.oddEfetiva - 1),
        12,
      );
      expect(evSoMercado(a)).toBeCloseTo(
        a.emRisco * (blend(a.pModelo!, a.pConsenso, 0) * a.oddEfetiva - 1),
        12,
      );
    }
  });
});

describe('liga principal sem a caixinha', () => {
  it.each([
    'UEFA Champions League',
    'Champions League - Fase de liga',
    'Premier League',
    'LaLiga',
    'Bundesliga',
    'Serie A',
    'Brasileirão Série A',
    'Ligue 1',
    'Copa Libertadores',
    'Copa do Mundo',
  ])('%s parece principal', (c) => expect(pareceLigaPrincipal(c)).toBe(true));

  it.each([
    'Brasileirão Série B',
    'Série C',
    '2. Bundesliga',
    'Championship',
    'Ligue 2',
    'Serie A Feminina',
    'Exemplo',
    '',
    null,
  ])('%s não parece principal', (c) => expect(pareceLigaPrincipal(c)).toBe(false));

  it('aviso só com liga grande E caixinha desmarcada', () => {
    expect(avisoLigaPrincipal('Champions League', false)).toContain(
      '"Champions League" parece liga principal',
    );
    expect(avisoLigaPrincipal('Champions League', true)).toBeNull();
    expect(avisoLigaPrincipal('Série C', false)).toBeNull();
  });

  it('pelo motor: marcar a caixinha tira o R3 dos mercados principais (lição 3)', () => {
    const sem = derivarEm(umaCasa('Champions League', false)).v4!;
    const com = derivarEm(umaCasa('Champions League', true)).v4!;
    expect(sem.avaliadas.some((a) => a.nivel === 'R3' && a.nivelMercado !== 3)).toBe(true);
    expect(com.avaliadas.some((a) => a.nivel === 'R3' && a.nivelMercado !== 3)).toBe(false);
  });
});

describe('card da decisão', () => {
  it('R3 numa liga grande sem a caixinha: mostra o EV só pelo mercado e o aviso', () => {
    const r = umaCasa('Champions League', false);
    const d = derivarEm(r);
    const m = d.v4!.melhor;
    expect(m?.nivel).toBe('R3');
    const html = renderToString(createElement(CentroDecisao, { d, r }));
    expect(html).toContain('EV só pelo mercado');
    expect(html).toContain('parece liga principal');
  });

  it('com referência de verdade (R1, exemplo completo): nada disso aparece', () => {
    vi.useFakeTimers({ now: new Date('2026-11-24T15:00:00Z'), toFake: ['Date'] });
    const r = {
      ...rascunhoExemplo(),
      jogo: { ...rascunhoExemplo().jogo, competicao: 'Champions League' },
    };
    const d = derivar(r);
    vi.useRealTimers();
    expect(d.v4!.melhor?.nivel).toBe('R1');
    const html = renderToString(createElement(CentroDecisao, { d, r }));
    expect(html).not.toContain('EV só pelo mercado');
    expect(html).not.toContain('parece liga principal');
  });
});
