import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  caudaBinomial,
  ehMelhorEntrada,
  itensBet,
  itensMelhores,
  mapaDeCalor,
  prometidoPorFaixa,
  resumirCamada,
} from '../src/camadas';
import { CentroComando } from '../src/componentes/CentroComando';
import { CockpitAnalise } from '../src/componentes/CockpitAnalise';
import { montarRadar } from '../src/componentes/RadarOdds';
import { derivar } from '../src/dados';
import { rascunhoExemplo } from '../src/exemplo';
import { CASAS_PADRAO, comCasasPadrao, rascunhoNovo } from '../src/estado';
import { placarAcerto, type EntradaHistorico } from '../src/historico';

const linha = (lado: 'over' | 'under', n: number, odd: number) =>
  ({
    casa: 'Casa',
    mercado: 'total',
    lado,
    linha: n,
    odd,
    periodo: 'FT',
    horarioColeta: '2026-11-06T12:00:00-03:00',
  }) as never;
const sugestao = (lado: 'over' | 'under', n: number, odd: number, chance: number) => ({
  linha: linha(lado, n, odd),
  descricao: `${lado} ${n}`,
  odd,
  casa: 'Casa',
  chance,
  minimo: 1 / odd,
  forca: 'media' as const,
});
const entrada = (lado: 'over' | 'under', n: number, odd: number, nivel?: 'R1') => ({
  linha: linha(lado, n, odd),
  descricao: `${lado} ${n}`,
  odd,
  casa: 'Casa',
  ev: 0.05,
  pFinal: 0.6,
  nivel,
});
const jogo = (
  id: string,
  placar: [number, number] | undefined,
  m: Partial<EntradaHistorico['resumo']> = {},
  e: Partial<EntradaHistorico> = {},
): EntradaHistorico => ({
  id,
  salvoEm: '2026-11-06T12:00:00-03:00',
  rascunho: rascunhoNovo(),
  resumo: {
    jogo: `${id} × B`,
    competicao: '',
    inicio: `2026-11-${id.padStart(2, '0')}T20:00:00-03:00`,
    decisao: 'NO_BET',
    rotulo: 'NO BET',
    dq: 'C',
    motivos: [],
    ...m,
  },
  resultado: placar
    ? { casa: placar[0], fora: placar[1], registradoEm: '2026-11-06T23:00:00-03:00' }
    : undefined,
  ...e,
});
const aposta = (odd: number, ent?: ReturnType<typeof entrada>) => ({
  odd,
  casa: 'Casa',
  feitaEm: '2026-11-06T12:00:00-03:00',
  entrada: ent,
});

const historico = [
  jogo('1', [3, 1], {
    confianca: [sugestao('over', 1.5, 1.4, 0.75), sugestao('over', 2.5, 1.9, 0.6)],
  }),
  jogo('2', [0, 0], { confianca: [sugestao('over', 1.5, 1.5, 0.68)] }),
  jogo('3', undefined, { confianca: [sugestao('under', 3.5, 1.5, 0.7)] }),
];

describe('camada Melhores entradas', () => {
  it('a 1ª de cada jogo bate com o placar de acerto', () => {
    const r = resumirCamada(itensMelhores(historico, 'primeira'));
    const p = placarAcerto(historico);
    expect([r.apuradas, r.green, r.red, r.pendentes]).toEqual([
      p.apuradas,
      p.total.green,
      p.total.red,
      p.pendentes,
    ]);
    expect(r.unidades).toBeCloseTo(p.total.unidades);
  });
  it('"todas" conta a lista inteira de cada jogo', () => {
    const r = resumirCamada(itensMelhores(historico, 'todas'));
    expect([r.total, r.green, r.red]).toEqual([4, 2, 1]);
  });
  it('"só onde entrei" vale pela odd que você pegou', () => {
    const lista = [
      jogo(
        '1',
        [3, 1],
        { confianca: [sugestao('over', 1.5, 1.4, 0.75)], entrada: entrada('over', 1.5, 1.4) },
        { aposta: aposta(1.5) },
      ),
      jogo('2', [3, 1], { confianca: [sugestao('over', 1.5, 1.4, 0.75)] }),
    ];
    const r = resumirCamada(itensMelhores(lista, 'entrei'));
    expect(r.total).toBe(1);
    expect(r.unidades).toBeCloseTo(0.5);
  });
  it('marcação à mão vale para a entrada escolhida, na odd sugerida', () => {
    const lista = [
      jogo(
        '1',
        undefined,
        { confianca: [sugestao('over', 1.5, 1.4, 0.75)], entrada: entrada('over', 1.5, 1.5) },
        { manual: 'green' },
      ),
    ];
    const [i] = itensMelhores(lista, 'primeira');
    expect(i.situacao).toBe('green');
    expect(i.lucro).toBeCloseTo(0.4);
  });
});

