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
    // os goleiros vêm da leitura extra do canto do gol (o nome fica em cima da linha da área)
    expect(r.casa.titulares).toHaveLength(11);
    expect(r.fora.titulares).toHaveLength(11);
    expect(r.casa.titulares[0]).toBe('Mycael');
    expect(r.fora.titulares[0]).toBe('L. Jardim');
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

describe('campo do site repete o desenho do print', () => {
  const r = lerEscalacao(fx('escalacao-sofascore-athletico'), jogo);
  it('formação pelas colunas do campo (o OCR leu "4-2-5-1" no navegador)', () => {
    expect(r.casa.formacao).toBe('3-4-2-1');
    expect(r.fora.formacao).toBe('4-2-3-1');
  });
  it('posições: mandante na metade esquerda, visitante na direita, centroavante perto do meio', () => {
    const p = (l: 'casa' | 'fora', n: string) => r[l].posicoes!.find((x) => x.nome.includes(n))!;
    expect(r.casa.posicoes!.every((x) => x.x < 50)).toBe(true);
    expect(r.fora.posicoes!.every((x) => x.x > 50)).toBe(true);
    expect(p('casa', 'Viveros').x).toBeGreaterThan(p('casa', 'Aquirre').x);
    expect(p('fora', 'B. Duarte').x).toBeLessThan(p('fora', 'Renan').x);
    // mesma coluna no print, mesma coluna no site
    expect(p('casa', 'L. Esquivel').x).toBe(p('casa', 'A. Dias').x);
  });
});

describe('segundo print do mesmo campo (lido no navegador do usuário)', () => {
  const r = lerEscalacao(fx('escalacao-sofascore-athletico-2'), jogo);
  it('"19B.Duarte 22 A. Lescano": camisa grudada e dois jogadores na mesma linha', () => {
    expect(r.fora.titulares).toEqual(expect.arrayContaining(['B. Duarte', 'A. Lescano']));
    expect(r.fora.titulares).toHaveLength(11);
  });
  it('goleiros no gol, e pedaços do recorte ("Renan", "enrique", "Athl.") não viram goleiro', () => {
    expect(r.casa.titulares[0]).toBe('Mycael');
    expect(r.fora.titulares[0]).toBe('L. Jardim');
    expect(r.casa.posicoes!.find((p) => p.nome === 'Mycael')).toMatchObject({ x: 4, y: 50 });
    expect(r.fora.posicoes!.find((p) => p.nome === 'L. Jardim')).toMatchObject({ x: 96, y: 50 });
  });
  it('"Aquirre Q" (lixo no fim) não vira coluna própria: 3-4-2-1 e Aguirre alinhado à defesa', () => {
    expect(r.casa.formacao).toBe('3-4-2-1');
    const x = (n: string) => r.casa.posicoes!.find((p) => p.nome.includes(n))!.x;
    expect(x('Aquirre')).toBe(x('Esquivel'));
  });
});

describe('leitura atual do site (camisa grudada separada pela posição das palavras)', () => {
  it('os 22, com os goleiros, e B. Duarte separado de A. Lescano', () => {
    const r = lerEscalacao(fx('escalacao-sofascore-athletico-3'), jogo);
    expect(r.casa.titulares).toHaveLength(11);
    expect(r.fora.titulares).toHaveLength(11);
    expect([r.casa.formacao, r.fora.formacao]).toEqual(['3-4-2-1', '4-2-3-1']);
    const x = (n: string) => r.fora.posicoes!.find((p) => p.nome.includes(n))!.x;
    expect(x('Lescano') - x('Duarte')).toBeGreaterThan(5);
  });
});

describe('lixo do OCR completando 11 (print do usuário, 04/11 à noite)', () => {
  const base = fx('escalacao-sofascore-athletico-4');
  const comLixo = base.replace('@357,767 21 Leozinho', '@357,767 21 Leozinho\n@352,742 Ta');
  it('a defesa na mesma coluna não vira goleiro; o goleiro vem do canto e o lixo sai', () => {
    for (const t of [base, comLixo]) {
      const r = lerEscalacao(t, { casa: 'Athlético Pr', fora: 'Vasco' });
      expect(r.casa.titulares[0]).toBe('Mycael');
      expect(r.casa.titulares).toHaveLength(11);
      expect(r.casa.titulares).not.toContain('Ta');
      expect(r.casa.formacao).toBe('3-4-2-1');
      const noGol = r.casa.posicoes!.filter((p) => p.x < 10).map((p) => p.nome);
      expect(noGol).toEqual(['Mycael']);
      expect(r.fora.titulares[0]).toBe('L. Jardim');
    }
  });
});
