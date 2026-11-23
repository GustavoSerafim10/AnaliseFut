/**
 * Ponta a ponta: arquivos → conjunto normalizado. Conservação até a normalização, impressão
 * determinística e o recorte da faixa preferencial (só filtra registros; nenhuma taxa).
 */
import { describe, expect, it } from 'vitest';
import {
  FAIXAS_PREFERENCIAIS,
  montarConjunto,
  recortarSelecoes,
  VERSAO_CONTRATO,
} from '../src/index';
import { backupGz, backupV1, backupV2, cenario, comApostaEResultado } from './fixtures/geradores';

async function arquivos() {
  const c = await cenario();
  const e = comApostaEResultado(c.entrada, { oddFechamento: 1.8, fechamentoOutros: [2.1] });
  const semChave = { ...structuredClone(c.entrada), id: 'sem-chave' };
  semChave.resumo.inicio = '';
  return [
    { nome: 'a.json.gz', bytes: await backupGz([e], c.revisoes) },
    { nome: 'b.json', bytes: backupV2([c.entrada], c.revisoes.slice(0, 2)) },
    { nome: 'c.json', bytes: backupV1([semChave]) },
  ];
}

describe('montarConjunto', () => {
  it('jogos, análises, seleções e apostas a partir de backups reais da Fase 0', async () => {
    const k = await montarConjunto(await arquivos());
    expect(k.contrato).toBe(VERSAO_CONTRATO);
    expect(k.jogos).toHaveLength(1);
    expect(k.analises).toHaveLength(1);
    expect(k.analises[0].revisaoDecisao).toBe(3);
    expect(k.selecoes).toHaveLength(7);
    expect(k.apostas).toHaveLength(1);
    expect(k.apostas[0].clv.principal).not.toBeNull();
    expect(k.derivacaoPendente).toEqual(['pModeloBruto', 'pMistura', 'wMistura', 'desfecho']);
  });

  it('conservação até o fim: nada some sem categoria', async () => {
    const k = await montarConjunto(await arquivos());
    expect(k.conservacao.historico).toEqual({
      fisicos: 3,
      canonicos: 2,
      duplicatas: 0,
      substituidos: 1,
      excluidos: 0,
    });
    expect(k.conservacao.evidencias).toEqual({
      fisicos: 6,
      canonicos: 4,
      duplicatas: 2,
      substituidos: 0,
      excluidos: 0,
    });
    expect(k.conservacao.normalizacao).toEqual({
      entradasCanonicas: 2,
      analises: 1,
      semChaveDeJogo: 1,
      evidenciasCanonicas: 4,
      evidenciasEmAnalises: 4,
      evidenciasDeAnaliseExcluida: 0,
    });
    expect(k.exclusoes.map((x) => [x.categoria, x.id])).toEqual([['jogo-sem-chave', 'sem-chave']]);
    expect(k.substituidas).toHaveLength(1);
  });

  it('determinístico: a mesma entrada em qualquer ordem dá a mesma impressão', async () => {
    const a = await arquivos();
    const k1 = await montarConjunto(a);
    const k2 = await montarConjunto([...a].reverse());
    expect(k1.impressao).toMatch(/^[0-9a-f]{64}$/);
    expect(k2.impressao).toBe(k1.impressao);
    const k3 = await montarConjunto(a.slice(0, 2));
    expect(k3.impressao).not.toBe(k1.impressao);
  });

  it('nenhum arquivo: conjunto vazio, conservação zerada', async () => {
    const k = await montarConjunto([]);
    expect([k.jogos, k.analises, k.selecoes, k.apostas, k.exclusoes]).toEqual([[], [], [], [], []]);
  });
});

describe('recorte (Q7)', () => {
  it('faixa preferencial × grupo × tipo × camada: devolve chaves, nunca taxas', async () => {
    const k = await montarConjunto(await arquivos());
    expect(FAIXAS_PREFERENCIAIS).toEqual(['1,40–1,60', '1,60–1,80', '1,80–2,00']);
    const r = recortarSelecoes(k, {
      faixas: FAIXAS_PREFERENCIAIS,
      grupo: 'principal',
      tiposAposta: ['gols-jogo'],
      camada: 'betV4',
    });
    expect(r).toEqual(['jogo-1#total|FT|-|2.5|over']);
    expect(recortarSelecoes(k, { faixas: ['acima-3,00'], camada: 'betV4' })).toEqual([]);
    expect(recortarSelecoes(k, {})).toHaveLength(7);
  });
});
