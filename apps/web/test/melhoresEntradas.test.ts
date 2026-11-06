/** A lista "Melhores entradas" no site: apuração da entrada escolhida e placar de acerto. */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EscolherAposta, rascunhoRelido } from '../src/componentes/EscolherAposta';
import { MelhoresEntradas } from '../src/componentes/MelhoresEntradas';
import { PlacarDeAcerto } from '../src/componentes/PainelHistorico';
import { derivar, type Derivado } from '../src/dados';
import { rascunhoNovo, type Rascunho } from '../src/estado';
import {
  apostasDoJogo,
  apurar,
  balanco,
  calibracao,
  chaveDaAposta,
  minhasEntradas,
  painel,
  placarAcerto,
  podeSalvarSozinho,
  registrarAposta,
  registrarResultado,
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

describe('mais de uma aposta no mesmo jogo', () => {
  const d = derivar(r);
  const aposta = (i: number, odd: number) => ({
    odd,
    casa: '1win',
    valor: 10,
    feitaEm: '2099-10-26T10:00:00-03:00',
    entrada: { ...entrada, linha: r.odds[i], odd, descricao: `aposta ${i}` },
  });
  const duas = () => {
    const primeira = registrarAposta([], { ...r, idHistorico: 'x' }, d, aposta(0, 1.4));
    return registrarAposta(primeira.lista, { ...r, idHistorico: primeira.id }, d, aposta(3, 1.9));
  };

  it('cada aposta conta sozinha no painel', () => {
    const { lista, id } = duas();
    expect(lista).toHaveLength(2);
    expect(id).toBe('x');
    expect(apostasDoJogo(lista, 'x')).toHaveLength(2);
    expect(minhasEntradas(lista)).toHaveLength(2);
    expect(new Set(lista.map(chaveDaAposta)).size).toBe(2);
  });

  it('salvar a análise de novo não mexe nas apostas', () => {
    const { lista } = duas();
    const denovo = salvarNoHistorico(lista, { ...r, idHistorico: 'x' }, d).lista;
    expect(denovo).toHaveLength(2);
    expect(denovo.map((e) => e.resumo.entrada?.descricao).sort()).toEqual(['aposta 0', 'aposta 3']);
  });

  it('o placar registrado em uma vale para o jogo todo, e cada uma é apurada pelo seu mercado', () => {
    const { lista } = duas();
    const irma = lista.find((e) => e.irmaDe)!;
    const fim = registrarResultado(lista, irma.id, {
      casa: 2,
      fora: 0,
      oddFechamento: 2,
      registradoEm: 'x',
    });
    const [a, b] = [fim.find((e) => e.id === 'x')!, fim.find((e) => e.irmaDe)!];
    expect(a.resultado?.casa).toBe(2);
    expect(apurar(a)).toMatchObject({ ok: true, resultado: 1 }); // mais de 1,5
    expect(apurar(b)).toMatchObject({ ok: true, resultado: 1 }); // menos de 2,5
    expect(b.resultado?.oddFechamento).toBe(2);
    expect(a.resultado?.oddFechamento).toBeUndefined();
    expect(painel(minhasEntradas(fim)).green).toBe(2);
    expect(balanco(minhasEntradas(fim)).apuradas).toBe(2);
    const sem = registrarResultado(fim, 'x', undefined);
    expect(sem.find((e) => e.id === 'x')!.resultado).toBeUndefined();
    expect(sem.find((e) => e.irmaDe)!.resultado?.oddFechamento).toBe(2);
    expect(apurar(sem.find((e) => e.irmaDe)!)).toBeNull();
  });

  it('o mesmo jogo não conta duas vezes no placar de acerto nem no Brier', () => {
    const base = salva('x', 0.72);
    base.aposta = aposta(0, 1.4);
    base.resumo.previsao = {
      modelo1x2: [0.5, 0.3, 0.2],
      mercado1x2: [0.5, 0.3, 0.2],
      over25Modelo: 0.5,
    };
    const { lista } = registrarAposta([base], { ...r, idHistorico: 'x' }, d, aposta(3, 1.9));
    const fim = registrarResultado(lista, 'x', { casa: 2, fora: 0, registradoEm: 'x' });
    expect(placarAcerto(fim).apuradas).toBe(1);
    expect(calibracao(fim).jogos).toBe(1);
  });

  it('aposta nova herda o placar que o jogo já tem, sem o fechamento de outra aposta', () => {
    const base = salva('x', 0.72);
    base.aposta = aposta(0, 1.4);
    base.resultado = { casa: 1, fora: 0, oddFechamento: 1.5, registradoEm: 'x' };
    const { lista } = registrarAposta([base], { ...r, idHistorico: 'x' }, d, aposta(3, 1.9));
    const irma = lista.find((e) => e.irmaDe)!;
    expect(irma.resultado?.casa).toBe(1);
    expect(irma.resultado?.oddFechamento).toBeUndefined();
  });
});

describe('salvar no histórico', () => {
  it('salva sozinho qualquer decisão, para o levantamento depois', () => {
    const d = derivar(r);
    expect(d.v4?.decisao).not.toBe('BET');
    expect(podeSalvarSozinho(r, d)).toBe(true);
    const { lista } = salvarNoHistorico([], r, d);
    expect(lista[0].resumo.decisao).toBe(d.v4?.decisao);
  });
  it('jogo novo vem com "Liga bem coberta" desmarcada', () => {
    expect(rascunhoNovo().config.ligaTop).toBe(false);
  });
});

describe('entrar em uma aposta pelo Histórico', () => {
  it('oferece as apostas lidas, relendo os prints, e registra a escolhida', () => {
    const comPrint: Rascunho = {
      ...r,
      idHistorico: 'x',
      // a odd guardada veio de um leitor antigo; o print diz 1.60
      odds: [{ ...r.odds[0], odd: 9, fonte: 'ocr' }],
      prints: {
        'odds:1win': [
          { nome: 'p.png', texto: 'Total\nmais de 1.5 1,60 menos de 1.5 2,30', capturadoEm: '' },
        ],
      },
    } as unknown as Rascunho;
    const relido = rascunhoRelido(comPrint);
    const d = derivar(relido);
    const over = d.opcoes.find((o) => o.linha.lado === 'over')!;
    expect(over.odd).toBe(1.6);
    const { lista } = salvarNoHistorico([], comPrint, derivar(comPrint));
    const html = renderToString(
      createElement(EscolherAposta, {
        e: lista[0],
        registradas: [],
        onConfirmar: () => undefined,
        onCancelar: () => undefined,
      }),
    );
    expect(html).toContain('Em qual aposta você entrou?');
    expect(html).toContain('sair mais de 1,5 gols');
    const aposta = {
      odd: 1.6,
      casa: '1win',
      feitaEm: '2099-10-26T10:00:00-03:00',
      entrada: {
        linha: over.linha as (typeof r.odds)[number],
        descricao: 'sair mais de 1,5 gols.',
        odd: 1.6,
        casa: '1win',
        ev: 0,
        pFinal: 0.7,
      },
    };
    const fim = registrarAposta(lista, relido, d, aposta).lista;
    expect(fim).toHaveLength(1);
    expect(fim[0].resumo.entrada?.descricao).toBe('sair mais de 1,5 gols.');
    expect(fim[0].aposta?.odd).toBe(1.6);
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
        registradas: new Set<string>(),
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
  it('jogo com a data errada oferece corrigir, em vez de só dizer que começou', () => {
    const html = renderToString(
      createElement(MelhoresEntradas, {
        d: { opcoes: [], entradas: { ...base, status: 'jogo_iniciado' } } as unknown as Derivado,
        registradas: new Set<string>(),
        dataErrada: { atual: '2026-11-05', certa: '2026-11-06', corrigir: () => undefined },
        onEntrar: () => undefined,
      }),
    );
    const texto = html.replace(/<!-- -->/g, '');
    expect(texto).toContain('cadastrado para 05/11/2026');
    expect(texto).toContain('Corrigir a data para 06/11/2026');
    expect(html).not.toContain('O jogo já começou');
  });
  it('aposta já registrada sai do seletor', () => {
    const k = lidas[0].chave;
    const html = renderToString(
      createElement(MelhoresEntradas, {
        d: { opcoes: lidas, entradas: { ...base, status: 'ok' } } as unknown as Derivado,
        registradas: new Set([k]),
        onEntrar: () => undefined,
      }),
    );
    expect(html).not.toContain(`value="${k}"`);
    expect(html).toContain(`value="${lidas[1].chave}"`);
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
