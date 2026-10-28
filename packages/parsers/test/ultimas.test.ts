import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerUltimas } from '../src';

const fx = (nome: string) =>
  readFileSync(new URL(`./fixtures-reais/${nome}`, import.meta.url), 'utf8');
const jogo = { casa: 'Remo', fora: 'Botafogo' };

describe('últimas partidas (OCR real)', () => {
  it('Remo: resultado pelo placar, mando pela linha; jogo cortado no fim fica de fora', () => {
    const r = lerUltimas(fx('ultimas-remo.txt'), jogo, 'casa');
    expect(r.forma).toEqual(['D', 'E', 'E', 'E', 'D', 'D']);
    expect(r.partidas[0]).toMatchObject({
      data: '23 out',
      adversario: 'Cruzeiro',
      local: 'fora',
      golsPro: 0,
      golsContra: 1,
    });
    expect(r.emCasa).toEqual({ V: 0, E: 2, D: 1 });
    expect(r.fora).toEqual({ V: 0, E: 1, D: 2 });
    expect(r.avisos.join()).toContain('06 set');
  });
  it('Botafogo: "Vascoda Gama" e selo "[=]" não atrapalham', () => {
    const r = lerUltimas(fx('ultimas-botafogo.txt'), jogo, 'fora');
    expect(r.forma).toEqual(['D', 'V', 'E', 'D', 'D', 'V', 'E']);
    expect(r.emCasa).toEqual({ V: 2, E: 1, D: 1 });
    expect(r.fora).toEqual({ V: 0, E: 1, D: 2 });
    expect(r.golsProPorJogo).toBeCloseTo(7 / 7, 6);
    expect(r.golsContraPorJogo).toBeCloseTo(11 / 7, 6);
  });
});
