import { describe, expect, it } from 'vitest';
import { calcularLambdaContagem, pmfContagem } from '../src/contagens';
import { analisarJogo } from '../src/decisao';
import { descreverAposta } from '../src/descricao';
import { probEfetiva } from '../src/liquidacao';
import { criarLiquidador, criarModelo, distribuicaoModelo } from '../src/mercados';
import { precificar } from '../src/precificacao';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { varrerMercados } from '../src/varredura';
import { HORARIO_VILLA, INICIO_VILLA, oddsVillaViking } from './helpers';

const L = (o: Partial<LinhaOdd> & Pick<LinhaOdd, 'mercado' | 'lado'>): LinhaOdd => ({
  casa: '1win',
  odd: 2,
  periodo: 'FT',
  ...o,
});
const NOMES = { casa: 'Flamengo', fora: 'Atlético-MG' };
const ESCANTEIOS = { casa: 6.2, fora: 4.1 };
const modelo = criarModelo({ casa: 1.8, fora: 0.9 }, -0.08, 0.45, {
  escanteios: ESCANTEIOS,
  cartoes: { casa: 2.0, fora: 2.3 },
});
const p = (l: LinhaOdd) => {
  const r = criarLiquidador(l);
  if (!r.ok) throw new Error(r.motivo);
  return probEfetiva(distribuicaoModelo(r.liq, modelo));
};

describe('distribuição de contagem (binomial negativa)', () => {
  it('soma 1, média μ e variância φ·μ', () => {
    const pmf = pmfContagem(5, 1.25, 40);
    const soma = pmf.reduce((s, x) => s + x, 0);
    const media = pmf.reduce((s, x, k) => s + k * x, 0);
    const vari = pmf.reduce((s, x, k) => s + (k - media) ** 2 * x, 0);
    expect(soma).toBeCloseTo(1, 12);
    expect(media).toBeCloseTo(5, 4);
    expect(vari).toBeCloseTo(6.25, 2);
  });
  it('φ = 1 é Poisson', () => {
    expect(pmfContagem(2, 1, 20)[0]).toBeCloseTo(Math.exp(-2), 10);
  });
});

describe('λ de escanteios/cartões', () => {
  it('times na média da liga: média × mando', () => {
    const medio = { jogos: 12, favor: 5 };
    const r = calcularLambdaContagem('escanteios', medio, medio);
    expect(r.lambdas.casa).toBeCloseTo(5 * 1.1, 10);
    expect(r.lambdas.fora).toBeCloseTo(5 / 1.1, 10);
  });
  it('shrinkage puxa amostra curta para a média e usa o cedido quando existe', () => {
    const r = calcularLambdaContagem(
      'escanteios',
      { jogos: 8, favor: 7, contra: 4 },
      { jogos: 8, favor: 3, contra: 6 },
      { mando: 1 },
    );
    // ataque casa 0,5·7/5+0,5 = 1,2; defesa fora 0,5·6/5+0,5 = 1,1 → 5·1,2·1,1
    expect(r.lambdas.casa).toBeCloseTo(6.6, 10);
    expect(r.declaracoes.join(' ')).toContain('cedidos');
  });
});

