/**
 * Normalização por registro: faixas pré-registradas (bordas), tipo de aposta pelo liquidador do
 * motor, CLV padronizado (principal / log / bruto, janela não verificada), chave do jogo, estado
 * do resultado, revisão de decisão e as camadas. Nada de agregação.
 */
import { describe, expect, it } from 'vitest';
import type { LinhaOdd } from '@pe/engine';
import { DELTA_CLV, DELTA_CLV_LOG, clvPadronizado } from '../src/normalizar/clv';
import { FAIXAS, ehPreferencial, faixaDe } from '../src/normalizar/faixas';
import { chaveJogo, estadoResultado, montarJogos } from '../src/normalizar/jogos';
import { classificarMercado } from '../src/normalizar/mercados';
import { montarAnalise, montarSelecoes, revisoesDoJogo } from '../src/normalizar/selecoes';
import { montarAposta } from '../src/normalizar/apostas';
import { cenario, comApostaEResultado } from './fixtures/geradores';

const linha = (o: Partial<LinhaOdd>): LinhaOdd =>
  ({
    casa: 'Pinnacle',
    mercado: 'total',
    lado: 'over',
    odd: 1.9,
    periodo: 'FT',
    linha: 2.5,
    ...o,
  }) as LinhaOdd;

describe('faixas pré-registradas', () => {
  it.each([
    [1.39, 'abaixo-1,40'],
    [1.4, '1,40–1,60'],
    [1.5999, '1,40–1,60'],
    [1.6, '1,60–1,80'],
    [1.7999, '1,60–1,80'],
    [1.8, '1,80–2,00'],
    [2.0, '1,80–2,00'],
    [2.0001, '2,00–3,00'],
    [3.0, '2,00–3,00'],
    [3.01, 'acima-3,00'],
  ])('%s → %s', (odd, faixa) => expect(faixaDe(odd)).toBe(faixa));

  it('odd inválida não tem faixa', () => {
    for (const x of [null, undefined, Number.NaN, Infinity, 1, 0.5, -2])
      expect(faixaDe(x)).toBeNull();
  });

  it('preferencial = exatamente 1,40 a 2,00 (inclusive); sem sobreposição', () => {
    expect(FAIXAS.filter((f) => f.preferencial).map((f) => f.id)).toEqual([
      '1,40–1,60',
      '1,60–1,80',
      '1,80–2,00',
    ]);
    expect(ehPreferencial(faixaDe(2))).toBe(true);
    expect(ehPreferencial(faixaDe(2.0001))).toBe(false);
    expect(ehPreferencial(faixaDe(1.3999))).toBe(false);
    expect(ehPreferencial(null)).toBe(false);
  });
});

describe('tipo de aposta pelo liquidador do motor', () => {
  it('gols do jogo, gols do tempo, nicho e desconhecido', () => {
    expect(classificarMercado(linha({}))).toMatchObject({
      tipoAposta: 'gols-jogo',
      grupo: 'principal',
      chave: 'total|FT|-|2.5|over',
    });
    expect(classificarMercado(linha({ periodo: '1T', linha: 0.5 }))).toMatchObject({
      tipoAposta: 'gols-tempo',
      grupo: 'principal',
    });
    const esc = classificarMercado(linha({ mercado: 'escanteios_total', linha: 9.5 }));
    expect(esc).toMatchObject({ tipoAposta: 'contagem', grupo: 'nicho', nivel: 3 });
    const x = classificarMercado(linha({ mercado: 'inventado' as LinhaOdd['mercado'] }));
    expect(x).toMatchObject({ tipoAposta: 'desconhecido', grupo: null });
    expect(x.motivo).toBeTruthy();
  });

  it('lados complementares compartilham a chave de grupo (contados uma vez na F1.4)', () => {
    const o = classificarMercado(linha({ lado: 'over' }));
    const u = classificarMercado(linha({ lado: 'under' }));
    expect(o.chave).not.toBe(u.chave);
    expect(o.chaveGrupo).toBe(u.chaveGrupo);
  });
});

