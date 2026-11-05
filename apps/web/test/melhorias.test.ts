import { describe, expect, it } from 'vitest';
import { agruparDescartes } from '../src/descartes';
import {
  exportarJson,
  importarJson,
  lerExtrasBackup,
  podeSalvarSozinho,
  salvarNoHistorico,
} from '../src/historico';
import { rascunhoNovo, type Rascunho } from '../src/estado';
import type { Derivado } from '../src/dados';

const rascunho = (m: Partial<Rascunho['jogo']> = {}): Rascunho => ({
  ...rascunhoNovo(),
  jogo: { casa: 'A', fora: 'B', competicao: '', data: '2026-11-05', hora: '19:30', ...m },
});
const derivado = (decisao: string, odds = 1) =>
  ({
    oddsValidas: Array(odds).fill({}),
    v4: { decisao, rotulo: decisao, motivos: [], melhor: null },
    dq: { dq: 'C' },
    pendenciasV4: [],
  }) as unknown as Derivado;
const antes = Date.parse('2026-11-05T12:00:00-03:00');
const depois = Date.parse('2026-11-05T20:00:00-03:00');

describe('salvar sozinho', () => {
  it('com times, odds e antes do início', () => {
    expect(podeSalvarSozinho(rascunho(), derivado('NO_BET'), antes)).toBe(true);
  });
  it('sem odds, sem time ou com o jogo começado: não', () => {
    expect(podeSalvarSozinho(rascunho(), derivado('NO_BET', 0), antes)).toBe(false);
    expect(podeSalvarSozinho(rascunho({ fora: '' }), derivado('NO_BET'), antes)).toBe(false);
    expect(podeSalvarSozinho(rascunho(), derivado('EXCLUIDO'), depois)).toBe(false);
  });
});

describe('a decisão que valeu fica congelada depois do início', () => {
  it('atualizar depois do jogo não troca a decisão por "excluído"', () => {
    const r = rascunho();
    const { lista, id } = salvarNoHistorico([], r, derivado('NO_BET'), undefined, antes);
    const depoisDoJogo = salvarNoHistorico(
      lista,
      { ...r, idHistorico: id },
      derivado('EXCLUIDO'),
      undefined,
      depois,
    );
    expect(depoisDoJogo.lista[0].resumo.decisao).toBe('NO_BET');
  });
  it('antes do início a decisão acompanha a análise', () => {
    const r = rascunho();
    const { lista, id } = salvarNoHistorico([], r, derivado('NO_BET'), undefined, antes);
    const nova = salvarNoHistorico(
      lista,
      { ...r, idHistorico: id },
      derivado('BET'),
      undefined,
      antes,
    );
    expect(nova.lista[0].resumo.decisao).toBe('BET');
  });
});

describe('backup completo', () => {
  const extras = {
    banca: 500,
    rascunho: rascunho(),
    cores: { milan: { cor1: '#ff0000', cor2: '#000000' } },
    escudos: { milan: { imagem: 'data:image/png;base64,AA' } },
  };
  it('leva banca, rascunho, cores e escudos', () => {
    expect(lerExtrasBackup(exportarJson([], extras))).toEqual(extras);
  });
  it('o histórico continua importando normal', () => {
    const { lista } = salvarNoHistorico([], rascunho(), derivado('NO_BET'), undefined, antes);
    const r = importarJson(exportarJson(lista, extras), []);
    expect('lista' in r && r.lista).toHaveLength(1);
  });
  it('backup antigo, só com o histórico: extras vazios', () => {
    expect(lerExtrasBackup('{"versao":1,"historico":[]}')).toEqual({});
    expect(lerExtrasBackup('não é json')).toEqual({});
  });
});

describe('descartados agrupados', () => {
  const d = (motivo: string, i: number) => ({ chave: String(i), descricao: `m${i}`, motivo });
  const g = agruparDescartes([
    d('liga principal sem referência: o modelo não precifica', 1),
    d('liga principal sem referência: o modelo não precifica', 2),
    d('mercado incompleto: faltam lados para tirar a margem', 3),
    d('DC sem 1X2 da mesma casa para tirar a margem', 4),
    d('margem da referência 17.9% > 10%: só informação', 5),
    d('margem da referência 10.2% > 10%: só informação', 6),
    d('motivo novo', 7),
  ]);
  it('leitura incompleta vem primeiro e marcada', () => {
    expect(g[0].atencao).toBe(true);
    expect(g[0].itens).toHaveLength(2);
  });
  it('margens diferentes caem no mesmo grupo; motivo desconhecido fica como veio', () => {
    expect(g.find((x) => x.titulo.startsWith('Margem'))?.itens).toHaveLength(2);
    expect(g.some((x) => x.titulo === 'motivo novo')).toBe(true);
    expect(g.reduce((s, x) => s + x.itens.length, 0)).toBe(7);
  });
});
