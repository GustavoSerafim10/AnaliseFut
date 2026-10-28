import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerDesfalques } from '../src';

const jogo = { casa: 'Remo', fora: 'Botafogo' };
const nomes = (r: ReturnType<typeof lerDesfalques>, t: 'casa' | 'fora') =>
  r.desfalques.filter((d) => d.time === t).map((d) => d.jogador);

describe('desfalques do SuperScore com a página inteira no print', () => {
  // texto lido pelo navegador do usuário (cabeçalho da página + lista com situação embaixo)
  const NAVEGADOR = [
    'Futebol Brasdero-SericA REMXxBOT',
    'Remo x RW Botafogo',
    'Hoje',
    'Detaines Escalações Estatisticas HH Classificação',
    'REM X BOT JOGADORES AUSENTES Possível TI >',
    'Remo >',
    '22 Yago Pikachu',
    'Lesionado',
    '2 JosoLucas',
    'Lesionado',
    '27 Neido O',
    'Suspenso',
    'Botafogo >',
    '35 Danilo Santos',
    'Duvidoso',
    '31 Kaio',
    'Lesionado',
    '14 Jordan Berrors',
    'Lesionado',
    '8 Alvaro Montoro',
    'Suspenso',
  ].join('\n');

  it('ignora o cabeçalho da página e não avisa à toa', () => {
    const r = lerDesfalques(NAVEGADOR, jogo);
    expect(r.avisos).toEqual([]);
    expect(nomes(r, 'casa')).toHaveLength(3);
    expect(nomes(r, 'fora')).toHaveLength(4);
  });
  it('"Duvidoso" é situação, não jogador; letra solta no fim sai', () => {
    const r = lerDesfalques(NAVEGADOR, jogo);
    expect(nomes(r, 'fora')).not.toContain('Duvidoso');
    expect(r.desfalques.find((d) => d.jogador === 'Danilo Santos')?.situacao).toBe('Duvidoso');
    expect(nomes(r, 'casa')).toContain('Neido');
  });
  it('OCR real do print (Remo × Botafogo)', () => {
    const r = lerDesfalques(
      readFileSync(
        new URL('./fixtures-reais/superscore-desfalques-2.txt', import.meta.url),
        'utf8',
      ),
      jogo,
    );
    expect(nomes(r, 'casa')).toEqual(['Yago Pikachu', 'Joao Lucas', 'Ze Ivaldo']);
    expect(nomes(r, 'fora')).toEqual(['Danilo Santos', 'Kaio', 'Jordan Barrera', 'Alvaro Montoro']);
  });
});
