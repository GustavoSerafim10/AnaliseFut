import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  juntarEscalacoes,
  lerEscalacao,
  lerEstatisticas,
  MARCA_DIREITA,
  MARCA_ESQUERDA,
  mesmoJogador,
  nomeDeJogador,
} from '../src';

const jogo = { casa: 'Remo', fora: 'Botafogo' };

// formato do OCR em modo "lados" (cada metade lida em separado, texto esparso)
const PRINT = [
  'Escalações prováveis',
  MARCA_ESQUERDA,
  'Remo',
  '4-3-3',
  '1 Marcelo Rangel 6.9',
  '2 Marcelinho',
  '3 Klaus',
  'Camutanga 7.0',
  '6 Sávio',
  '8 Caio Vinícius',
  '10 Régis',
  '| Jaderson',
  'Pedro Rocha',
  '9 Nicolás Ferreira',
  '11 Janderson',
  'Substitutos',
  'Ygor Vinhas',
  'Treinador',
  'António Oliveira',
  MARCA_DIREITA,
  'Botafogo',
  '4-2-3-1',
  'John',
  'Vitinho 7.1',
  'Barboza',
  'Alexander Barboza',
  'Cuiabano',
  'Gregore',
  'Marlon Freitas',
  'Savarino',
  'Artur',
  'Matheus Martins',
  'Igor Jesus',
  'Substitutos',
  'Léo Linck',
].join('\n');

describe('escalação (SofaScore, OCR em duas metades)', () => {
  const l = lerEscalacao(PRINT, jogo);
  it('esquerda = mandante, direita = visitante', () => {
    expect(l.casa.titulares).toContain('Marcelo Rangel');
    expect(l.fora.titulares).toContain('Igor Jesus');
    expect(l.ladosInvertidos).toBe(false);
  });
  it('lê formação, reservas, técnico e status', () => {
    expect(l.casa.formacao).toBe('4-3-3');
    expect(l.fora.formacao).toBe('4-2-3-1');
    expect(l.casa.reservas).toEqual(['Ygor Vinhas']);
    expect(l.casa.tecnico).toBe('António Oliveira');
    expect(l.status).toBe('provavel');
  });
  it('não conta nome do time nem palavras da página como jogador', () => {
    expect(l.casa.titulares).not.toContain('Remo');
    expect(l.casa.titulares).toHaveLength(11);
  });
  it('visitante na metade esquerda → troca os lados', () => {
    const trocado = PRINT.replace('\nRemo\n', '\nBotafogo X\n').replace('\nBotafogo\n', '\nRemo\n');
    const t = lerEscalacao(trocado, jogo);
    expect(t.ladosInvertidos).toBe(true);
    expect(t.fora.titulares).toContain('Marcelo Rangel');
  });
  it('print sem a divisão em lados avisa em vez de chutar', () => {
    const s = lerEscalacao('Marcelo Rangel\nIgor Jesus', jogo);
    expect(s.casa.titulares).toHaveLength(0);
    expect(s.avisos[0]).toContain('lados');
  });
  it('vários prints: junta sem repetir; "confirmada" vale mais', () => {
    const j = juntarEscalacoes([l, lerEscalacao(PRINT.replace('prováveis', 'confirmadas'), jogo)])!;
    expect(j.casa.titulares).toHaveLength(11);
    expect(j.status).toBe('confirmada');
  });
  it('nome do jogador limpo de número e nota', () => {
    expect(nomeDeJogador('10 G. Arrascaeta 7.4')).toBe('G. Arrascaeta');
    expect(nomeDeJogador('7.2 ★')).toBeNull();
    expect(mesmoJogador('G. Arrascaeta', 'Giorgian De Arrascaeta')).toBe(true);
  });
});

describe('coerência total × média × partidas', () => {
  it('"Gols marcados MH 4" com 1,4 por jogo em 32 jogos: o 4 é descartado', () => {
    const l = lerEstatisticas(
      'Remo Botafogo\nPartidas 32 32\nGols mercados MH 4\nGols por partida 11 14',
      'sofascore',
      jogo,
    );
    expect(l.campos.golsMarcados?.fora).toBeUndefined();
    expect(l.campos.golsMarcados!.avisos.join()).toContain('não bate');
    expect(l.campos.golsPorJogo).toMatchObject({ casa: 1.1, fora: 1.4 });
  });
  it('total coerente fica', () => {
    const l = lerEstatisticas(
      'Remo Botafogo\nPartidas 32 32\nGols marcados 34 44\nGols por partida 11 14',
      'sofascore',
      jogo,
    );
    expect(l.campos.golsMarcados).toMatchObject({ casa: 34, fora: 44 });
  });
});

describe('escalação do Flashscore (OCR real do campo)', () => {
  const texto = readFileSync(
    new URL('./fixtures-reais/flashscore-escalacao.txt', import.meta.url),
    'utf8',
  );
  const l = lerEscalacao(texto, { casa: 'Ceará', fora: 'Botafogo' });
  it('11 de cada lado, nomes cortados pelo site aceitos, lixo de selo descartado', () => {
    expect(l.casa.titulares).toEqual([
      'Marlon',
      'Jaja',
      'Ze Ricar',
      'Tchamba',
      'Marcelo',
      'Vitor Bu.',
      'Gabriel',
      'Marllon',
      'Ze Well',
      'Galeano',
      'Marceli',
    ]);
    expect(l.fora.titulares).toHaveLength(11);
    expect(l.fora.titulares).toContain('Tiquinho');
    expect(l.fora.titulares).toContain('Alex Tell');
  });
});

describe('escalação com posição e linha do meio (OCR atual)', () => {
  const ler = (f: string) =>
    lerEscalacao(readFileSync(new URL(`./fixtures-reais/${f}`, import.meta.url), 'utf8'), {
      casa: 'Remo',
      fora: 'Botafogo',
    });
  it('SuperScore, campo em pé: mandante em cima, cabeçalho da página fora', () => {
    const l = ler('superscore-escalacao.txt');
    expect(l.fora.titulares).toHaveLength(11);
    expect(l.fora.titulares[0]).toBe('G. Batista'); // goleiro primeiro
    expect(l.fora.titulares).toContain('H. Ziyech');
    expect(l.fora.titulares).toContain('N. Ferrares'); // "N.Ferrares" separado
    // "G. Taliari" o OCR leu "G. 1ahan": fica de fora (nunca inventado), sobram 10
    expect(l.casa.titulares).toHaveLength(10);
    expect(l.casa.titulares[0]).toBe('Rangel');
    expect(l.casa.titulares).not.toContain('Hoje');
    expect(l.casa.titulares.some((n) => /escala/i.test(n))).toBe(false);
  });
  it('Flashscore, campo deitado: mandante à esquerda, 11 de cada lado', () => {
    const l = ler('flashscore-escalacao-pos.txt');
    expect(l.casa.titulares).toHaveLength(11);
    expect(l.fora.titulares).toHaveLength(11);
    expect(l.casa.titulares).toContain('Tchamba');
    expect(l.fora.titulares).toContain('Tiquinho');
  });
});
