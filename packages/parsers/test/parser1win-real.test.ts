import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checarSanidade, juntarLinhas, parse1win, parse1winVarios } from '../src';

const fx = (nome: string) =>
  readFileSync(new URL(`./fixtures-reais/${nome}`, import.meta.url), 'utf8');
const ctx = {
  jogo: { casa: 'Flamengo', fora: 'Atlético-MG' },
  data: '2026-10-26',
  horarioPadrao: '2026-10-26T16:13:00-03:00',
};
const PRINTS = [
  '1win-principal-1.txt',
  '1win-totais-handicap.txt',
  '1win-handicap-ambas.txt',
  '1win-totais-por-time.txt',
  '1win-principal-3.txt',
  '1win-handicap-1t.txt',
  '1win-escanteios.txt',
  '1win-cartoes.txt',
];
const leituras = PRINTS.map((p) => parse1win(fx(p), ctx));
const conjunto = parse1winVarios(PRINTS.map(fx), ctx);
const { linhas } = juntarLinhas(conjunto.linhas);

const odd = (f: Partial<(typeof linhas)[number]>) =>
  linhas
    .filter((l) => Object.entries(f).every(([k, v]) => l[k as keyof typeof l] === v))
    .map((l) => l.odd);

// Valores conferidos à mão nos prints da 1win (Flamengo × Atlético-MG, 26/10/2026)
describe('1win — prints reais', () => {
  it('1X2 com rótulos numa linha e odds na de baixo', () => {
    expect(odd({ mercado: '1X2', periodo: 'FT', lado: '1' })).toEqual([1.26]);
    expect(odd({ mercado: '1X2', periodo: 'FT', lado: 'X' })).toEqual([5.7]);
    expect(odd({ mercado: '1X2', periodo: 'FT', lado: '2' })).toEqual([12.4]);
  });
  it('"Vitória antecipada" NÃO vira 1X2 (liquidação diferente)', () => {
    expect(odd({ mercado: '1X2', periodo: 'FT' })).toHaveLength(3);
    expect(odd({ mercado: '1X2' })).not.toContain(3.6);
    expect(odd({ mercado: '1X2' })).not.toContain(12.03);
  });
  it('dupla chance, com o ponto decimal perdido corrigido ("113" → 1.13)', () => {
    expect(odd({ mercado: 'DC', periodo: 'FT', lado: '1X' })).toEqual([1.03]);
    expect(odd({ mercado: 'DC', periodo: 'FT', lado: '12' })).toEqual([1.13]);
    expect(odd({ mercado: 'DC', periodo: 'FT', lado: 'X2' })).toEqual([3.84]);
  });
  it('totais, inclusive "AcimaDel5" → Acima De 1.5', () => {
    expect(odd({ mercado: 'total', periodo: 'FT', linha: 1.5, lado: 'over' })).toEqual([1.18]);
    expect(odd({ mercado: 'total', periodo: 'FT', linha: 2.5, lado: 'under' })).toEqual([2.4]);
    expect(odd({ mercado: 'total', periodo: 'FT', linha: 2.5, lado: 'over' })).toEqual([1.58]);
    expect(odd({ mercado: 'total', periodo: 'FT', linha: 3, lado: 'under' })).toEqual([1.94]);
    expect(odd({ mercado: 'total', periodo: 'FT', linha: 5, lado: 'under' })).toEqual([1.11]);
    expect(odd({ mercado: 'total', periodo: 'FT', linha: 6.5, lado: 'over' })).toEqual([13.2]);
  });
  it('total de cartões NÃO vira total de gols', () => {
    expect(odd({ mercado: 'total', linha: 3.5, lado: 'under' })).toEqual([1.59]);
  });
  it('handicap asiático dos dois lados, inclusive linha 0 lida como "O"', () => {
    expect(odd({ mercado: 'AH', periodo: 'FT', lado: 'casa', linha: -1.5 })).toEqual([1.74]);
    expect(odd({ mercado: 'AH', periodo: 'FT', lado: 'fora', linha: 1.5 })).toEqual([2.07]);
    expect(odd({ mercado: 'AH', periodo: 'FT', lado: 'casa', linha: 0 })).toEqual([1.03]);
    expect(odd({ mercado: 'AH', periodo: 'FT', lado: 'fora', linha: 0 })).toEqual([8.0]);
    expect(odd({ mercado: 'AH', periodo: 'FT', lado: 'fora', linha: 0.25 })).toEqual([5.1]);
  });
  it('handicap do 1º tempo, inclusive "Atlético-MG1 1.49"', () => {
    expect(odd({ mercado: 'AH', periodo: '1T', lado: 'casa', linha: -0.5 })).toEqual([1.66]);
    expect(odd({ mercado: 'AH', periodo: '1T', lado: 'fora', linha: 1 })).toEqual([1.49]);
  });
  it('gols por time', () => {
    expect(odd({ mercado: 'total_time', time: 'casa', linha: 2.5, lado: 'over' })).toEqual([2.05]);
    expect(odd({ mercado: 'total_time', time: 'casa', linha: 4.5, lado: 'under' })).toEqual([1.1]);
    expect(odd({ mercado: 'total_time', time: 'fora', linha: 0.5, lado: 'under' })).toEqual([1.86]);
    expect(odd({ mercado: 'total_time', time: 'fora', linha: 1.5, lado: 'over' })).toEqual([5.5]);
  });
  it('ambas, par/ímpar, primeiro gol, 1X2 do 1º tempo', () => {
    expect(odd({ mercado: 'ambas', lado: 'sim' })).toEqual([2.08]);
    expect(odd({ mercado: 'ambas', lado: 'nao' })).toEqual([1.76]);
    expect(odd({ mercado: 'par_impar', lado: 'impar' })).toEqual([2.0]);
    expect(odd({ mercado: 'primeiro_gol', lado: 'nenhum' })).toEqual([15.0]);
    expect(odd({ mercado: '1X2', periodo: '1T', lado: '2' })).toEqual([9.5]);
    expect(odd({ mercado: 'DC', periodo: '1T', lado: 'X2' })).toEqual([2.15]);
  });
  it('escanteios ficam como nível 3 (lidos, não confundidos com gols)', () => {
    expect(odd({ mercado: 'escanteios_total', linha: 10.5, lado: 'over' })).toEqual([1.88]);
    expect(odd({ mercado: 'escanteios_time', time: 'casa', linha: 7.5, lado: 'over' })).toEqual([
      2.02,
    ]);
    expect(odd({ mercado: 'escanteios_ah', periodo: '1T', lado: 'casa', linha: -2.5 })).toEqual([
      2.13,
    ]);
  });
  it('ponto perdido com duas leituras: a margem decide ("112 11 51" → 1.12 / 11.0 / 5.1)', () => {
    expect(odd({ mercado: 'escanteios_1x2', lado: '1' })).toEqual([1.12]);
    expect(odd({ mercado: 'escanteios_1x2', lado: 'X' })).toEqual([11]);
    expect(odd({ mercado: 'escanteios_1x2', lado: '2' })).toEqual([5.1]);
    // "21" no total de cartões continua 2.1 (21.0 deixaria a margem negativa)
    expect(odd({ mercado: 'cartoes_total', linha: 3.5, lado: 'under' })).toEqual([2.1]);
  });
  it('cartões amarelos: total e resultado viram mercados de cartões, nunca de gols', () => {
    expect(odd({ mercado: 'cartoes_total', linha: 4.5, lado: 'over' })).toEqual([2.52]);
    expect(odd({ mercado: 'cartoes_1x2', lado: '1' })).toEqual([3.15]);
    expect(odd({ mercado: 'cartoes_1x2', lado: '2' })).toEqual([1.85]);
    expect(odd({ mercado: 'total', linha: 4.5, lado: 'over' })).not.toContain(2.52);
  });
  it('usa o horário do arquivo quando a barra de status é ilegível', () => {
    expect(leituras[0].horarioColeta).toBe('2026-10-26T16:13:00-03:00');
    expect(leituras[0].avisos.join()).toContain('horário do arquivo');
  });
  it('print que começa no meio do handicap herda o mercado pela linha repetida, em qualquer ordem', () => {
    const sozinho = parse1win(fx('1win-handicap-ambas.txt'), ctx);
    expect(sozinho.linhas.filter((l) => l.mercado === 'AH')).toHaveLength(0);
    expect(sozinho.orfas.length).toBeGreaterThan(10);
    const invertido = parse1winVarios([...PRINTS].reverse().map(fx), ctx);
    expect(
      invertido.linhas.filter((l) => l.mercado === 'AH' && l.periodo === 'FT' && l.linha === -0.75),
    ).toHaveLength(1);
  });
  it('bloco sem título e sem linha repetida continua "não lido" (nunca chuta)', () => {
    const r = parse1winVarios([fx('1win-handicap-ambas.txt')], ctx);
    expect(r.linhas.some((l) => l.mercado === 'AH')).toBe(false);
    expect(r.orfas.length).toBeGreaterThan(10);
  });
  it('primeiro cartão, dupla chance de cartões, red card e "vencer a partir de desvantagem" são ignorados de propósito', () => {
    expect(leituras[7].ignoradas).toBeGreaterThan(0);
    // "Vencer a partir de desvantagem" (34.0) e "red card: Sim 3.36" não podem virar outro mercado
    expect(linhas.some((l) => l.odd === 34.0)).toBe(false);
    expect(odd({ mercado: 'ambas', lado: 'sim' })).toEqual([2.08]);
  });
});

