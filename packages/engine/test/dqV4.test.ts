/** DQ D/E na V4: nem a referência R1/R2 autoriza BET ou stake (a qualidade dos dados manda). */
import { describe, expect, it } from 'vitest';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, type ApoioModelo, type EntradaV4 } from '../src/v4';

const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2026-10-26T20:00:00-03:00' };
const AGORA = '2026-10-26T16:00:00-03:00';
const ou = (casa: string, over: number, under: number): LinhaOdd[] =>
  (['over', 'under'] as const).map((lado, i) => ({
    casa,
    mercado: 'total' as TipoMercado,
    lado,
    odd: i === 0 ? over : under,
    linha: 2.5,
    periodo: 'FT',
    horarioColeta: '2026-10-26T16:00:00-03:00',
  }));
const r1 = [...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.1, 1.72)];
const r2 = [
  ...ou('Bet365', 1.9, 1.9),
  ...ou('Superbet', 1.9, 1.9),
  ...ou('1win', 1.9, 1.9),
  ...ou('Betano', 2.12, 1.8),
];
const apoio = (dq: ApoioModelo['dq']): ApoioModelo => ({
  // λ coerentes com ~50% de over: o filtro do modelo não interfere
  lambdas: { casa: 1.4, fora: 1.1 },
  dq,
  w: ({ A: 0.5, B: 0.4, C: 0.3, D: 0.2, E: null } as const)[dq],
  jogosMin: 10,
});
const entrada = (linhas: LinhaOdd[], extra: Partial<EntradaV4> = {}): EntradaV4 => ({
  jogo: JOGO,
  agora: AGORA,
  linhas,
  ligaPrincipal: true,
  banca: 1000,
  ...extra,
});

describe('V4: DQ D e E não autorizam BET nem stake', () => {
  for (const [nome, linhas, nivel] of [
    ['R1', r1, 'R1'],
    ['R2', r2, 'R2'],
  ] as const)
    for (const dq of ['D', 'E'] as const)
      it(`${nome} com DQ ${dq}: NO_BET, sem stake, com o motivo da DQ`, () => {
        const r = analisarV4(entrada(linhas, { apoio: apoio(dq) }));
        expect(r.referencia.nivel).toBe(nivel);
        expect(r.decisao).toBe('NO_BET');
        expect(r.melhor?.stake ?? null).toBeNull();
        expect(r.motivos.join(' ')).toContain(`DQ ${dq}`);
        expect(r.motivos.join(' ')).toContain('não substitui a qualidade dos dados');
      });

  it('o mesmo jogo com DQ A, B e C mantém o fluxo atual (BET com stake)', () => {
    for (const linhas of [r1, r2])
      for (const dq of ['A', 'B', 'C'] as const) {
        const r = analisarV4(entrada(linhas, { apoio: apoio(dq) }));
        expect(r.decisao).toBe('BET');
        expect(r.melhor!.stake!.fracaoBanca).toBeGreaterThan(0);
      }
  });

  it('sem estatísticas (sem apoio) não há DQ a avaliar: o fluxo de preço puro continua', () => {
    expect(analisarV4(entrada(r1)).decisao).toBe('BET');
    expect(analisarV4(entrada(r2)).decisao).toBe('BET');
  });

  it('a DQ não muda preço, P_true, EV nem os gates: só a decisão final', () => {
    const a = analisarV4(entrada(r1, { apoio: apoio('C') }));
    const d = analisarV4(entrada(r1, { apoio: apoio('D') }));
    expect(d.avaliadas.map((x) => [x.chave, x.ev, x.pTrue, x.evMinimo])).toEqual(
      a.avaliadas.map((x) => [x.chave, x.ev, x.pTrue, x.evMinimo]),
    );
    expect(d.melhor!.ev).toBe(a.melhor!.ev);
    expect(d.melhor!.pTrue).toBe(a.melhor!.pTrue);
  });

  it('o EV abaixo do gate continua sendo o primeiro motivo (a DQ não o esconde)', () => {
    const r = analisarV4(
      entrada([...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 1.9, 1.9)], { apoio: apoio('D') }),
    );
    expect(r.decisao).toBe('NO_BET');
    expect(r.motivos.join(' ')).toContain('abaixo do gate');
    expect(r.motivos.join(' ')).not.toContain('DQ D');
  });
});