describe('CLV padronizado', () => {
  it('δ pré-registrado: 2% e ln(1,02)', () => {
    expect(DELTA_CLV).toBe(0.02);
    expect(DELTA_CLV_LOG).toBeCloseTo(0.0198026273, 9);
  });

  it('2 lados: principal sem margem (proporcional), log e bruto separados — conta à mão', () => {
    const c = clvPadronizado(1.84, 1.8, [2.1]);
    const p = 2.1 / (1.8 + 2.1); // (1/1,8) / (1/1,8 + 1/2,1)
    expect(c.metodoMargem).toBe('proporcional');
    expect(c.pFechamentoSemMargem).toBeCloseTo(p, 12);
    expect(c.principal).toBeCloseTo(1.84 * p - 1, 12);
    expect(c.log).toBeCloseTo(Math.log(1.84 * p), 12);
    expect(c.bruto).toBeCloseTo(1.84 / 1.8 - 1, 12);
    expect(c.janela).toBe('nao-verificada');
    expect(c.motivo).toBeUndefined();
  });

  it('3 lados: Shin, como o clvJusto do motor', () => {
    const c = clvPadronizado(2.5, 2.4, [3.4, 3.1]);
    expect(c.metodoMargem).toBe('shin');
    expect(c.principal).not.toBeNull();
  });

  it('sem os outros lados: só o bruto; sem fechamento ou odd: nada, com motivo', () => {
    const b = clvPadronizado(1.84, 1.8, undefined);
    expect([b.principal, b.log]).toEqual([null, null]);
    expect(b.bruto).toBeCloseTo(1.84 / 1.8 - 1, 12);
    expect(b.motivo).toMatch(/só o CLV bruto/);
    expect(clvPadronizado(1.84, 1.8, [Number.NaN]).principal).toBeNull();
    const s = clvPadronizado(1.84, undefined, [2.1]);
    expect([s.principal, s.bruto]).toEqual([null, null]);
    expect(s.motivo).toBe('sem odd de fechamento');
    expect(clvPadronizado(null, 1.8, [2.1]).motivo).toMatch(/odd da entrada/);
  });
});

describe('jogo', () => {
  it('chave normalizada (acento, caixa, espaços) e o mesmo instante em fusos diferentes', async () => {
    const { entrada: e } = await cenario();
    const outra = structuredClone(e);
    outra.rascunho.jogo.casa = '  FLAMENGO ';
    outra.rascunho.jogo.fora = 'atletico-mg';
    outra.resumo.inicio = new Date(Date.parse(e.resumo.inicio)).toISOString();
    expect(chaveJogo(outra)).toBe(chaveJogo(e));
    expect(chaveJogo(e)).toBe('flamengo|atletico-mg|2026-11-18T18:00:00.000Z');
  });

  it('sem time ou sem início válido: jogo-sem-chave, excluído com motivo', async () => {
    const { entrada: e } = await cenario();
    const sem = structuredClone(e);
    sem.id = 'sem';
    sem.resumo.inicio = 'quando?';
    const r = montarJogos([
      { entrada: e, fontes: ['a'], versoes: 1, criterio: 'unica', alerta: null },
      { entrada: sem, fontes: ['a'], versoes: 1, criterio: 'unica', alerta: null },
    ]);
    expect(r.jogos).toHaveLength(1);
    expect(r.exclusoes).toEqual([
      expect.objectContaining({ categoria: 'jogo-sem-chave', id: 'sem' }),
    ]);
  });

  it('análises do mesmo jogo com ids diferentes formam UM jogo; placares divergentes marcam conflito', async () => {
    const { entrada: e } = await cenario();
    const a = comApostaEResultado(e, { placar: [2, 1] });
    const b = { ...comApostaEResultado(e, { placar: [0, 0] }), id: 'jogo-2', irmaDe: 'jogo-1' };
    const r = montarJogos([
      { entrada: a, fontes: ['x'], versoes: 1, criterio: 'unica', alerta: null },
      { entrada: b, fontes: ['x'], versoes: 1, criterio: 'unica', alerta: null },
    ]);
    expect(r.jogos).toHaveLength(1);
    expect(r.jogos[0].idsHistorico).toEqual(['jogo-1', 'jogo-2']);
    expect(r.jogos[0].conflitoPlacar).toBe(true);
    expect(r.jogos[0].placar).toBeNull();
  });

  it('estado do resultado, incluindo fechamento sem placar (NaN → null no JSON)', async () => {
    const { entrada: e } = await cenario();
    expect(estadoResultado(e)).toBe('sem-resultado');
    const soFech = JSON.parse(
      JSON.stringify(comApostaEResultado(e, { placar: null, oddFechamento: 1.8 })),
    );
    expect(soFech.resultado.casa).toBeNull();
    expect(estadoResultado(soFech)).toBe('fechamento-sem-placar');
    expect(estadoResultado(comApostaEResultado(e, {}))).toBe('resultado-sem-fechamento');
    expect(estadoResultado(comApostaEResultado(e, { oddFechamento: 1.8 }))).toBe('completo');
  });
});

