/**
 * D1 (auditoria do Kelly): saldo residual de ponto flutuante NÃO vira BET.
 *
 * As exposições do dia e do jogo chegam como soma em R$ dividida pela banca. O mesmo total pode
 * deixar folga 0 ou uma "poeira" (ex.: R$ 7,30 + 33,30 + 19,40 = R$ 60,00 de R$ 1.000 dá
 * expostoHoje 0,05999999999999999 e folga 7e-18), e a V4 dava BET de R$ 0,00. Critério: R$ 0,01,
 * a menor aposta possível. Saldo ou stake que não chega a 1 centavo não autoriza BET; folgas e
 * stakes de R$ 0,01 ou mais continuam valendo.
 */
import { describe, expect, it } from 'vitest';
import { calcularTravas, type TravasBanca } from '../src/banca';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, type EntradaV4 } from '../src/v4';

const H = (hhmm: string) => `2026-10-26T${hhmm}:00-03:00`;
const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2026-10-26T20:00:00-03:00' };
const AGORA = '2026-10-26T16:00:00-03:00';
const HOJE = '2026-10-26T10:00:00-03:00';

function ou(casa: string, over: number, under: number): LinhaOdd[] {
  const l = (lado: string, odd: number): LinhaOdd => ({
    casa,
    mercado: 'total' as TipoMercado,
    lado,
    odd,
    linha: 2.5,
    periodo: 'FT',
    horarioColeta: H('16:00'),
  });
  return [l('over', over), l('under', under)];
}
/** o cenário de BET R1 do v4.test.ts: 1win acima do preço justo da Pinnacle */
const LINHAS = [...ou('Pinnacle', 1.95, 1.95), ...ou('1win', 2.1, 1.72)];
const entrada = (extra: Partial<EntradaV4> = {}): EntradaV4 => ({
  jogo: JOGO,
  agora: AGORA,
  linhas: LINHAS,
  ligaPrincipal: true,
  banca: 1000,
  ...extra,
});
/** travas de banca de R$ 1.000 com as apostas de HOJE em R$ */
const travasCom = (stakes: number[], banca = 1000): TravasBanca =>
  calcularTravas(
    banca,
    stakes.map((stake) => ({ feitaEm: HOJE, stake })),
    AGORA,
  );
const resumo = (r: ReturnType<typeof analisarV4>) => ({
  decisao: r.decisao,
  gatilho: r.gatilho,
  motivos: r.motivos,
  stake: r.melhor?.stake ?? null,
});

/** valores comuns de aposta em R$ (centavos exatos) */
const VALORES = [
  0.3, 0.7, 5.1, 7.3, 9.7, 10.1, 12.3, 14.9, 15.7, 17.7, 19.9, 20.2, 29.7, 30.1, 33.3,
];

/** todas as combinações de 3 apostas que somam EXATAMENTE `total` reais (a 3ª fecha a conta) */
function combinacoes(total: number): number[][] {
  const lista: number[][] = [];
  for (const x of VALORES)
    for (const y of VALORES) {
      const z = Math.round((total - x - y) * 100) / 100;
      if (z > 0) lista.push([x, y, z]);
    }
  return lista;
}

describe('D1: a mesma exposição de 6% no dia dá sempre a mesma decisão', () => {
  it('toda combinação que soma R$ 60,00 decide igual a R$ 20 + 20 + 20 (WATCHLIST, só amanhã)', () => {
    const referencia = resumo(analisarV4(entrada({ travas: travasCom([20, 20, 20]) })));
    expect(referencia.decisao).toBe('WATCHLIST');
    expect(referencia.gatilho).toBe('só amanhã');
    let comPoeira = 0;
    for (const stakes of combinacoes(60)) {
      const travas = travasCom(stakes);
      if (0.06 - travas.expostoHoje > 0) comPoeira++; // a soma deixou poeira positiva
      expect(resumo(analisarV4(entrada({ travas }))), stakes.join(' + ')).toEqual(referencia);
    }
    // o teste não é vácuo: há combinações que deixam poeira (o caso da auditoria entre elas)
    expect(comPoeira).toBeGreaterThan(0);
    expect(0.06 - travasCom([7.3, 33.3, 19.4]).expostoHoje).toBeGreaterThan(0);
  });

  it('o caso da auditoria: R$ 7,30 + 33,30 + 19,40 não é mais BET de R$ 0,00', () => {
    const r = analisarV4(entrada({ travas: travasCom([7.3, 33.3, 19.4]) }));
    expect(r.decisao).toBe('WATCHLIST');
    expect(r.motivos).toContain('teto de 6% da banca no dia já atingido');
    expect(r.melhor?.stake ?? null).toBeNull();
  });
});

describe('D1: a mesma exposição de 2% no jogo dá sempre a mesma decisão', () => {
  it('toda combinação que soma R$ 20,00 no jogo decide igual a 2% exatos (NO_BET)', () => {
    const base = travasCom([]);
    const referencia = resumo(analisarV4(entrada({ travas: { ...base, expostoJogo: 0.02 } })));
    expect(referencia.decisao).toBe('NO_BET');
    let comPoeira = 0;
    for (const stakes of combinacoes(20)) {
      const expostoJogo = stakes.reduce((s, x) => s + x, 0) / 1000;
      if (0.02 - expostoJogo > 0) comPoeira++;
      const r = resumo(analisarV4(entrada({ travas: { ...base, expostoJogo } })));
      // a mensagem mostra o percentual comprometido: com poeira ele é o mesmo "2,0%"
      expect(r.decisao, stakes.join(' + ')).toBe('NO_BET');
      expect(r.motivos.join(' '), stakes.join(' + ')).toMatch(/neste jogo já comprometido/);
      expect(r.stake).toBeNull();
    }
    expect(comPoeira).toBeGreaterThan(0);
  });
});

