import { describe, expect, it } from 'vitest';
import {
  agruparPorOperador,
  avisosDeCasas,
  comissaoDaCasa,
  contarOperadores,
  resolverCasa,
} from '../src/casas';
import { ajustarDQ } from '../src/decisao';
import { melhoresEntradas } from '../src/entradas';
import type { LinhaOdd, TipoMercado } from '../src/tipos';
import { analisarV4, ehAfiada, oddEfetiva, type EntradaV4 } from '../src/v4';

const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2026-10-26T20:00:00-03:00' };
const AGORA = '2026-10-26T16:00:00-03:00';
const H = (hhmm: string) => `2026-10-26T${hhmm}:00-03:00`;

function ou(casa: string, over: number, under: number, hora = '16:00'): LinhaOdd[] {
  const l = (lado: string, odd: number): LinhaOdd => ({
    casa,
    mercado: 'total' as TipoMercado,
    lado,
    odd,
    linha: 2.5,
    periodo: 'FT',
    horarioColeta: H(hora),
  });
  return [l('over', over), l('under', under)];
}
const entrada = (linhas: LinhaOdd[], extra: Partial<EntradaV4> = {}): EntradaV4 => ({
  jogo: JOGO,
  agora: AGORA,
  linhas,
  ligaPrincipal: true,
  banca: 1000,
  ...extra,
});

describe('identidade das casas', () => {
  it('aliases da mesma marca: Bet365, Bet 365, bet365.com e BET365 BR são uma só', () => {
    const nomes = ['Bet365', 'Bet 365', 'bet365.com', 'BET365 BR'];
    const rs = nomes.map(resolverCasa);
    expect(new Set(rs.map((r) => r.brandId)).size).toBe(1);
    expect(new Set(rs.map((r) => r.operatorId)).size).toBe(1);
    expect(rs.every((r) => r.mapeada)).toBe(true);
    expect(contarOperadores(nomes)).toBe(1);
  });

  it('o nome original do print é preservado para auditoria', () => {
    expect(resolverCasa('bet365.com').original).toBe('bet365.com');
    expect(resolverCasa('bet365.com').displayName).toBe('Bet365');
  });

  it('marcas diferentes do mesmo operador: Betsul e CasaDeApostas (CDA Gaming)', () => {
    const a = resolverCasa('Betsul');
    const b = resolverCasa('casadeapostas.bet.br');
    expect(a.operatorId).toBe(b.operatorId);
    expect(a.brandId).not.toBe(b.brandId);
    expect(contarOperadores(['Betsul', 'CasaDeApostas'])).toBe(1);
  });

  it('Superbet e BetSuper NÃO são unificadas (sem confirmação)', () => {
    expect(resolverCasa('Superbet').operatorId).not.toBe(resolverCasa('BetSuper').operatorId);
    expect(contarOperadores(['Superbet', 'BetSuper'])).toBe(2);
  });

  it('Exchange × Sportsbook: mesmo operador, produtos distintos, fontes de preço distintas', () => {
    const ex = resolverCasa('Betfair Exchange');
    const sb = resolverCasa('Betfair Sportsbook');
    expect(ex.operatorId).toBe(sb.operatorId);
    expect(ex.productType).toBe('exchange');
    expect(sb.productType).toBe('sportsbook');
    expect(ex.chaveFonte).not.toBe(sb.chaveFonte);
    expect(contarOperadores(['Betfair Exchange', 'Betfair Sportsbook', 'betfair'])).toBe(1);
  });

  it('comissão de 6,5% só na Exchange, nunca no Sportsbook por semelhança de nome', () => {
    expect(comissaoDaCasa('Betfair Exchange')).toBe(0.065);
    expect(comissaoDaCasa('Betfair Sportsbook')).toBe(0);
    expect(comissaoDaCasa('Bet365')).toBe(0);
    expect(oddEfetiva('Betfair Sportsbook', 3)).toBe(3);
    expect(oddEfetiva('Betfair Exchange', 3)).toBeCloseTo(1 + 2 * 0.935, 12);
  });

  it('"Betfair" sozinho: Exchange assumida, com aviso', () => {
    const r = resolverCasa('Betfair');
    expect(r.productType).toBe('exchange');
    expect(r.produtoAssumido).toBe(true);
    expect(avisosDeCasas(['Betfair']).join(' ')).toContain('assumida Exchange');
    expect(oddEfetiva('Betfair', 3)).toBeLessThan(3);
  });

  it('só Pinnacle e Betfair EXCHANGE são referência afiada; o Sportsbook não', () => {
    expect(ehAfiada('Pinnacle')).toBe(true);
    expect(ehAfiada('Betfair Exchange')).toBe(true);
    expect(ehAfiada('Betfair Sportsbook')).toBe(false);
    expect(ehAfiada('Betsul')).toBe(false);
  });

  it('casa desconhecida: fica não mapeada, sem associação, com aviso', () => {
    const r = resolverCasa('Casa Nova XPTO');
    expect(r.mapeada).toBe(false);
    expect(r.operatorId.startsWith('nao-mapeada:')).toBe(true);
    // grafia parecida mas diferente de qualquer alias: não é associada a ninguém
    const parecida = resolverCasa('Super Bet Plus');
    expect(parecida.mapeada).toBe(false);
    expect(parecida.operatorId).not.toBe(resolverCasa('Superbet').operatorId);
    expect(parecida.operatorId).not.toBe(resolverCasa('BetSuper').operatorId);
    // espaço é só grafia da mesma marca ("Bet 365" = Bet365); nunca liga Superbet a BetSuper
    expect(resolverCasa('Super Bet').brandId).toBe('superbet');
    expect(resolverCasa('Bet Super').brandId).toBe('betsuper');
    expect(avisosDeCasas(['Casa Nova XPTO'])[0]).toContain('não mapeada');
  });

  it('agrupa por operador e mantém as marcas dentro do grupo', () => {
    const g = agruparPorOperador([
      { casa: 'Betsul' },
      { casa: 'CasaDeApostas' },
      { casa: 'Bet365' },
    ]);
    expect(g.size).toBe(2);
    expect(g.get('cda-gaming')).toHaveLength(2);
  });
});

