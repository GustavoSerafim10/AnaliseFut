import { describe, expect, it } from 'vitest';
import { coresDaCamisa, lerEscalacao } from '../src';

/** Imagem 1000×200 de fundo escuro com uma camisa em listras verticais abaixo de (500, 50). */
function imagem(listra1: number[], listra2: number[]) {
  const data = new Uint8ClampedArray(1000 * 200 * 4);
  for (let y = 0; y < 200; y++)
    for (let x = 0; x < 1000; x++) {
      const i = (y * 1000 + x) * 4;
      const naCamisa = x >= 488 && x <= 512 && y >= 62 && y <= 92;
      const [r, g, b] = naCamisa ? (Math.floor(x / 6) % 2 ? listra1 : listra2) : [18, 22, 26];
      data.set([r, g, b, 255], i);
    }
  return { data, largura: 1000, altura: 200 };
}

describe('cores da camisa no print', () => {
  it('duas cores fortes: as duas', () => {
    const c = coresDaCamisa(imagem([220, 20, 30], [30, 60, 220]), 500, 50)!;
    expect([c.cor1, c.cor2].sort()).toEqual(['#1e3cdc', '#dc141e']);
  });
  it('listra preta não conta, porque é igual ao fundo do cartão', () => {
    const c = coresDaCamisa(imagem([220, 20, 30], [10, 10, 12]), 500, 50)!;
    expect(c.cor1).toBe('#dc141e');
    expect(c.cor2).toBeUndefined();
  });
  it('sem camisa (só fundo escuro): nada', () => {
    expect(coresDaCamisa(imagem([18, 22, 26], [18, 22, 26]), 500, 50)).toBeNull();
  });
});

describe('camisa no texto do OCR', () => {
  const texto = [
    '### POSICOES',
    '### MEIO x 500 0.9',
    '@400,60 3-4-3',
    '@600,60 4-2-3-1',
    '@300,300 A. Silva',
    '@700,300 B. Souza',
    '### CAMISA esquerda #dc141e #101010',
    '### CAMISA direita #0a8f3e',
  ].join('\n');
  it('esquerda = mandante, direita = visitante', () => {
    const r = lerEscalacao(texto, { casa: 'Time A', fora: 'Time B' });
    expect(r.casa.cores).toEqual({ cor1: '#dc141e', cor2: '#101010' });
    expect(r.fora.cores).toEqual({ cor1: '#0a8f3e' });
  });
});
