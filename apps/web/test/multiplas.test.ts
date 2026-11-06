import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MontarMultipla, PainelMultiplas } from '../src/componentes/MontarMultipla';
import type { EntradaHistorico } from '../src/historico';
import { travasDoHistorico } from '../src/historico';
import {
  apostasDeMultiplas,
  apurarMultipla,
  balancoMultiplas,
  juntarMultiplas,
  juntarPerna,
  resumirMultipla,
  type Multipla,
  type PernaMultipla,
} from '../src/multiplas';

const ou = (lado: 'over' | 'under', linha: number, odd: number) => ({
  casa: 'CasaDeApostas',
  mercado: 'total' as const,
  lado,
  linha,
  odd,
  periodo: 'FT' as const,
});
const perna = (
  jogo: string,
  linha: PernaMultipla['linha'],
  odd: number,
  m: Partial<PernaMultipla> = {},
): PernaMultipla => ({
  jogo,
  inicio: '2099-11-06T17:00:00-03:00',
  linha,
  descricao: `aposta em ${jogo}`,
  odd,
  casa: 'CasaDeApostas',
  chanceGreen: 0.6,
  ev: 0.02,
  temEstimativa: true,
  ...m,
});
const A = perna('A × B', ou('under', 3.5, 1.5), 1.5);
const C = perna('C × D', ou('over', 1.5, 1.4), 1.4);
const multipla = (m: Partial<Multipla> = {}): Multipla => ({
  id: 'm1',
  criadaEm: '2099-11-06T10:00:00-03:00',
  odd: 2.1,
  casa: 'CasaDeApostas',
  valor: 2,
  pernas: [A, C],
  ...m,
});
const jogo = (nome: string, casa?: number, fora?: number): EntradaHistorico =>
  ({
    id: nome,
    salvoEm: 'x',
    rascunho: {},
    resumo: { jogo: nome, inicio: A.inicio, motivos: [] },
    resultado:
      casa === undefined ? undefined : { casa, fora, registradoEm: `2099-11-06T2${casa}:00` },
  }) as unknown as EntradaHistorico;

describe('montagem', () => {
  it('multiplica as odds e as chances', () => {
    const r = resumirMultipla([A, C]);
    expect(r.odd).toBe(2.1);
    expect(r.chance).toBeCloseTo(0.36);
    expect(r.minimo).toBeCloseTo(1 / 2.1);
    expect(r.ev).toBeCloseTo(1.02 * 1.02 - 1);
  });
  it('sem estimativa em uma perna, não inventa a chance do bilhete', () => {
    const r = resumirMultipla([A, { ...C, temEstimativa: false }]);
    expect(r.chance).toBeNull();
    expect(r.ev).toBeNull();
    expect(r.odd).toBe(2.1);
  });
  it('não junta duas apostas do mesmo jogo', () => {
    const r = juntarPerna([A], perna('A × B', ou('over', 2.5, 1.9), 1.9));
    expect(r.pernas).toHaveLength(1);
    expect(r.erro).toMatch(/mesmo jogo/);
    expect(juntarPerna([A], C).pernas).toHaveLength(2);
  });
  it('o mesmo nome em outro dia é outro jogo', () => {
    const volta = perna('A × B', ou('over', 2.5, 1.9), 1.9, { inicio: '2099-12-01T17:00:00-03:00' });
    expect(juntarPerna([A], volta).pernas).toHaveLength(2);
  });
});