// Frosinone × Lecce (29/10/2026): 12 prints do celular; o 1X2 chega limpo ao motor
describe('1win — Frosinone × Lecce', () => {
  const ctxF = {
    jogo: { casa: 'Frosinone', fora: 'Lecce' },
    data: '2026-10-29',
    horarioPadrao: '2026-10-29T14:30:00-03:00',
  };
  const textos = Array.from({ length: 12 }, (_, i) => fx(`1win-frosinone-${i + 9}.txt`));
  const { linhas: ls } = juntarLinhas(parse1winVarios(textos, ctxF).linhas);
  const erros = new Set(
    checarSanidade(ls)
      .filter((p) => p.nivel === 'erro')
      .map((p) => p.indice),
  );
  it('1X2 lido e sem erro de sanidade', () => {
    const x = ls.map((l, i) => ({ l, i })).filter(({ l }) => l.mercado === '1X2');
    expect(x.map(({ l }) => l.odd)).toEqual([1.72, 4.18, 4.39]);
    expect(x.some(({ i }) => erros.has(i))).toBe(false);
  });
  it('leituras erradas do OCR ficam de fora (Lecce -0,75 @ 9.9, "acima de 11,5" gols)', () => {
    const errado = (f: (l: (typeof ls)[number]) => boolean) => ls.findIndex((l) => f(l));
    expect(
      erros.has(errado((l) => l.mercado === 'AH' && l.periodo === '1T' && l.odd === 9.9)),
    ).toBe(true);
    expect(erros.has(errado((l) => l.mercado === 'total' && l.linha === 11.5))).toBe(true);
  });
});
