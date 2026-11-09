import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerEstatisticas, lerEstatisticasConsenso } from '../src';

const jogo = { casa: 'Londrina', fora: 'Náutico' };
// mesmo print do SofaScore com a página a 75% e a 60%: 5 leituras de cada (OCR real)
const leituras = (zoom: string) =>
  readFileSync(new URL(`./fixtures-reais/sofascore-londrina-${zoom}.txt`, import.meta.url), 'utf8')
    .split(/^===== .* =====$/m)
    .filter((t) => t.trim());

const valores = (zoom: string) => lerEstatisticasConsenso(leituras(zoom), 'sofascore', jogo).campos;

describe('votação entre leituras do mesmo print', () => {
  it('75%: sozinha, a primeira leitura perde gols e erra assistências', () => {
    const c = lerEstatisticas(leituras('zoom-75')[0], 'sofascore', jogo).campos;
    expect(c.golsMarcados?.fora).toBeUndefined();
    expect(c.golsSofridos?.fora).toBeUndefined();
    expect([c.assistencias?.casa, c.assistencias?.fora]).toEqual([2, 5]);
  });
  it('75%: votando, os valores saem certos', () => {
    const c = valores('zoom-75');
    expect([c.golsMarcados?.casa, c.golsMarcados?.fora]).toEqual([45, 40]);
    expect([c.golsSofridos?.casa, c.golsSofridos?.fora]).toEqual([58, 46]);
    expect([c.assistencias?.casa, c.assistencias?.fora]).toEqual([29, 25]);
    expect([c.nota?.casa, c.nota?.fora]).toEqual([6.77, 6.81]);
    expect([c.grandesChancesPerdidas?.casa, c.grandesChancesPerdidas?.fora]).toEqual([1.2, 1.3]);
  });
  it('60%: lê até passes certos', () => {
    const c = valores('zoom-60');
    expect([c.passesCertos?.casa, c.passesCertos?.fora]).toEqual([311.7, 352.7]);
    expect([c.chutesNoAlvo?.casa, c.chutesNoAlvo?.fora]).toEqual([3.9, 4.5]);
    expect([c.interceptacoes?.casa, c.interceptacoes?.fora]).toEqual([8.2, 8.2]);
  });
  it('empate fica com a primeira leitura; uma leitura só não muda nada', () => {
    const a = 'Gols marcados 45 40';
    const b = 'Gols marcados 46 41';
    const empate = lerEstatisticasConsenso([a, b], 'sofascore', jogo).campos.golsMarcados;
    expect([empate?.casa, empate?.fora]).toEqual([45, 40]);
    expect(lerEstatisticasConsenso([a], 'sofascore', jogo)).toEqual(
      lerEstatisticas(a, 'sofascore', jogo),
    );
  });
  it('sem aviso de valor ilegível quando há outras leituras', () => {
    const a = lerEstatisticasConsenso(
      ['Gols marcados 45', 'Gols marcados 45 40'],
      'sofascore',
      jogo,
    );
    expect(a.avisos).toEqual([]);
  });
  it('dois contra um: ganha o valor com mais votos', () => {
    const c = lerEstatisticasConsenso(
      ['Gols marcados 46 41', 'Gols marcados 45 40', 'Gols marcados 45 40'],
      'sofascore',
      jogo,
    ).campos.golsMarcados;
    expect([c?.casa, c?.fora]).toEqual([45, 40]);
  });
});
