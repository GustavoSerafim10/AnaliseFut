import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerDesfalques, lerEscalacao } from '../src';

// SofaScore, Athletico-PR × Vasco (04/11/2026): texto lido pelo OCR do site em modo "lados"
const fx = (n: string) =>
  readFileSync(new URL(`./fixtures-reais/${n}.txt`, import.meta.url), 'utf8');
const jogo = { casa: 'Athletico', fora: 'Vasco' };

describe('SofaScore sem nome de time no print: esquerda = mandante, direita = visitante', () => {
  it('escalação: o cabeçalho da página (abas, "Hoje", filtros) não vira jogador', () => {
    const r = lerEscalacao(fx('escalacao-sofascore-athletico'), jogo);
    expect(r.casa.formacao).toBe('3-4-2-1');
    expect(r.fora.formacao).toBe('4-2-3-1');
    expect(r.casa.titulares).toHaveLength(10); // o goleiro (Mycael) não saiu no OCR
    expect(r.fora.titulares).toHaveLength(10); // nem o do Vasco (L. Jardim)
    expect(r.casa.titulares).toEqual(
      expect.arrayContaining(['L. Esquivel', 'Leozinho', 'J. Cruz']),
    );
    expect(r.fora.titulares).toEqual(
      expect.arrayContaining(['P. Henrique', 'B. Duarte', 'F. Colidio']),
    );
    for (const lixo of ['Hoje', 'Premiere', 'Fantasy', 'Nacionalidade'])
      expect([...r.casa.titulares, ...r.fora.titulares]).not.toContain(lixo);
  });

  it('desfalques "Contusões e suspensões" em duas colunas, sem árbitro nem treinadores', () => {
    const r = lerDesfalques(fx('desfalques-sofascore-athletico'), jogo);
    const de = (t: 'casa' | 'fora') => r.desfalques.filter((d) => d.time === t);
    expect(de('casa').map((d) => d.jogador)).toEqual(['Carlos Terán', 'Claudinho']);
    expect(de('fora').map((d) => d.jogador)).toEqual([
      'Marino Hinestroza',
      'Carlos Cuesta',
      'Mateus Carvalho',
    ]);
    expect(de('casa')[0].situacao).toBe('Decisão do clube');
    expect(de('fora')[1].situacao).toBe('Lesionado Anca');
    expect(r.avisos).toEqual([]);
  });
});
