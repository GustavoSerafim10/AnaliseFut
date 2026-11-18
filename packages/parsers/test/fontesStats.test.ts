/**
 * Prints de estatísticas: vários prints da MESMA fonte (etapa 1) e o cruzamento SofaScore ×
 * SuperScore (etapa 2). Nenhum valor some em silêncio: conflito escolhe pelo critério declarado
 * e deixa aviso.
 */
import { describe, expect, it } from 'vitest';
import { juntarLeiturasStats, type LeituraStats, type ValorLido } from '../src';

const leitura = (campos: LeituraStats['campos']): LeituraStats => ({
  fonte: 'sofascore',
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
