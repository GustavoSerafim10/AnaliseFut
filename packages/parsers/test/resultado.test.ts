import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerResultado } from '../src/resultado';

const fx = (nome: string) =>
  readFileSync(new URL(`./fixtures-reais/${nome}`, import.meta.url), 'utf8');
const jogo = (n: string) =>
  lerResultado([fx(`resultado-${n}-stats.txt`), fx(`resultado-${n}-fluxo.txt`)]);

// prints reais do SofaScore de 29/10/2026 (estatísticas + fluxo); valores conferidos à mão
describe('resultado do SofaScore (prints reais)', () => {
  it('Vasco 1×4 Flamengo: o "4" dos escanteios saiu "uy" e fica vazio', () => {
    const r = jogo('vasco');
    expect(r.placar).toEqual({ casa: 1, fora: 4 });
    expect(r.intervalo).toEqual({ casa: 1, fora: 2 });
    expect(r.escanteios).toEqual({ casa: 6, fora: undefined });
    expect(r.amarelos).toEqual({ casa: 0, fora: 2 });
    expect(r.faltando).toEqual(['escanteios']);
  });
  it('Athletico 1×3 Vasco (04/11)', () => {
    const r = jogo('athletico');
    expect(r.placar).toEqual({ casa: 1, fora: 3 });
    expect(r.intervalo).toEqual({ casa: 1, fora: 0 });
    expect(r.escanteios).toEqual({ casa: 7, fora: 0 });
    expect(r.amarelos).toEqual({ casa: 3, fora: 1 });
    expect(r.vermelhos).toEqual({ casa: 1, fora: 0 });
    expect(r.faltando).toEqual([]);
  });
  it('Atlético-MG 0×1 Cruzeiro', () => {
    const r = jogo('atletico');
    expect(r.placar).toEqual({ casa: 0, fora: 1 });
    expect(r.intervalo).toEqual({ casa: 0, fora: 1 });
    expect(r.escanteios).toEqual({ casa: 7, fora: 2 });
    expect(r.amarelos).toEqual({ casa: 2, fora: 6 });
    expect(r.faltando).toEqual([]);
  });
  it('Fiorentina 2×2 Atalanta', () => {
    const r = jogo('fiorentina');
    expect(r.placar).toEqual({ casa: 2, fora: 2 });
    expect(r.intervalo).toEqual({ casa: 0, fora: 1 });
    expect(r.escanteios).toEqual({ casa: 8, fora: 2 });
    expect(r.amarelos).toEqual({ casa: 3, fora: 2 });
  });
  it('Grêmio 2×0 Athletico: página larga, amarelos do Grêmio ilegíveis', () => {
    const r = jogo('gremio');
    expect(r.placar).toEqual({ casa: 2, fora: 0 });
    expect(r.intervalo).toEqual({ casa: 1, fora: 0 });
    expect(r.escanteios).toEqual({ casa: 6, fora: 8 });
    expect(r.amarelos).toEqual({ casa: undefined, fora: 3 });
  });
  it('Frosinone 5×1 Lecce', () => {
    const r = jogo('frosinone');
    expect(r.placar).toEqual({ casa: 5, fora: 1 });
    expect(r.intervalo).toEqual({ casa: 2, fora: 0 });
    expect(r.escanteios).toEqual({ casa: 10, fora: 3 });
    expect(r.amarelos).toEqual({ casa: 0, fora: 3 });
  });
  it('só o print das estatísticas: placar do topo quando o OCR pega', () => {
    expect(lerResultado([fx('resultado-fiorentina-stats.txt')]).placar).toEqual({
      casa: 2,
      fora: 2,
    });
  });
});