describe('revisão de decisão e seleções', () => {
  it('decisão = última ANTES do apito; abertura = primeira; pós-apito contada e fora', async () => {
    const c = await cenario();
    const r = revisoesDoJogo([...c.revisoes].reverse(), c.inicio);
    expect(r.decisao?.meta.revisao).toBe(3);
    expect(r.abertura?.meta.revisao).toBe(1);
    expect(r.posApito).toBe(1);
    const { analise } = montarAnalise(c.entrada, 'k', c.revisoes);
    expect(analise).toMatchObject({
      revisoes: 4,
      revisoesPosApito: 1,
      revisaoDecisao: 3,
      revisaoAbertura: 1,
      decisaoV4: 'BET',
      protocolo: 'V4',
      dq: 'C',
      temEvidencia: true,
    });
  });

  it('sem evidência (v1): análise existe, sem revisão de decisão', async () => {
    const c = await cenario();
    const { analise, decisao } = montarAnalise(c.entrada, 'k', []);
    expect(decisao).toBeNull();
    expect(analise).toMatchObject({ temEvidencia: false, revisaoDecisao: null, decisaoV4: null });
  });

  it('seleções da V4: quatro fontes de P, camada BET só na melhor, pendências da F1.3 em null', async () => {
    const c = await cenario();
    const ss = montarSelecoes(c.entrada, 'k', c.revisoes[2]);
    expect(ss.length).toBe(7);
    const bet = ss.filter((s) => s.camadas.betV4);
    expect(bet.map((s) => s.chave)).toEqual(['total|FT|-|2.5|over']);
    expect(ss.some((s) => s.camadas.noBetPapel)).toBe(false);
    expect(bet[0]).toMatchObject({
      origem: 'v4',
      melhorOdd: 1.84,
      casaMelhorOdd: 'Superbet',
      faixaDecisao: '1,80–2,00',
      preferencial: true,
      tipoAposta: 'gols-jogo',
      grupo: 'principal',
      fonteP: 'Pinnacle sem margem (proporcional)',
      pModeloBruto: null,
      pMistura: null,
      wMistura: null,
      desfecho: null,
      clvPapel: null,
    });
    expect(bet[0].pMercado).toBeCloseTo(0.564885496183206, 12);
    expect(bet[0].pModeloAjustado).toBeCloseTo(0.5324892117167118, 12);
  });

  it('decisão não-BET: a melhor vira "no papel", nunca BET', async () => {
    const c = await cenario();
    const ev = structuredClone(c.revisoes[2]);
    (ev.conteudo.avaliacao as { v4: { decisao: string } }).v4.decisao = 'NO BET';
    const ss = montarSelecoes(c.entrada, 'k', ev);
    expect(ss.filter((s) => s.camadas.noBetPapel).map((s) => s.chave)).toEqual([
      'total|FT|-|2.5|over',
    ]);
    expect(ss.some((s) => s.camadas.betV4)).toBe(false);
  });

  it('lista "Melhores entradas": junta pela chave; só da lista, origem "lista" e faixa pela odd da lista', async () => {
    const c = await cenario();
    const ev = structuredClone(c.revisoes[2]);
    const aval = ev.conteudo.avaliacao as {
      v4: { avaliadas: { linha: LinhaOdd }[] };
      entradas: unknown;
    };
    const l1 = aval.v4.avaliadas[0].linha;
    const l2 = linha({ mercado: 'escanteios_total', linha: 9.5, odd: 1.45 });
    aval.entradas = {
      entradas: [
        { linha: l1, descricao: 'a', odd: 1.84, casa: 'Superbet', chance: 0.56 },
        {
          linha: l2,
          descricao: 'b',
          odd: 1.45,
          casa: 'Bet365',
          chance: 0.7,
          pModelo: { $invalido: 'NaN' },
        },
      ],
    };
    const ss = montarSelecoes(c.entrada, 'k', ev);
    const ambos = ss.find((s) => s.chave === 'total|FT|-|2.5|over')!;
    expect(ambos.origem).toBe('v4+lista');
    expect(ambos.camadas).toEqual({ betV4: true, noBetPapel: false, lista: true });
    const so = ss.find((s) => s.chave === classificarMercado(l2).chave)!;
    expect(so).toMatchObject({
      origem: 'lista',
      grupo: 'nicho',
      faixaDecisao: '1,40–1,60',
      melhorOdd: null,
    });
    expect(so.lista?.pModelo).toBeNull(); // {$invalido} vira null
  });

  it('CLV no papel: só na seleção que é a entrada registrada, com o fechamento dela', async () => {
    const c = await cenario();
    const e = comApostaEResultado(c.entrada, { oddFechamento: 1.8, fechamentoOutros: [2.1] });
    const ss = montarSelecoes(e, 'k', c.revisoes[2]);
    const com = ss.filter((s) => s.clvPapel);
    expect(com.map((s) => s.chave)).toEqual(['total|FT|-|2.5|over']);
    expect(com[0].clvPapel?.principal).toBeCloseTo(1.84 * (2.1 / 3.9) - 1, 12);
  });
});

