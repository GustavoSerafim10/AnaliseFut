import { describe, expect, it } from 'vitest';
import { rascunhoNovo } from '../src/estado';
import {
  apurar,
  balanco,
  exportarJson,
  importarJson,
  type EntradaHistorico,
  type ResumoAnalise,
} from '../src/historico';

const entrada = (
  id: string,
  decisao: ResumoAnalise['decisao'],
  odd: number,
  placar?: [number, number],
  fechamento?: number,
): EntradaHistorico => ({
  id,
  salvoEm: '2026-10-26T16:30:00-03:00',
  rascunho: { ...rascunhoNovo(), idHistorico: id },
  resumo: {
    jogo: 'Flamengo × Atlético-MG',
    competicao: 'Brasileirão',
    inicio: `2026-10-${id}T20:00:00-03:00`,
    decisao,
    rotulo: String(decisao),
    dq: 'C',
    motivos: [],
    entrada: {
      linha: { casa: '1win', mercado: '1X2', lado: '1', odd, periodo: 'FT' },
      descricao: 'Flamengo vencer',
      odd,
      casa: '1win',
      ev: 0.04,
      pFinal: 0.6,
    },
  },
  resultado: placar
    ? {
        casa: placar[0],
        fora: placar[1],
        oddFechamento: fechamento,
        registradoEm: '2026-10-26T22:00:00-03:00',
      }
    : undefined,
});

describe('histórico (Fase 4)', () => {
  it('apura com o placar e soma o balanço em unidades', () => {
    const lista = [
      entrada('20', 'BET', 1.9, [2, 0], 1.8),
      entrada('21', 'BET', 2.0, [0, 1], 2.1),
      entrada('22', 'BET', 1.5),
    ];
    expect(apurar(lista[0])).toMatchObject({ ok: true, rotulo: 'ganhou' });
    expect(apurar(lista[2])).toBeNull();
    const b = balanco(lista);
    expect(b.apuradas).toBe(2);
    expect(b.unidades).toBeCloseTo(0.9 - 1, 12);
    expect(b.taxaAcerto).toBe(0.5);
    expect(b.pMedia).toBeCloseTo(0.6, 12);
    // CLV: 1,9/1,8 − 1 e 2,0/2,1 − 1
    expect(b.clvMedio).toBeCloseTo((1.9 / 1.8 - 1 + (2 / 2.1 - 1)) / 2, 12);
  });

  it('exporta e importa: junta por id, preserva o resultado já registrado', () => {
    const atual = [entrada('20', 'BET', 1.9, [2, 0])];
    const backup = exportarJson([
      { ...entrada('20', 'BET', 1.9), salvoEm: '2026-10-26T17:00:00-03:00' },
      entrada('21', 'NO_BET', 2.0),
    ]);
    const r = importarJson(backup, atual);
    if ('erro' in r) throw new Error(r.erro);
    expect(r.novas).toBe(1);
    expect(r.lista).toHaveLength(2);
    expect(r.lista.find((e) => e.id === '20')?.resultado?.casa).toBe(2);
    // ordenado do jogo mais recente para o mais antigo
    expect(r.lista[0].id).toBe('21');
  });

  it('recusa backup inválido sem importar nada', () => {
    expect(importarJson('{"historico":[{"id":1}]}', [])).toEqual({
      erro: '1 entrada(s) inválida(s): nada foi importado',
    });
    expect('erro' in importarJson('[]', [])).toBe(true);
  });
});