describe('apuração', () => {
  it('fica pendente até o último placar', () => {
    const a = apurarMultipla(multipla(), [jogo('A × B', 1, 0), jogo('C × D')]);
    expect(a.situacao).toBe('pendente');
    expect(a.lucro).toBeUndefined();
    expect(a.pernas[0].situacao).toBe('green');
    expect(a.pernas[1].falta).toMatch(/placar/);
  });
  it('todas certas: paga a odd que o usuário pegou', () => {
    const a = apurarMultipla(multipla({ odd: 2.2 }), [jogo('A × B', 1, 0), jogo('C × D', 2, 1)]);
    expect(a.situacao).toBe('green');
    expect(a.lucro).toBeCloseTo(1.2);
  });
  it('uma perna perdida encerra o bilhete, mesmo com jogo pendente', () => {
    const a = apurarMultipla(multipla(), [jogo('A × B', 3, 2), jogo('C × D')]);
    expect(a.situacao).toBe('red');
    expect(a.lucro).toBe(-1);
  });
  it('perna devolvida sai da conta e o bilhete paga as outras', () => {
    const empate = perna('A × B', { ...ou('over', 2, 1.8), linha: 2 }, 1.8);
    const a = apurarMultipla(multipla({ pernas: [empate, C], odd: 2.52 }), [
      jogo('A × B', 1, 1),
      jogo('C × D', 2, 1),
    ]);
    expect(a.pernas[0].situacao).toBe('devolvida');
    expect(a.situacao).toBe('green');
    expect(a.lucro).toBeCloseTo(0.4);
  });
  it('tudo devolvido devolve o dinheiro', () => {
    const empate = perna('A × B', { ...ou('over', 2, 1.8), linha: 2 }, 1.8);
    const a = apurarMultipla(multipla({ pernas: [empate], odd: 1.8 }), [jogo('A × B', 1, 1)]);
    expect(a.situacao).toBe('devolvida');
    expect(a.lucro).toBeCloseTo(0);
  });
  it('balanço separa green, red e pendentes', () => {
    const h = [jogo('A × B', 1, 0), jogo('C × D', 2, 1), jogo('E × F', 3, 2)];
    const E = perna('E × F', ou('under', 3.5, 1.5), 1.5);
    const b = balancoMultiplas(
      [
        multipla(),
        multipla({ id: 'm2', pernas: [E, C] }),
        multipla({ id: 'm3', pernas: [A, perna('G × H', ou('over', 1.5, 1.4), 1.4)] }),
      ],
      h,
    );
    expect(b).toMatchObject({ total: 3, green: 1, red: 1, pendentes: 1 });
    expect(b.unidades).toBeCloseTo(1.1 - 1);
  });
});

describe('banca e backup', () => {
  it('a múltipla com valor entra nas travas', () => {
    const apostas = apostasDeMultiplas([multipla()], [jogo('A × B', 3, 2)]);
    expect(apostas[0]).toMatchObject({ stake: 2, lucro: -1 });
    const t = travasDoHistorico([], 100, '2099-11-06T23:00:00-03:00', apostas);
    expect(t.bancaAtual).toBe(98);
  });
  it('sem valor não mexe na banca', () => {
    expect(apostasDeMultiplas([multipla({ valor: undefined })], [])).toEqual([]);
  });
  it('backup junta sem duplicar', () => {
    const r = juntarMultiplas([multipla()], [multipla(), multipla({ id: 'm2' })]);
    expect(r.map((m) => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('telas', () => {
  const nada = () => undefined;
  it('montando: mostra odd total, chance e o botão de registrar', () => {
    const html = renderToString(
      createElement(MontarMultipla, {
        pernas: [A, C],
        onRemover: nada,
        onLimpar: nada,
        onRegistrar: nada,
      }),
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('Odd total');
    expect(html).toContain('2,10');
    expect(html).toContain('36,0%');
    expect(html).toContain('Entrei nessa múltipla');
  });
  it('com uma perna pede a segunda, e vazia não aparece', () => {
    const uma = renderToString(
      createElement(MontarMultipla, {
        pernas: [A],
        onRemover: nada,
        onLimpar: nada,
        onRegistrar: nada,
      }),
    );
    expect(uma).toContain('adicione mais uma aposta');
    expect(uma).not.toContain('Entrei nessa múltipla');
    expect(
      renderToString(
        createElement(MontarMultipla, {
          pernas: [],
          onRemover: nada,
          onLimpar: nada,
          onRegistrar: nada,
        }),
      ),
    ).toBe('');
  });
  it('Histórico mostra cada perna com o resultado', () => {
    const html = renderToString(
      createElement(PainelMultiplas, {
        multiplas: [multipla()],
        historico: [jogo('A × B', 1, 0)],
        onApagar: nada,
      }),
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('Múltiplas (1)');
    expect(html).toContain('aposta em A × B');
    expect(html).toContain('registrar o placar');
  });
});