describe('mercados de escanteios e cartões', () => {
  it('over + under do total de escanteios = 1 (meia linha)', () => {
    const over = p(L({ mercado: 'escanteios_total', lado: 'over', linha: 9.5 }));
    const under = p(L({ mercado: 'escanteios_total', lado: 'under', linha: 9.5 }));
    expect(over + under).toBeCloseTo(1, 10);
    expect(over).toBeGreaterThan(0.5); // λ total 10,3
  });
  it('1º tempo tem menos escanteios que o jogo todo', () => {
    const ft = p(L({ mercado: 'escanteios_total', lado: 'over', linha: 4.5 }));
    const t1 = p(L({ mercado: 'escanteios_total', lado: 'over', linha: 4.5, periodo: '1T' }));
    expect(t1).toBeLessThan(ft);
  });
  it('1X2 de cartões soma 1 e o time que leva mais cartões é favorito', () => {
    const lados = ['1', 'X', '2'].map((lado) => p(L({ mercado: 'cartoes_1x2', lado })));
    expect(lados.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
    expect(lados[2]).toBeGreaterThan(lados[0]);
  });
  it('primeiro escanteio: casa + fora ≈ 1 (sem escanteio devolve)', () => {
    const c = p(L({ mercado: 'primeiro_escanteio', lado: 'casa' }));
    const f = p(L({ mercado: 'primeiro_escanteio', lado: 'fora' }));
    expect(c + f).toBeCloseTo(1, 3);
    expect(c).toBeCloseTo(ESCANTEIOS.casa / (ESCANTEIOS.casa + ESCANTEIOS.fora), 3);
  });
  it('"Ganha se…" fala de escanteios, não de gols', () => {
    expect(descreverAposta(L({ mercado: 'escanteios_ah', lado: 'casa', linha: -3.5 }), NOMES)).toBe(
      'Ganha se: Flamengo ter pelo menos 4 escanteios a mais que Atlético-MG.',
    );
    expect(descreverAposta(L({ mercado: 'escanteios_ah', lado: 'fora', linha: 3.5 }), NOMES)).toBe(
      'Ganha se: Atlético-MG NÃO ter 4+ escanteios a menos que Flamengo.',
    );
    expect(descreverAposta(L({ mercado: 'cartoes_total', lado: 'under', linha: 4.5 }), NOMES)).toBe(
      'Ganha se: sair menos de 4,5 cartões amarelos.',
    );
  });
});

describe('nível 3 na varredura e na decisão', () => {
  const escanteios = (o: number, u: number): LinhaOdd[] => {
    const l = (mercado: TipoMercado, lado: string, odd: number, linha?: number): LinhaOdd => ({
      casa: '1win',
      mercado,
      lado,
      odd,
      linha,
      periodo: 'FT',
      horarioColeta: HORARIO_VILLA,
    });
    return [l('escanteios_total', 'over', o, 9.5), l('escanteios_total', 'under', u, 9.5)];
  };

  it('sem estatística de escanteios: descartado com motivo, não avaliado', () => {
    const v = varrerMercados(
      precificar(escanteios(1.9, 1.9)),
      criarModelo({ casa: 1.5, fora: 1 }),
      0.3,
      NOMES,
    );
    expect(v.avaliadas).toHaveLength(0);
    expect(v.descartados[0].motivo).toContain('sem estatísticas de escanteios');
  });

  it('com λ de escanteios: avaliado como nível 3, w limitado a 0,30 e tese própria', () => {
    const v = varrerMercados(precificar(escanteios(1.9, 1.9)), modelo, 0.5, NOMES);
    const over = v.avaliadas.find((a) => a.linha.lado === 'over')!;
    expect(over.nivel).toBe(3);
    expect(over.w).toBe(0.3);
    expect(over.tese).toBe('escanteios_mais');
  });

  it('na decisão o nível 3 soma +1 pp no gate e a sensibilidade varia o λ de escanteios', () => {
    const r = analisarJogo({
      jogo: { casa: 'Aston Villa', fora: 'Viking', inicio: INICIO_VILLA },
      agora: '2026-10-21T10:00:00-03:00',
      dq: 'B',
      lambdaModelo: { casa: 2.6, fora: 1.0 },
      lambdasContagem: { escanteios: { casa: 7.5, fora: 4.5 } },
      // escanteios bem baratos para o modelo: o candidato vira o over 9.5
      linhas: [...oddsVillaViking(), ...escanteios(2.05, 1.78)],
    });
    expect(r.melhor?.linha.mercado).toBe('escanteios_total');
    expect(r.melhor?.w).toBe(0.3);
    // DQ efetiva C (uma casa só): gate 4% + 1 pp do nível 3
    expect(r.melhor?.evMinimo).toBeCloseTo(0.05, 10);
    expect(r.sensibilidade?.cenarios[0].nome).toContain('λ escanteios');
    expect(r.lambdasContagem.escanteios).toEqual({ casa: 7.5, fora: 4.5 });
  });
});
