/**
 * Outras casas: textos no formato público de Bet365, Betano e Pinnacle (em português).
 * SEM prints reais ainda — quando chegarem, viram fixtures em fixtures-reais/ como os da 1win.
 */
import { describe, expect, it } from 'vitest';
import { detectarCasa, lerOddsCasa } from '../src';

const jogo = { casa: 'Flamengo', fora: 'Atlético-MG' };
const ler = (texto: string, casa: string) =>
  lerOddsCasa([texto], { jogo, data: '2026-10-26', casa });
const odd = (r: ReturnType<typeof ler>, f: Record<string, unknown>) =>
  r.linhas
    .filter((l) => Object.entries(f).every(([k, v]) => l[k as keyof typeof l] === v))
    .map((l) => l.odd);

const BET365 = `16:05
bet365
Resultado Final
Flamengo 1.30 Empate 5.25 Atlético-MG 10.00
Dupla Chance
Flamengo ou Empate 1.04 Flamengo ou Atlético-MG 1.14 Empate ou Atlético-MG 3.60
Gols Mais/Menos
Mais de Menos de
2.5 1.66 2.20
3.5 2.75 1.44
Para Ambos os Times Marcarem
Sim 2.10 Não 1.70
Handicap Asiático
Flamengo Atlético-MG
-1.5 1.80 +1.5 2.05
Empate Anula Aposta
Flamengo 1.06 Atlético-MG 8.50`;

const BETANO = `16:07
Betano
Resultado Final
1 1.30 X 5.20 2 10.50
Total de Gols Mais/Menos
Mais de 2.5 1.67 Menos de 2.5 2.15
Ambas equipes marcam
Sim 2.05 Não 1.72
Chance Dupla
1X 1.03 12 1.15 X2 3.55`;

const PINNACLE = `16:10
Pinnacle
Money Line – Partida
Flamengo Empate Atlético-MG
1.312 5.540 11.200
Handicap – Partida
Atlético-MG Flamengo
+ 1.5 2.010 -1.5 1.869
Total – Partida
Over 2.5 1.704 Under 2.5 2.200`;

describe('outras casas (formato público, sem print real)', () => {
  it('detecta a marca da casa no print', () => {
    expect(detectarCasa(BET365)).toBe('Bet365');
    expect(detectarCasa(BETANO)).toBe('Betano');
    expect(detectarCasa(PINNACLE)).toBe('Pinnacle');
    expect(detectarCasa('Resultado final 1.30 5.25')).toBeNull();
  });

  it('Bet365: 1X2, dupla chance por nome, totais em tabela, ambas, AH em colunas, DNB', () => {
    const r = ler(BET365, 'Bet365');
    expect(odd(r, { mercado: '1X2', lado: '1' })).toEqual([1.3]);
    expect(odd(r, { mercado: '1X2', lado: '2' })).toEqual([10]);
    expect(odd(r, { mercado: 'DC', lado: '1X' })).toEqual([1.04]);
    expect(odd(r, { mercado: 'DC', lado: '12' })).toEqual([1.14]);
    expect(odd(r, { mercado: 'DC', lado: 'X2' })).toEqual([3.6]);
    expect(odd(r, { mercado: 'total', linha: 2.5, lado: 'over' })).toEqual([1.66]);
    expect(odd(r, { mercado: 'total', linha: 3.5, lado: 'under' })).toEqual([1.44]);
    expect(odd(r, { mercado: 'ambas', lado: 'nao' })).toEqual([1.7]);
    expect(odd(r, { mercado: 'AH', lado: 'casa', linha: -1.5 })).toEqual([1.8]);
    expect(odd(r, { mercado: 'AH', lado: 'fora', linha: 1.5 })).toEqual([2.05]);
    expect(odd(r, { mercado: 'DNB', lado: '2' })).toEqual([8.5]);
    expect(r.linhas.every((l) => l.casa === 'Bet365')).toBe(true);
    expect(r.horarioColeta).toBe('2026-10-26T16:05:00-03:00');
    expect(r.naoReconhecidas).toEqual([]);
  });

  it('Betano: rótulos 1/X/2, "Mais de 2.5", "Ambas equipes marcam", "Chance Dupla"', () => {
    const r = ler(BETANO, 'Betano');
    expect(odd(r, { mercado: '1X2', lado: 'X' })).toEqual([5.2]);
    expect(odd(r, { mercado: 'total', linha: 2.5, lado: 'under' })).toEqual([2.15]);
    expect(odd(r, { mercado: 'ambas', lado: 'sim' })).toEqual([2.05]);
    expect(odd(r, { mercado: 'DC', lado: 'X2' })).toEqual([3.55]);
    expect(r.naoReconhecidas).toEqual([]);
  });

  it('Pinnacle: money line, handicap com o visitante na 1ª coluna e "+ 1.5" separado, over/under', () => {
    const r = ler(PINNACLE, 'Pinnacle');
    expect(odd(r, { mercado: '1X2', lado: '1' })).toEqual([1.312]);
    expect(odd(r, { mercado: '1X2', lado: '2' })).toEqual([11.2]);
    expect(odd(r, { mercado: 'AH', lado: 'fora', linha: 1.5 })).toEqual([2.01]);
    expect(odd(r, { mercado: 'AH', lado: 'casa', linha: -1.5 })).toEqual([1.869]);
    expect(odd(r, { mercado: 'total', linha: 2.5, lado: 'over' })).toEqual([1.704]);
  });

  it('avisa quando o print parece de outra casa', () => {
    const r = ler(BETANO, 'Bet365');
    expect(r.avisos.join()).toContain('marca da Betano');
    expect(ler(BET365, 'bet365').avisos.join()).not.toContain('marca');
  });

  it('odds fracionárias: avisa em vez de ler errado', () => {
    const r = ler('bet365\nResultado Final\nFlamengo 3/10 Empate 17/4 Atlético-MG 9/1', 'Bet365');
    expect(r.linhas).toEqual([]);
    expect(r.avisos.join()).toContain('fracionárias');
  });
});
