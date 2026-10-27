/** Teste de fumaça: as telas da V4.0 renderizam com um jogo de exemplo, sem erro. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AbaAnalise } from '../src/abas/AbaAnalise';
import { AbaHistorico } from '../src/abas/AbaHistorico';
import { AbaPromocoes } from '../src/abas/AbaPromocoes';
import { derivar } from '../src/dados';
import { rascunhoExemplo } from '../src/exemplo';
import { rascunhoNovo, type Rascunho } from '../src/estado';
import { salvarNoHistorico, travasDoHistorico } from '../src/historico';

const H = '2099-10-26T16:00:00-03:00';
const ou = (casa: string, over: number, under: number) =>
  (['over', 'under'] as const).map((lado, i) => ({
    casa,
    mercado: 'total' as const,
    lado,
    linha: 2.5,
    odd: i ? under : over,
    periodo: 'FT' as const,
    horarioColeta: H,
  }));
const r: Rascunho = {
  ...rascunhoNovo(),
  jogo: {
    casa: 'Flamengo',
    fora: 'Atlético-MG',
    competicao: 'Brasileirão',
    data: '2099-10-26',
    hora: '20:00',
  },
  casas: ['Pinnacle', '1win'],
  odds: [...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.1, 1.72)],
  banca: '1000',
};
const nada = () => {};

describe('telas da V4.0', () => {
  const d = derivar(r);
  it('a análise só com odds já decide pela V4.0 (sem estatísticas)', () => {
    expect(d.v4?.decisao).toBe('BET');
    const html = renderToString(
      createElement(AbaAnalise, { r, setR: nada, d, onSalvar: nada, salvoNoHistorico: false }),
    );
    expect(html).toContain('BET');
    expect(html).toContain('Pinnacle');
    expect(html).toContain('Motor de apoio (V3.3) desligado');
  });
  it('histórico com a aposta salva, banca e travas', () => {
    const { lista } = salvarNoHistorico([], r, d);
    expect(lista[0].resumo.entrada?.nivel).toBe('R1');
    expect(lista[0].resumo.entrada?.stakeValor).toBeGreaterThan(0);
    const html = renderToString(
      createElement(AbaHistorico, {
        historico: lista,
        setHistorico: nada,
        abrir: nada,
        bancaInicial: 1000,
        setBancaInicial: nada,
        travas: travasDoHistorico(lista, 1000),
      }),
    );
    expect(html).toContain('S1 · value contra a referência');
    expect(html).toContain('Banca atual');
  });
  it('promoções renderiza', () => {
    expect(renderToString(createElement(AbaPromocoes, { r, setR: nada, d }))).toContain(
      'Odd turbinada',
    );
  });
});

describe('jogo de exemplo (#demo)', () => {
  it('mostra um BET de verdade da V4.0 contra a Pinnacle', () => {
    const d = derivar(rascunhoExemplo());
    expect(d.v4?.decisao).toBe('BET');
    expect(d.v4?.melhor?.casaMelhorOdd).toBe('Superbet');
    expect(d.v4?.referencia.nivel).toBe('R1');
  });
});
