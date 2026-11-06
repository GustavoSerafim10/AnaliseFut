/** A lista "Melhores entradas" no site: apuração da entrada escolhida e placar de acerto. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MelhoresEntradas } from '../src/componentes/MelhoresEntradas';
import { PlacarDeAcerto } from '../src/componentes/PainelHistorico';
import { derivar, type Derivado } from '../src/dados';
import { rascunhoNovo, type Rascunho } from '../src/estado';
import {
  apurar,
  placarAcerto,
  resumir,
  salvarNoHistorico,
  type EntradaHistorico,
} from '../src/historico';

const r: Rascunho = {
  ...rascunhoNovo(),
  jogo: { casa: 'A', fora: 'B', competicao: 'X', data: '2099-10-26', hora: '20:00' },
  casas: ['1win'],
  odds: [
    { casa: '1win', mercado: 'total', lado: 'over', linha: 1.5, odd: 1.4, periodo: 'FT' },
    { casa: '1win', mercado: 'total', lado: 'under', linha: 1.5, odd: 3, periodo: 'FT' },
    { casa: '1win', mercado: 'total', lado: 'over', linha: 2.5, odd: 1.9, periodo: 'FT' },
    { casa: '1win', mercado: 'total', lado: 'under', linha: 2.5, odd: 1.9, periodo: 'FT' },
  ],
} as Rascunho;
const entrada = {
  linha: r.odds[0],
  descricao: 'sair mais de 1,5 gols.',
  odd: 1.4,
  casa: '1win',
  ev: 0.02,
  pFinal: 0.72,
};
const salva = (
  id: string,
  chance: number,
  placar?: [number, number],
  semLista = false,
): EntradaHistorico => ({
  id,
  salvoEm: '2099-10-26T10:00:00-03:00',
  rascunho: r,
  resumo: {
    jogo: 'A × B',
    competicao: 'X',
    inicio: '2099-10-26T20:00:00-03:00',
    decisao: 'NO_BET',
    rotulo: '',
    dq: 'A',
    motivos: [],
    confianca: semLista
      ? []
      : [
          {
            linha: r.odds[0],
            descricao: entrada.descricao,
            odd: 1.4,
            casa: '1win',
            chance,
            minimo: 1 / 1.4,
            forca: 'forte',
          },
        ],
  },
  resultado: placar
    ? { casa: placar[0], fora: placar[1], registradoEm: '2099-10-26T23:00:00-03:00' }
    : undefined,
});

describe('entrada escolhida na lista', () => {
  const d = derivar(r);
  it('é ela que vale na apuração, e continua valendo ao salvar de novo', () => {
    const aposta = { odd: 1.4, casa: '1win', feitaEm: '2099-10-26T10:00:00-03:00', entrada };
    const { lista, id } = salvarNoHistorico([], { ...r, idHistorico: 'x' }, d, aposta);
    expect(lista[0].resumo.entrada?.descricao).toBe(entrada.descricao);
    const denovo = salvarNoHistorico(lista, { ...r, idHistorico: id }, d).lista[0];
    expect(denovo.resumo.entrada?.descricao).toBe(entrada.descricao);
    const a = apurar({ ...denovo, resultado: { casa: 2, fora: 0, registradoEm: 'x' } });
    expect(a).toMatchObject({ ok: true, resultado: 1 });
    expect(a?.ok && a.lucro).toBeCloseTo(0.4);
  });
});

describe('placar de acerto', () => {
  it('separa por faixa, conta 1 por jogo e deixa os sem placar pendentes', () => {
    const p = placarAcerto([
      salva('a', 0.72, [2, 1]),
      salva('b', 0.75, [0, 0]),
      salva('c', 0.65, [3, 0]),
      salva('d', 0.65),
      salva('e', 0, [1, 1], true),
    ]);
    expect(p.comEntrada).toBe(4);
    expect(p.pendentes).toBe(1);
    expect(p.apuradas).toBe(3);
    expect(p.faixas[2]).toMatchObject({ apuradas: 2, green: 1, red: 1, acerto: 0.5 });
    expect(p.faixas[1]).toMatchObject({ apuradas: 1, green: 1 });
    expect(p.total.unidades).toBeCloseTo(0.4 - 1 + 0.4);
    const html = renderToString(createElement(PlacarDeAcerto, { p }));
    expect(html).toContain('Ainda cedo para confiar');
    expect(html).toContain('De 60% a 70%');
  });
  it('jogo salvo antes da lista existir fica fora', () => {
    const antiga = salva('z', 0, [1, 0]);
    delete antiga.resumo.confianca;
    expect(placarAcerto([antiga]).comEntrada).toBe(0);
  });
});

describe('tela', () => {
  const tela = (d: Partial<Derivado>) =>
    renderToString(
      createElement(MelhoresEntradas, {
        d: d as Derivado,
        podeEntrar: true,
        onEntrar: () => undefined,
      }),
    );
  const base = { entradas: [], recusadas: [] };
  const lidas = derivar(r).opcoes;
  it('explica quando faltam as estatísticas', () => {
    expect(tela({ opcoes: [], entradas: { ...base, status: 'sem_estatisticas' } })).toContain(
      'Faltam as estatísticas',
    );
  });
  it('dia sem entrada é uma resposta, não um erro', () => {
    expect(tela({ opcoes: [], entradas: { ...base, status: 'ok' } })).toContain('não tem entrada');
  });
  it('com a lista vazia ainda dá para escolher e registrar qualquer aposta lida', () => {
    const html = tela({ opcoes: lidas, entradas: { ...base, status: 'sem_estatisticas' } });
    expect(lidas).toHaveLength(4);
    expect(html).toContain('mesmo com NO BET');
    expect(html).toContain('sair mais de 2,5 gols');
  });
  it('uma aposta escolhida fora da lista é a que vale na apuração', () => {
    const o = lidas.find((x) => x.linha.linha === 2.5 && x.linha.lado === 'under')!;
    const ent = {
      linha: o.linha as (typeof r.odds)[number],
      descricao: o.descricao,
      odd: o.odd,
      casa: o.casa,
      ev: o.ev,
      pFinal: o.chance,
    };
    const aposta = { odd: o.odd, casa: o.casa, feitaEm: '2099-10-26T10:00:00-03:00', entrada: ent };
    const { lista } = salvarNoHistorico([], r, derivar(r), aposta);
    const a = apurar({ ...lista[0], resultado: { casa: 1, fora: 0, registradoEm: 'x' } });
    expect(a).toMatchObject({ ok: true, resultado: 1 });
  });
  it('sem estatísticas a análise salva não inventa entrada', () => {
    expect(resumir(r, derivar(r)).confianca).toEqual([]);
  });
});
