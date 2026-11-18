/**
 * Prints de estatísticas: vários prints da MESMA fonte (etapa 1) e o cruzamento SofaScore ×
 * SuperScore (etapa 2). Nenhum valor some em silêncio: conflito escolhe pelo critério declarado
 * e deixa aviso.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  consolidar,
  juntarLeiturasStats,
  lerEstatisticasConsenso,
  type FonteStats,
  type LeituraStats,
  type ValorLido,
} from '../src';

const leitura = (
  campos: LeituraStats['campos'],
  fonte: FonteStats = 'sofascore',
): LeituraStats => ({
  fonte,
  campos,
  outros: [],
  colunasInvertidas: false,
  avisos: [],
});
const v = (casa?: number, fora?: number, avisos: string[] = []): ValorLido => ({
  casa,
  fora,
  bruto: '',
  avisos,
});

describe('etapa 1: prints da mesma fonte com valores diferentes', () => {
  it('o print limpo vence o que teve correção de OCR, mesmo vindo depois', () => {
    const j = juntarLeiturasStats([
      leitura({ chutesNoAlvo: v(38, 5.3, ['[casa] ponto decimal perdido no OCR: 38 lido como 3.8']) }),
      leitura({ chutesNoAlvo: v(3.9, 5.3) }),
    ])!;
    expect(j.campos.chutesNoAlvo?.casa).toBe(3.9);
    expect(j.campos.chutesNoAlvo?.fora).toBe(5.3);
    const avisos = j.campos.chutesNoAlvo!.avisos.join(' | ');
    expect(avisos).toMatch(/\[casa\] prints da mesma fonte divergem \(38 × 3\.9\): usando 3\.9/);
    // o aviso da leitura descartada não fica pendurado no valor escolhido
    expect(avisos).not.toMatch(/ponto decimal perdido/);
  });

  it('maioria dos prints vence', () => {
    const j = juntarLeiturasStats([
      leitura({ escanteios: v(5.2, 4.6) }),
      leitura({ escanteios: v(2.5, 4.6) }),
      leitura({ escanteios: v(2.5, 4.6) }),
    ])!;
    expect(j.campos.escanteios?.casa).toBe(2.5);
    expect(j.campos.escanteios!.avisos.join(' ')).toMatch(/divergem \(5\.2 × 2\.5\): usando 2\.5/);
  });

  it('empate sem critério fica com o primeiro, mas avisa', () => {
    const j = juntarLeiturasStats([
      leitura({ escanteios: v(5.2, 4.6) }),
      leitura({ escanteios: v(6.1, 4.6) }),
    ])!;
    expect(j.campos.escanteios?.casa).toBe(5.2);
    expect(j.campos.escanteios!.avisos.join(' ')).toMatch(/divergem \(5\.2 × 6\.1\): usando 5\.2/);
  });

  it('valores iguais ou complementares não geram aviso', () => {
    const j = juntarLeiturasStats([
      leitura({ escanteios: v(5.2, undefined) }),
      leitura({ escanteios: v(5.2, 4.6) }),
    ])!;
    expect(j.campos.escanteios).toMatchObject({ casa: 5.2, fora: 4.6 });
    expect(j.campos.escanteios!.avisos).toEqual([]);
  });
});

describe('etapa 2: SofaScore × SuperScore divergem mais de 15%', () => {
  it('vence a fonte cujo valor veio sem correção de OCR', () => {
    const t = consolidar({
      sofascore: leitura({
        chutesNoAlvo: v(38, 5.3, ['[casa] ponto decimal perdido no OCR: 38 lido como 3.8']),
      }),
      superscore: leitura({ chutesNoAlvo: v(3.9, 5.3) }, 'superscore'),
    });
    expect(t.chutesNoAlvo?.casa).toMatchObject({ valor: 3.9, fonte: 'superscore', divergente: true });
    expect(t.chutesNoAlvo!.casa.avisos.join(' ')).toMatch(
      /fontes divergem > 15% \(38 × 3\.9\): usando superscore \(o valor do sofascore teve correção de OCR\)/,
    );
    // o outro time, sem divergência, segue pela média
    expect(t.chutesNoAlvo?.fora).toMatchObject({ valor: 5.3, fonte: 'média' });
  });

  it('as duas limpas (ou as duas corrigidas): preferência de sempre', () => {
    const t = consolidar({
      sofascore: leitura({ escanteios: v(5.2, 4.6), xg: v(1.0, 1.3) }),
      superscore: leitura({ escanteios: v(7.0, 4.6), xg: v(1.6, 1.3) }, 'superscore'),
    });
    expect(t.escanteios?.casa).toMatchObject({ valor: 5.2, fonte: 'sofascore' });
    expect(t.xg?.casa).toMatchObject({ valor: 1.6, fonte: 'superscore' });
  });

  it('caso real Remo × Botafogo: "2080(811%)" do SofaScore perde para o 298 do SuperScore', () => {
    const F = (n: string) =>
      readFileSync(new URL(`./fixtures-reais/${n}`, import.meta.url), 'utf8');
    const nomes = { casa: 'Remo', fora: 'Botafogo' };
    const ler = (fonte: FonteStats, arqs: string[]) =>
      juntarLeiturasStats(arqs.map((a) => lerEstatisticasConsenso([F(a)], fonte, nomes)));
    const t = consolidar({
      sofascore: ler('sofascore', ['sofascore-remo-1.txt', 'sofascore-remo-2.txt']),
      superscore: ler('superscore', [
        'superscore-remo-1.txt',
        'superscore-remo-2.txt',
        'superscore-remo-3.txt',
      ]),
    });
    expect(t.passesCertos?.casa).toMatchObject({ valor: 298, fonte: 'superscore' });
  });
});