describe('aposta feita', () => {
  it('odd usada, faixa pela odd usada e CLV contra o fechamento', async () => {
    const c = await cenario();
    const a = montarAposta(
      comApostaEResultado(c.entrada, { odd: 1.9, oddFechamento: 1.8, fechamentoOutros: [2.1] }),
      'k',
    )!;
    expect(a).toMatchObject({
      oddUsada: 1.9,
      oddUsadaEfetiva: 1.9,
      faixaUsada: '1,80–2,00',
      preferencial: true,
      estadoResultado: 'completo',
      origemEntrada: 'analise',
    });
    expect(a.clv.principal).toBeCloseTo(1.9 * (2.1 / 3.9) - 1, 12);
  });

  it('Betfair Exchange: CLV oficial com a odd depois da comissão; nominal à parte', async () => {
    const c = await cenario();
    const a = montarAposta(
      comApostaEResultado(c.entrada, {
        odd: 2.0,
        casa: 'Betfair Exchange',
        oddFechamento: 1.8,
        fechamentoOutros: [2.1],
      }),
      'k',
    )!;
    expect(a.oddUsadaEfetiva).toBeCloseTo(1 + 1 * (1 - 0.065), 12);
    expect(a.faixaUsada).toBe('1,80–2,00');
    expect(a.clv.bruto).toBeCloseTo(1.935 / 1.8 - 1, 12);
    expect(a.clvNominal.bruto).toBeCloseTo(2 / 1.8 - 1, 12);
  });

  it('sem aposta: não há registro de aposta (análise não é aposta)', async () => {
    const c = await cenario();
    expect(montarAposta(c.entrada, 'k')).toBeNull();
  });
});