describe('D1: folgas legítimas de R$ 0,01 ou mais continuam valendo', () => {
  it.each([
    [[59], 1],
    [[59.95], 0.05],
    [[59.99], 0.01], // o caso em que o piso simples lia R$ 0,0099999… como R$ 0,00
    [[20, 20, 19.99], 0.01],
  ])('dia com R$ %j apostados: BET limitado pelo dia, valor R$ %d', (stakes, valor) => {
    const r = analisarV4(entrada({ travas: travasCom(stakes) }));
    expect(r.decisao).toBe('BET');
    expect(r.melhor!.stake!.valor).toBe(valor);
    expect(r.melhor!.stake!.ajustes).toContain('limitada pelo que resta do teto de 6% no dia');
  });

  it('jogo com R$ 19,99 comprometidos: BET de R$ 0,01 limitado pelo jogo', () => {
    const r = analisarV4(entrada({ travas: { ...travasCom([]), expostoJogo: 19.99 / 1000 } }));
    expect(r.decisao).toBe('BET');
    expect(r.melhor!.stake!.valor).toBe(0.01);
  });

  it('a stake de BET nunca passa do saldo do dia nem do jogo (em R$, com o arredondamento)', () => {
    for (const apostado of [0, 30, 55, 58.5, 59.5, 59.9, 59.99])
      for (const jogo of [0, 10, 19, 19.9, 19.99]) {
        const r = analisarV4(
          entrada({ travas: { ...travasCom([apostado]), expostoJogo: jogo / 1000 } }),
        );
        if (r.decisao !== 'BET') continue;
        const valor = r.melhor!.stake!.valor!;
        expect(valor).toBeGreaterThanOrEqual(0.01);
        expect(valor).toBeLessThanOrEqual(60 - apostado + 1e-9);
        expect(valor).toBeLessThanOrEqual(20 - jogo + 1e-9);
        expect(valor).toBeLessThanOrEqual(20 + 1e-9); // teto de 2% por aposta
      }
  });
});

describe('D1: nenhum BET sem stake executável', () => {
  /** a fração de stake do cenário (banca de R$ 1.000), para achar a banca do limiar */
  const fracao = analisarV4(entrada()).melhor!.stake!.fracaoBanca;

  it('stake por Kelly menor que R$ 0,01 (banca pequena): NO_BET com o motivo do centavo', () => {
    const banca = 0.009 / fracao; // stake de R$ 0,009
    const r = analisarV4(entrada({ banca }));
    expect(r.decisao).toBe('NO_BET');
    expect(r.motivos.join(' ')).toMatch(
      /não chega a R\$ 0,01 com banca de R\$ .*sem aposta executável/,
    );
    expect(r.melhor?.stake ?? null).toBeNull();
  });

  it('banca tão pequena que o próprio teto do jogo não chega a R$ 0,01: motivo da stake, não do jogo', () => {
    const r = analisarV4(entrada({ banca: 0.3 })); // 2% de R$ 0,30 = R$ 0,006
    expect(r.decisao).toBe('NO_BET');
    expect(r.motivos.join(' ')).toMatch(/não chega a R\$ 0,01/);
    expect(r.motivos.join(' ')).not.toMatch(/neste jogo já comprometido|teto de 6%/);
  });

  it('logo acima do limiar: BET de R$ 0,01', () => {
    const r = analisarV4(entrada({ banca: 0.011 / fracao }));
    expect(r.decisao).toBe('BET');
    expect(r.melhor!.stake!.valor).toBe(0.01);
  });

  it('autorização RECUSADA (fator de Kelly zero) não vira BET: NO_BET com stake zero', () => {
    const r = analisarV4(entrada({ travas: { ...travasCom([]), fatorKelly: 0 } }));
    expect(r.decisao).toBe('NO_BET');
    expect(r.motivos.join(' ')).toMatch(/stake zero: nenhuma exposição autorizada pelos limites/);
    expect(r.melhor?.stake ?? null).toBeNull();
  });

  it('banca conhecida sem saldo (zero ou negativa) e sem travas: NO_BET por banca, não por teto', () => {
    for (const banca of [0, -50]) {
      const r = analisarV4(entrada({ banca }));
      expect(r.decisao, String(banca)).toBe('NO_BET');
      expect(r.motivos.join(' ')).toMatch(/banca de R\$ .*sem saldo para apostar/);
      expect(r.motivos.join(' ')).not.toMatch(/teto de 6%/);
    }
  });
});

describe('D1: sem banca e sem travas, a decisão não muda', () => {
  it('BET com a mesma fração e sem valor em R$', () => {
    const r = analisarV4(entrada({ banca: undefined }));
    const comBanca = analisarV4(entrada());
    expect(r.decisao).toBe('BET');
    expect(r.melhor!.stake!.valor).toBeUndefined();
    expect(r.melhor!.stake!.fracaoBanca).toBe(comBanca.melhor!.stake!.fracaoBanca);
    expect(comBanca.melhor!.stake!.valor).toBeGreaterThan(0);
  });
});
