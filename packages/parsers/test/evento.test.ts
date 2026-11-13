import { describe, expect, it } from 'vitest';
import { dataDoEvento, eventoDoTexto, idDoEvento, mesmoEvento } from '../src/evento';

const ev = (casa: string, fora: string, data = '2026-11-14') => ({ casa, fora, data });

describe('identidade estável do evento', () => {
  it('acento, caixa, pontuação e palavras vazias (FC, SC, CP) não criam outro evento', () => {
    const base = idDoEvento(ev('Atlético Mineiro', 'Cruzeiro'));
    expect(idDoEvento(ev('ATLETICO MINEIRO', 'cruzeiro'))).toBe(base);
    expect(idDoEvento(ev('  Atlético  Mineiro ', 'Cruzeiro SC'))).toBe(base);
    expect(idDoEvento(ev('Atlético Mineiro FC', 'Cruzeiro'))).toBe(base);
  });

  it('mandante e visitante trocados são o mesmo jogo', () => {
    expect(idDoEvento(ev('Flamengo', 'Vasco'))).toBe(idDoEvento(ev('Vasco', 'Flamengo')));
  });

  it('a 1win aportuguesa o nome: "Milão" é "Milan"', () => {
    expect(idDoEvento(ev('Milão', 'Napoli'))).toBe(idDoEvento(ev('Milan', 'Nápoles')));
  });

  it('data diferente ou time diferente são eventos diferentes', () => {
    const a = idDoEvento(ev('Flamengo', 'Vasco'));
    expect(idDoEvento(ev('Flamengo', 'Vasco', '2026-11-15'))).not.toBe(a);
    expect(idDoEvento(ev('Flamengo', 'Botafogo'))).not.toBe(a);
  });

  it('sem nome ou sem data não há identidade (nunca é "o mesmo" de nada)', () => {
    expect(idDoEvento(ev('', 'Vasco'))).toBeNull();
    expect(idDoEvento(ev('Flamengo', ''))).toBeNull();
    expect(idDoEvento(ev('Flamengo', 'Vasco', ''))).toBeNull();
    expect(idDoEvento(ev('Flamengo', 'Vasco', 'amanhã'))).toBeNull();
    expect(mesmoEvento(ev('', ''), ev('', ''))).toBe(false);
    expect(mesmoEvento(ev('Flamengo', 'Vasco', ''), ev('Flamengo', 'Vasco', ''))).toBe(false);
  });
});

describe('mesmoEvento tolera nome abreviado, sem confundir jogos diferentes', () => {
  it('nome longo × abreviado do mesmo time na mesma data', () => {
    expect(
      mesmoEvento(ev('Sporting Clube de Portugal CP', 'Benfica'), ev('Sporting', 'Benfica')),
    ).toBe(true);
    expect(mesmoEvento(ev('Brugge', 'Genk'), ev('Club Brugge', 'Genk'))).toBe(true);
  });

  it('com a ordem trocada também', () => {
    expect(
      mesmoEvento(ev('Sporting', 'Benfica'), ev('Benfica', 'Sporting Clube de Portugal')),
    ).toBe(true);
  });

  it('não confunde Atlético-MG com Atlético-PR, nem Real Madrid com Real Sociedad', () => {
    expect(mesmoEvento(ev('Atlético-MG', 'Cruzeiro'), ev('Atlético-PR', 'Cruzeiro'))).toBe(false);
    expect(mesmoEvento(ev('Real Madrid', 'Barcelona'), ev('Real Sociedad', 'Barcelona'))).toBe(
      false,
    );
  });

  it('datas diferentes nunca são o mesmo evento, mesmo com os mesmos times', () => {
    expect(mesmoEvento(ev('Sporting', 'Benfica'), ev('Sporting', 'Benfica', '2026-11-15'))).toBe(
      false,
    );
  });

  it('só um time em comum não basta', () => {
    expect(mesmoEvento(ev('Flamengo', 'Vasco'), ev('Flamengo', 'Botafogo'))).toBe(false);
  });
});

describe('leitura de data e de texto de jogo', () => {
  it('data de um ISO local', () => {
    expect(dataDoEvento('2026-11-14T19:30:00-03:00')).toBe('2026-11-14');
    expect(dataDoEvento('2026-11-14')).toBe('2026-11-14');
  });

  it('"Casa × Fora" das pernas das múltiplas', () => {
    expect(eventoDoTexto('Flamengo × Vasco', '2026-11-14T19:30:00-03:00')).toEqual({
      casa: 'Flamengo',
      fora: 'Vasco',
      data: '2026-11-14',
    });
    expect(eventoDoTexto('Múltipla @ 3.4', '2026-11-14T19:30:00-03:00')).toBeNull();
    expect(eventoDoTexto('Flamengo × Vasco', 'sem data')).toBeNull();
  });
});
