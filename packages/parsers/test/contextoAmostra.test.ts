/**
 * Competição e temporada da amostra, lidas do cabeçalho dos prints (fixtures reais + casos
 * sintéticos). Só exibição: nada disto entra no λ nem na DQ.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chaveDeCompeticao, lerContextoAmostra, lerTemporada } from '../src/contextoAmostra';

const fx = (n: string) => readFileSync(new URL(`./fixtures-reais/${n}`, import.meta.url), 'utf8');
const resumo = (texto: string, fonte: 'sofascore' | 'superscore') =>
  lerContextoAmostra(texto, fonte).map((x) => [
    x.lado,
    x.chaveCompeticao,
    x.temporada,
    x.confianca,
  ]);

describe('temporada', () => {
  it.each([
    ['2026', '2026', false],
    ['2026/27', '2026/27', false],
    ['2025-2026', '2025/26', false],
    ['26/27', '2026/27', false],
    ['2627', '2026/27', true],
  ])('%s → %s', (t, esperado, reconstruida) =>
    expect(lerTemporada(t)).toEqual({ temporada: esperado, reconstruida }),
  );
  it.each(['2629', '26/28', '20%', '202%', '2026/28', ''])(
    '%s → ilegível (nunca adivinhada)',
    (t) => expect(lerTemporada(t)).toBeNull(),
  );
});

describe('chave de competição: grafias da mesma competição', () => {
  it('Brasileirão nas três grafias; Série A italiana à parte', () => {
    const k = chaveDeCompeticao('Campeonato Brasileiro Série A');
    expect(chaveDeCompeticao('Brasileiro-SérieA')).toBe(k);
    expect(chaveDeCompeticao('Brasileiro Serie A')).toBe(k);
    expect(chaveDeCompeticao('Brasileirão Série A')).toBe(k);
    expect(chaveDeCompeticao('Série A')).not.toBe(k);
    expect(chaveDeCompeticao('SerieA')).toBe(chaveDeCompeticao('Série A'));
  });
});

describe('SofaScore (comparação de equipes), prints reais', () => {
  it('Vasco: mandante com 2026; visitante sem temporada → parcial', () => {
    expect(resumo(fx('sofascore-vasco-1.txt'), 'sofascore')).toEqual([
      ['casa', 'brasileiroseriea', '2026', 'lida'],
      ['fora', 'brasileiroseriea', null, 'parcial'],
    ]);
  });
  it('Remo: temporada ilegível ("20%") fica null, sem chute', () => {
    expect(resumo(fx('sofascore-remo-1.txt'), 'sofascore')).toEqual([
      ['casa', 'brasileiroseriea', null, 'parcial'],
      ['fora', 'brasileiroseriea', null, 'parcial'],
    ]);
  });
  it('Remo com zoom: lixo "ED" antes do nome não cria competição falsa', () => {
    expect(resumo(fx('sofascore-remo-zoom.txt'), 'sofascore')[0]).toEqual([
      'casa',
      'brasileiroseriea',
      '2026',
      'lida',
    ]);
  });
  it('Frosinone: "2627" → 2026/27 reconstruída nos dois lados', () => {
    expect(resumo(fx('sofascore-frosinone-1.txt'), 'sofascore')).toEqual([
      ['casa', 'seriea', '2026/27', 'reconstruida'],
      ['fora', 'seriea', '2026/27', 'reconstruida'],
    ]);
  });
  it('a linha dos nomes dos times nunca vira competição; cabeçalho cortado → vazio', () => {
    for (const f of [
      'sofascore-londrina-zoom-60.txt',
      'sofascore-londrina-zoom-75.txt',
      'sofascore-remo-2.txt',
    ])
      expect(lerContextoAmostra(fx(f), 'sofascore'), f).toEqual([]);
    const r = lerContextoAmostra(fx('sofascore-vasco-1.txt'), 'sofascore');
    expect(r.map((x) => x.competicao)).not.toContain('Vasco da Gama Flamengo');
  });
});

describe('SuperScore, prints reais', () => {
  it('Brasileiro Série A 2026 (Remo, Vasco) e Série A 26/27 (Frosinone, 2 páginas), para os dois times', () => {
    for (const f of ['superscore-remo-1.txt', 'superscore-remo-3.txt', 'superscore-vasco-1.txt'])
      expect(resumo(fx(f), 'superscore'), f).toEqual([
        ['ambos', 'brasileiroseriea', '2026', 'lida'],
      ]);
    for (const f of ['superscore-frosinone-1.txt', 'superscore-frosinone-2.txt'])
      expect(resumo(fx(f), 'superscore'), f).toEqual([['ambos', 'seriea', '2026/27', 'lida']]);
  });
  it('sem a linha da competição (só "Média") → vazio', () => {
    expect(lerContextoAmostra(fx('superscore-media-1.txt'), 'superscore')).toEqual([]);
  });
});

describe('casos sintéticos', () => {
  const sofa = (linha: string) =>
    `Comparação de equipes\nAdicionar outra equipe\nTime A Time B\nBrasil Brasil\n${linha}\nGeral\nPartidas 10 10`;
  it('"Todas as competições" é marcado explicitamente, nunca competição única', () => {
    const r = lerContextoAmostra(
      sofa('Todas as competições v 2026 v Campeonato Brasileiro Série A v 2026'),
      'sofascore',
    );
    expect(r[0]).toMatchObject({ lado: 'casa', todasCompeticoes: true, chaveCompeticao: null });
    expect(r[1]).toMatchObject({
      lado: 'fora',
      todasCompeticoes: false,
      chaveCompeticao: 'brasileiroseriea',
    });
    const s = lerContextoAmostra(
      'ESTATÍSTICAS PRINCIPAIS\nTodas as competições\n11 Gols 14',
      'superscore',
    );
    expect(s[0]).toMatchObject({ lado: 'ambos', todasCompeticoes: true });
  });
  it('competições diferentes por lado ficam separadas (esquerda = mandante)', () => {
    const r = lerContextoAmostra(
      sofa('Copa do Brasil v 2026 v Campeonato Brasileiro Série A v 2026'),
      'sofascore',
    );
    expect(r.map((x) => [x.lado, x.chaveCompeticao])).toEqual([
      ['casa', 'copadobrasil'],
      ['fora', 'brasileiroseriea'],
    ]);
  });
});