describe('consenso R2 por operador', () => {
  it('quatro nomes da mesma casa NÃO viram R2', () => {
    const nomes = ['Bet365', 'Bet 365', 'bet365.com', 'BET365 BR'];
    const r = analisarV4(entrada(nomes.flatMap((n) => ou(n, 1.9, 1.9))));
    expect(r.referencia.nivel).not.toBe('R2');
    expect(r.referencia.moles).toHaveLength(1);
  });

  it('Betsul + CasaDeApostas contam como um operador: 3 operadores não bastam', () => {
    const r = analisarV4(
      entrada([
        ...ou('Betsul', 1.9, 1.9),
        ...ou('CasaDeApostas', 1.9, 1.9),
        ...ou('Bet365', 1.9, 1.9),
        ...ou('Superbet', 1.9, 1.9),
      ]),
    );
    expect(r.referencia.nivel).not.toBe('R2');
  });

  it('4 operadores independentes formam o R2', () => {
    const r = analisarV4(
      entrada([
        ...ou('Betsul', 1.9, 1.9),
        ...ou('CasaDeApostas', 1.9, 1.9),
        ...ou('Bet365', 1.9, 1.9),
        ...ou('Superbet', 1.9, 1.9),
        ...ou('Betano', 2.12, 1.8),
      ]),
    );
    expect(r.referencia.nivel).toBe('R2');
    expect(r.melhor?.casaMelhorOdd).toBe('Betano');
  });

  it('leave-one-out por OPERADOR: as duas marcas do operador da melhor odd saem do consenso', () => {
    const r = analisarV4(
      entrada([
        ...ou('Betsul', 2.12, 1.8), // melhor odd
        ...ou('CasaDeApostas', 1.5, 2.6), // mesmo operador, preço torto: não pode puxar o consenso
        ...ou('Bet365', 1.9, 1.9),
        ...ou('Superbet', 1.9, 1.9),
        ...ou('Betano', 1.9, 1.9),
      ]),
    );
    const m = r.melhor!;
    expect(m.casaMelhorOdd).toBe('Betsul');
    expect(m.pTrue).toBeCloseTo(0.5, 10);
    expect(m.fonteP).toContain('3 outros operadores');
  });

  it('mínimo de operadores independentes: fora da janela de 10 min não vale', () => {
    const r = analisarV4(
      entrada([
        ...ou('Betsul', 2.12, 1.8),
        ...ou('CasaDeApostas', 1.9, 1.9),
        ...ou('Bet365', 1.9, 1.9),
        ...ou('Superbet', 1.9, 1.9, '14:00'),
        ...ou('Betano', 1.9, 1.9, '14:00'),
      ]),
    );
    expect(r.decisao).not.toBe('BET');
    expect(r.descartados.some((d) => d.motivo.includes('consenso independente'))).toBe(true);
  });

  it('casas desconhecidas contam como operadores próprios, mas geram aviso', () => {
    const r = analisarV4(
      entrada([
        ...ou('Bet365', 1.9, 1.9),
        ...ou('Casa Nova A', 1.9, 1.9),
        ...ou('Casa Nova B', 1.9, 1.9),
        ...ou('Casa Nova C', 2.12, 1.8),
      ]),
    );
    expect(r.avisos.filter((a) => a.includes('não mapeada'))).toHaveLength(3);
  });

  it('Betfair Exchange × Sportsbook na V4: o Sportsbook é casa mole, sem comissão', () => {
    const base = [...ou('Pinnacle', 1.95, 1.95)];
    const ex = analisarV4(entrada([...base, ...ou('Betfair Exchange', 2.2, 1.7)]));
    const sb = analisarV4(entrada([...base, ...ou('Betfair Sportsbook', 2.2, 1.7)]));
    expect(ex.referencia.afiadas).toHaveLength(2);
    expect(sb.referencia.afiadas).toHaveLength(1);
    const mole = sb.avaliadas.find((a) => a.casaMelhorOdd === 'Betfair Sportsbook');
    expect(mole?.oddEfetiva).toBe(2.2);
  });

  it('lista de entradas roda com duas marcas do mesmo operador', () => {
    const apoio = { lambdas: { casa: 1.4, fora: 1.0 }, dq: 'B' as const, w: 0.4, jogosMin: 10 };
    const linhas = [
      ...ou('Betsul', 1.8, 2.0),
      ...ou('CasaDeApostas', 1.8, 2.0),
      ...ou('Bet365', 1.8, 2.0),
    ];
    const r = melhoresEntradas({ jogo: JOGO, linhas, apoio, agora: AGORA });
    expect(r.status).toBe('ok');
  });
});

describe('DQ A pela identidade da referência', () => {
  it('Betfair Sportsbook não vale como casa referência', () => {
    const sem = ajustarDQ('A', [...ou('Betfair Sportsbook', 1.9, 1.9), ...ou('Bet365', 1.9, 1.9)]);
    expect(sem.dq).toBe('B');
    const com = ajustarDQ('A', [...ou('Betfair Exchange', 1.9, 1.9), ...ou('Bet365', 1.9, 1.9)]);
    expect(com.dq).toBe('A');
  });
});
