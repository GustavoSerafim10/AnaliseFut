import { describe, expect, it } from 'vitest';
import { rascunhoNovo } from '../src/estado';
import {
  apurar,
  balanco,
  calibracao,
  clvDe,
  exportarJson,
  importarJson,
  marco,
  travasDoHistorico,
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

describe('histórico na V4.0', () => {
  const comStake = (id: string, lucroPlacar: [number, number], stakeValor: number) => {
    const e = entrada(id, 'BET', 2.0, lucroPlacar);
    e.resumo.entrada!.stakeValor = stakeValor;
    e.resumo.entrada!.estrategia = 'S1';
    e.salvoEm = `2026-10-${id}T15:00:00-03:00`;
    e.resultado!.registradoEm = `2026-10-${id}T22:00:00-03:00`;
    return e;
  };
  it('travas da banca saem das apostas registradas', () => {
    // duas derrotas de R$ 120 numa banca de R$ 1000: drawdown 24% → Kelly pela metade
    const t = travasDoHistorico(
      [comStake('20', [0, 1], 120), comStake('21', [0, 2], 120)],
      1000,
      '2026-10-22T10:00:00-03:00',
    );
    expect(t.bancaAtual).toBe(760);
    expect(t.fatorKelly).toBe(0.5);
  });
  it('CLV contra o fechamento justo quando vêm os outros lados', () => {
    const e = entrada('20', 'BET', 2.1, [2, 0]);
    e.resultado!.oddFechamento = 1.95;
    e.resultado!.fechamentoOutros = [1.95];
    expect(clvDe(e)).toBeCloseTo(0.05, 10);
  });
  it('Brier do modelo × mercado em todo jogo com placar', () => {
    const e = entrada('20', 'NO_BET', 2.0, [2, 0]);
    e.resumo.previsao = {
      modelo1x2: [0.5, 0.3, 0.2],
      mercado1x2: [0.7, 0.2, 0.1],
      over25Modelo: 0.4,
      over25Mercado: 0.5,
    };
    const c = calibracao([e, entrada('21', 'NO_BET', 2.0)]);
    expect(c.jogos).toBe(1);
    expect(c.brier1x2!.mercado).toBeLessThan(c.brier1x2!.modelo);
  });
  it('marcos: cedo demais antes de 100 apostas com fechamento', () => {
    expect(marco(balanco([]))).toContain('cedo demais');
  });
});
