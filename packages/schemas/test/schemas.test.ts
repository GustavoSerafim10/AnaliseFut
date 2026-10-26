import { describe, expect, it } from 'vitest';
import { importarJson, OddLineSchema } from '../src';

describe('schemas', () => {
  it('aceita uma odd válida e põe FT como padrão', () => {
    const r = OddLineSchema.parse({
      casa: '1win',
      mercado: 'total',
      linha: 2.5,
      lado: 'over',
      odd: 1.29,
    });
    expect(r.periodo).toBe('FT');
  });
  it('rejeita odd ≤ 1 e mercado desconhecido', () => {
    expect(
      OddLineSchema.safeParse({ casa: '1win', mercado: 'total', lado: 'over', odd: 1 }).success,
    ).toBe(false);
    expect(
      OddLineSchema.safeParse({ casa: '1win', mercado: 'gols', lado: 'over', odd: 2 }).success,
    ).toBe(false);
  });
  it('importa JSON com jogo e odds, marcando a fonte', () => {
    const r = importarJson(
      JSON.stringify({
        jogo: { casa: 'Aston Villa', fora: 'Viking' },
        odds: [{ casa: '1win', mercado: '1X2', lado: '1', odd: 1.24 }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.dados?.odds[0].fonte).toBe('json');
  });
  it('aceita lista pura de odds', () => {
    expect(importarJson('[{"casa":"1win","mercado":"ambas","lado":"sim","odd":1.62}]').ok).toBe(
      true,
    );
  });
  it('erro legível em JSON quebrado ou campo inválido', () => {
    expect(importarJson('{').erros[0]).toContain('JSON inválido');
    const r = importarJson('{"odds":[{"casa":"1win","mercado":"1X2","lado":"1","odd":0.5}]}');
    expect(r.ok).toBe(false);
    expect(r.erros[0]).toContain('odds.0.odd');
  });
});
