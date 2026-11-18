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

/** reparo de verdade: o número mudou além da rotina (o "1" do início que sumiu) */
const REPARO = '[casa] 3.8 fora da faixa: lido como 13.8 (o "1" do início sumiu no OCR), conferir';
/** rotina do SofaScore: quase todo valor perde o ponto no OCR e a correção é certa */
const ROTINA = '[casa] ponto decimal perdido no OCR: 39 lido como 3.9';

describe('etapa 1: prints da mesma fonte com valores diferentes', () => {
  it('o print sem reparo vence o reparado, mesmo vindo depois', () => {
    const j = juntarLeiturasStats([
      leitura({ chutesNoAlvo: v(13.8, 5.3, [REPARO]) }),
      leitura({ chutesNoAlvo: v(3.9, 5.3) }),
    ])!;
    expect(j.campos.chutesNoAlvo?.casa).toBe(3.9);
    expect(j.campos.chutesNoAlvo?.fora).toBe(5.3);
    const avisos = j.campos.chutesNoAlvo!.avisos.join(' | ');
    expect(avisos).toContain('[casa] prints da mesma fonte divergem (13.8 × 3.9): usando 3.9');
    // o aviso da leitura descartada não fica pendurado no valor escolhido
    expect(avisos).not.toMatch(/sumiu no OCR/);
  });

  it('ponto decimal perdido (rotina) não desempata: fica o primeiro', () => {
    const j = juntarLeiturasStats([
      leitura({ chutesNoAlvo: v(3.9, 5.3, [ROTINA]) }),
      leitura({ chutesNoAlvo: v(4.8, 5.3) }),
    ])!;
    expect(j.campos.chutesNoAlvo?.casa).toBe(3.9);
  });

  it('maioria dos prints vence', () => {
    const j = juntarLeiturasStats([
      leitura({ escanteios: v(5.2, 4.6) }),
      leitura({ escanteios: v(2.5, 4.6) }),
      leitura({ escanteios: v(2.5, 4.6) }),
    ])!;
    expect(j.campos.escanteios?.casa).toBe(2.5);
    expect(j.campos.escanteios!.avisos.join(' ')).toContain('divergem (5.2 × 2.5): usando 2.5');
  });

  it('empate sem critério fica com o primeiro, mas avisa', () => {
    const j = juntarLeiturasStats([
      leitura({ escanteios: v(5.2, 4.6) }),
      leitura({ escanteios: v(6.1, 4.6) }),
    ])!;
    expect(j.campos.escanteios?.casa).toBe(5.2);
    expect(j.campos.escanteios!.avisos.join(' ')).toContain('divergem (5.2 × 6.1): usando 5.2');
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
  it('vence a fonte cujo valor veio sem reparo de OCR', () => {
    const t = consolidar({
      sofascore: leitura({ chutesNoAlvo: v(13.8, 5.3, [REPARO]) }),
      superscore: leitura({ chutesNoAlvo: v(3.9, 5.3) }, 'superscore'),
    });
    expect(t.chutesNoAlvo?.casa).toMatchObject({
      valor: 3.9,
      fonte: 'superscore',
      divergente: true,
    });
    expect(t.chutesNoAlvo!.casa.avisos.join(' ')).toContain(
      'fontes divergem > 15% (13.8 × 3.9): usando superscore (o valor do sofascore teve reparo de OCR)',
    );
    // o outro time, sem divergência, segue pela média
    expect(t.chutesNoAlvo?.fora).toMatchObject({ valor: 5.3, fonte: 'média' });
  });

  it('ponto decimal perdido (rotina do SofaScore) não tira a preferência dele', () => {
    // caso do Londrina × Náutico: TODO valor do SofaScore veio com esse aviso
    const t = consolidar({
      sofascore: leitura({ chutesNoAlvo: v(3.9, 4.5, [ROTINA]) }),
      superscore: leitura({ chutesNoAlvo: v(5.1, 4.5) }, 'superscore'),
    });
    expect(t.chutesNoAlvo?.casa).toMatchObject({ valor: 3.9, fonte: 'sofascore' });
  });

  it('as duas limpas (ou as duas reparadas): preferência de sempre', () => {
    const t = consolidar({
      sofascore: leitura({ escanteios: v(5.2, 4.6), xg: v(1.0, 1.3) }),
      superscore: leitura({ escanteios: v(7.0, 4.6), xg: v(1.6, 1.3) }, 'superscore'),
    });
    expect(t.escanteios?.casa).toMatchObject({ valor: 5.2, fonte: 'sofascore' });
    expect(t.xg?.casa).toMatchObject({ valor: 1.6, fonte: 'superscore' });
  });

  it('caso real Remo × Botafogo: o 208 errado do SofaScore só tinha aviso de rotina, segue com aviso de divergência', () => {
    // limitação declarada: "2080(811%)" (era 298,0) não é detectável como erro; fica o
    // aviso "fontes divergem" na tabela e os dois valores no texto para o Claude
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
    expect(t.passesCertos?.casa).toMatchObject({
      valor: 208,
      fonte: 'sofascore',
      divergente: true,
    });
  });
});

describe('etapa 3: nenhum dado do print fica de fora da tabela', () => {
  const F = (n: string) => readFileSync(new URL(`./fixtures-reais/${n}`, import.meta.url), 'utf8');
  const nomes = { casa: 'Remo', fora: 'Botafogo' };

  it('SuperScore: os 13 dados que caíam em "outros" viram campos', () => {
    const l = juntarLeiturasStats(
      ['superscore-remo-1.txt', 'superscore-remo-2.txt', 'superscore-remo-3.txt'].map((a) =>
        lerEstatisticasConsenso([F(a)], 'superscore', nomes),
      ),
    )!;
    expect(l.outros.map((o) => o.rotulo)).toEqual([]);
    expect(l.campos.passesCampoDefesa).toMatchObject({ casa: 139.8, fora: 170.4 });
    expect(l.campos.passesCampoAtaque).toMatchObject({ casa: 158.3, fora: 150.5 });
    expect(l.campos.passesTercoFinal).toMatchObject({ casa: 71, fora: 70.5 });
    expect(l.campos.bolasLongasCertas).toMatchObject({ casa: 4.6, fora: 4.8 });
    expect(l.campos.lancamentos).toMatchObject({ casa: 19.3, fora: 19.3 });
    expect(l.campos.errosFinalizacao).toMatchObject({ casa: 0.6, fora: 1 });
    expect(l.campos.bloqueios).toMatchObject({ casa: 3.1, fora: 4 });
    expect(l.campos.duelosVencidos).toMatchObject({ casa: 45.7, fora: 48.4 });
    expect(l.campos.duelosNoChao).toMatchObject({ casa: 32.5, fora: 35.5 });
    expect(l.campos.duelosAereos).toMatchObject({ casa: 13.2, fora: 12.8 });
    for (const c of ['bolaNaTrave', 'driblesVencidos', 'possesPerdidas'] as const)
      expect(l.campos[c], c).toBeDefined();
    // a "Bolas longas certas" do SuperScore é outra métrica: não vira a do SofaScore
    expect(l.campos.bolasLongas).toBeUndefined();
  });

  it('SofaScore: "Desarmes por partida 45.7 (50.2%)" é duelos vencidos (os mesmos números do SuperScore)', () => {
    const l = lerEstatisticasConsenso([F('sofascore-remo-zoom-2.txt')], 'sofascore', nomes);
    expect(l.campos.duelosVencidos).toMatchObject({ casa: 45.7, fora: 48.4 });
    expect(l.outros.map((o) => o.rotulo)).not.toContain('Desarmes por partida');
    // e o "Desarmes por jogo" de verdade continua no lugar
    expect(l.campos.desarmes).toMatchObject({ casa: 15.1, fora: 15.3 });
  });
});