describe('camada BET', () => {
  it('só entra decisão BET, e nunca soma com a outra camada', () => {
    const lista = [
      jogo('1', [3, 1], { decisao: 'BET', rotulo: 'BET', entrada: entrada('over', 2.5, 2) }),
      jogo('2', [3, 1], { decisao: 'NO_BET', entrada: entrada('over', 2.5, 2) }),
    ];
    const r = resumirCamada(itensBet(lista, 'todas'));
    expect([r.total, r.green]).toEqual([1, 1]);
    expect(r.unidades).toBeCloseTo(1);
    expect(r.evMedio).toBeCloseTo(0.05);
  });
  it('entrou em outra aposta do jogo: a seleção do BET se perdeu e fica de fora', () => {
    const lista = [
      jogo(
        '1',
        [3, 1],
        { decisao: 'BET', entrada: entrada('over', 2.5, 2) },
        { aposta: aposta(2, entrada('over', 2.5, 2)) },
      ),
    ];
    expect(itensBet(lista, 'todas')).toEqual([]);
  });
});

describe('centro de comando', () => {
  it('desenha as duas camadas com e sem dados', () => {
    const cheio = renderToString(createElement(CentroComando, { historico }));
    expect(cheio).toContain('Melhores entradas');
    expect(cheio).toContain('Sorte ou método?');
    const vazio = renderToString(createElement(CentroComando, { historico: [] }));
    expect(vazio).toContain('Nenhuma melhor entrada');
  });
});

describe('números do painel', () => {
  it('cauda binomial', () => {
    expect(caudaBinomial(9, 7, 0.68)).toBeCloseTo(0.41, 2);
    expect(caudaBinomial(2, 0, 0.5)).toBeCloseTo(1);
    expect(caudaBinomial(2, 2, 0.5)).toBeCloseTo(0.25);
  });
  it('prometido × real por faixa ignora pendentes e faixa vazia', () => {
    const f = prometidoPorFaixa(itensMelhores(historico, 'primeira'));
    expect(f.map((x) => [x.nome, x.n])).toEqual([
      ['De 60% a 70%', 1],
      ['70% ou mais', 1],
    ]);
    expect(f[1].acerto).toBe(1);
  });
  it('mapa de calor por mercado e faixa de odd', () => {
    const [gols] = mapaDeCalor(itensMelhores(historico, 'todas'));
    expect(gols.familia).toBe('Gols');
    expect(gols.celulas[0]).toMatchObject({ green: 1, red: 1 });
    expect(gols.celulas[2]).toMatchObject({ green: 1, red: 0 });
    expect(gols.celulas[3]).toBeNull();
  });
  it('sabe quando a aposta é da lista', () => {
    const e = jogo('1', [3, 1], {
      confianca: [sugestao('over', 1.5, 1.4, 0.75)],
      entrada: entrada('over', 1.5, 1.4),
    });
    const fora = jogo('2', [3, 1], { entrada: entrada('over', 2.5, 2) });
    expect(ehMelhorEntrada([e, fora], e)).toBe(true);
    expect(ehMelhorEntrada([e, fora], fora)).toBe(false);
  });
});

describe('radar de preços e painel da análise', () => {
  const odd = (casa: string, lado: string, v: number) =>
    ({
      casa,
      mercado: 'total',
      lado,
      linha: 2.5,
      odd: v,
      periodo: 'FT',
      horarioColeta: 'x',
    }) as never;
  it('marca quem paga mais e ignora seleção de uma casa só', () => {
    const r = montarRadar([odd('A', 'over', 1.8), odd('B', 'over', 2), odd('A', 'under', 2.1)]);
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].melhor).toBe(2);
    expect(r.linhas[0].vantagem).toBeCloseTo(2 / 1.8 - 1);
    expect(r.casas).toEqual(['A', 'B']);
  });
  it('o painel desenha o jogo de exemplo com o mapa de placares', () => {
    const d = derivar(rascunhoExemplo());
    const html = renderToString(
      createElement(CockpitAnalise, {
        d,
        situacao: [{ nome: 'Odds', ok: true, obrigatorio: true }],
        nomes: { casa: 'A', fora: 'B' },
      }),
    );
    expect(html).toContain('Mapa de placares');
    expect(html).toContain('Quem vence');
  });
});

describe('casas padrão', () => {
  it('análise nova já vem com as sete casas', () => {
    expect(rascunhoNovo().casas).toEqual(CASAS_PADRAO);
  });
  it('análise aberta ganha as que faltam, sem repetir', () => {
    const r = comCasasPadrao({
      ...rascunhoNovo(),
      casas: ['1WIN', 'Outra'],
      casasPadrao: undefined,
    });
    expect(r.casas).toEqual(['1WIN', 'Outra', ...CASAS_PADRAO.slice(1)]);
  });
  it('casa removida não volta', () => {
    const r = { ...rascunhoNovo(), casas: ['1win'] };
    expect(comCasasPadrao(r).casas).toEqual(['1win']);
  });
});
