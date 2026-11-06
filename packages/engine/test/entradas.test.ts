import { describe, expect, it } from 'vitest';
import { melhoresEntradas, opcoesDeAposta, type PedidoEntradas } from '../src/entradas';
import type { LinhaOdd } from '../src/tipos';
import type { ApoioModelo } from '../src/v4';

const H = '2099-10-26T16:00:00-03:00';
const ou = (casa: string, linha: number, over: number, under: number): LinhaOdd[] =>
  (['over', 'under'] as const).map((lado, i) => ({
    casa,
    mercado: 'total' as const,
    lado,
    linha,
    odd: i ? under : over,
    periodo: 'FT' as const,
    horarioColeta: H,
  }));
const apoio = (m: Partial<ApoioModelo> = {}): ApoioModelo => ({
  lambdas: { casa: 2.0, fora: 0.8 },
  dq: 'A',
  w: 0.5,
  jogosMin: 10,
  ...m,
});
const pedido = (linhas: LinhaOdd[], m: Partial<PedidoEntradas> = {}): PedidoEntradas => ({
  jogo: { casa: 'Casa', fora: 'Fora', inicio: '2099-10-26T20:00:00-03:00' },
  linhas,
  apoio: apoio(),
  agora: H,
  ...m,
});

describe('melhores entradas', () => {
  it('estatísticas e mercado do mesmo lado: entra, com a chance acima do mínimo', () => {
    const r = melhoresEntradas(pedido(ou('1win', 1.5, 1.4, 3.0)));
    const e = r.entradas[0];
    expect(r.status).toBe('ok');
    expect(e.odd).toBe(1.4);
    expect(e.chance).toBeGreaterThan(e.minimo);
    expect(e.minimo).toBeCloseTo(1 / 1.4);
    expect(e.forca).toBe('forte');
    expect(e.stake).toBe(0.01);
  });

  it('funciona com uma casa só, onde a V4 descartaria o mercado principal', () => {
    expect(melhoresEntradas(pedido(ou('1win', 1.5, 1.4, 3.0))).entradas).toHaveLength(1);
  });

  it('odd fora de 1,40 a 2,00 não aparece', () => {
    const r = melhoresEntradas(pedido(ou('1win', 0.5, 1.08, 8)));
    expect(r.entradas).toHaveLength(0);
    expect(r.status).toBe('sem_mercados');
  });

  it('chance abaixo do mínimo da odd fica de fora, com o motivo', () => {
    // mercado com margem alta e modelo de acordo: acerta muito, mas paga menos que o risco
    const r = melhoresEntradas(pedido(ou('1win', 1.5, 1.4, 2.6)));
    expect(r.entradas).toHaveLength(0);
    expect(r.recusadas[0].motivo).toMatch(/abaixo do mínimo/);
  });

  it('modelo muito longe do mercado é recusado como provável erro', () => {
    const r = melhoresEntradas(
      pedido(ou('1win', 2.5, 1.95, 1.85), { apoio: apoio({ lambdas: { casa: 3.4, fora: 1.6 } }) }),
    );
    expect(r.entradas).toHaveLength(0);
    expect(r.recusadas[0].motivo).toMatch(/leitura errada ou ponto cego/);
  });

  it('o lado que as estatísticas não sustentam não entra só por ter odd boa', () => {
    const r = melhoresEntradas(
      pedido(ou('1win', 2.5, 1.9, 1.9), { apoio: apoio({ lambdas: { casa: 1.0, fora: 0.9 } }) }),
    );
    expect(r.entradas.some((x) => x.linha.lado === 'over')).toBe(false);
  });

  it('escanteios nunca recebem sinal forte e exigem 6 jogos', () => {
    const esc: LinhaOdd[] = (['over', 'under'] as const).map((lado, i) => ({
      casa: '1win',
      mercado: 'escanteios_total' as const,
      lado,
      linha: 8.5,
      odd: i ? 2.9 : 1.42,
      periodo: 'FT' as const,
      horarioColeta: H,
    }));
    const contagens = { escanteios: { casa: 7, fora: 5 } };
    const ok = melhoresEntradas(pedido(esc, { apoio: apoio({ contagens }) }));
    expect(ok.entradas[0]?.forca).toBe('media');
    const poucos = melhoresEntradas(pedido(esc, { apoio: apoio({ contagens, jogosMin: 3 }) }));
    expect(poucos.entradas).toHaveLength(0);
    expect(poucos.recusadas[0].motivo).toMatch(/6 jogos/);
  });

  it('sem estatísticas, com dados fracos ou depois do início não há lista', () => {
    const l = ou('1win', 1.5, 1.4, 3.0);
    expect(melhoresEntradas(pedido(l, { apoio: undefined })).status).toBe('sem_estatisticas');
    expect(melhoresEntradas(pedido(l, { apoio: apoio({ dq: 'D', w: 0.2 }) })).status).toBe(
      'dados_fracos',
    );
    expect(melhoresEntradas(pedido(l, { agora: '2099-10-26T20:01:00-03:00' })).status).toBe(
      'jogo_iniciado',
    );
  });

  it('empate devolve: a chance de green não conta o empate, e o sinal não é forte', () => {
    const dnb = (lado: string, odd: number): LinhaOdd => ({
      casa: '1win',
      mercado: 'DNB',
      lado,
      odd,
      periodo: 'FT',
      horarioColeta: H,
    });
    const r = melhoresEntradas(
      pedido([dnb('1', 1.56), dnb('2', 2.33)], {
        apoio: apoio({ lambdas: { casa: 2.16, fora: 1.27 } }),
      }),
    );
    const e = r.entradas[0];
    expect(e.chanceDevolve).toBeGreaterThan(0.15);
    expect(e.chanceGreen).toBeCloseTo(e.chance * (1 - e.chanceDevolve));
    expect(e.chanceGreen).toBeLessThan(e.chance);
    expect(e.forca).toBe('media');
  });

  it('sem devolução possível, a chance de green é a própria chance', () => {
    const e = melhoresEntradas(pedido(ou('1win', 1.5, 1.4, 3.0))).entradas[0];
    expect(e.chanceDevolve).toBeCloseTo(0);
    expect(e.chanceGreen).toBeCloseTo(e.chance);
  });

  it('chance baixa ou sem folga sobre o mínimo não recebe sinal forte', () => {
    const r = melhoresEntradas(
      pedido(ou('1win', 2.5, 1.86, 2.0), { apoio: apoio({ lambdas: { casa: 1.7, fora: 1.3 } }) }),
    );
    const over = r.entradas.find((x) => x.linha.lado === 'over');
    expect(over).toBeDefined();
    expect(over!.chance).toBeLessThan(0.6);
    expect(over!.forca).toBe('media');
  });

  it('em liga principal com poucas casas, aposta no azarão é recusada', () => {
    const lado = (l: string, odd: number): LinhaOdd => ({
      casa: '1win',
      mercado: '1X2',
      lado: l,
      odd,
      periodo: 'FT',
      horarioColeta: H,
    });
    const dnb = (l: string, odd: number): LinhaOdd => ({ ...lado(l, odd), mercado: 'DNB' });
    const linhas = [lado('1', 1.6), lado('X', 3.9), lado('2', 5.5), dnb('2', 1.95), dnb('1', 1.8)];
    const apoioAzarao = apoio({ lambdas: { casa: 0.9, fora: 1.6 } });
    const liga = melhoresEntradas(pedido(linhas, { apoio: apoioAzarao, ligaPrincipal: true }));
    expect(liga.entradas).toHaveLength(0);
    expect(liga.recusadas.some((x) => /azarão/.test(x.motivo))).toBe(true);
    const pequena = melhoresEntradas(pedido(linhas, { apoio: apoioAzarao, ligaPrincipal: false }));
    expect(pequena.recusadas.some((x) => /azarão/.test(x.motivo))).toBe(false);
  });

  it('qualquer aposta lida pode ser escolhida, inclusive a de odd fora da faixa', () => {
    const op = opcoesDeAposta(pedido(ou('1win', 0.5, 1.08, 8)));
    expect(op).toHaveLength(2);
    expect(op.every((o) => o.temEstimativa)).toBe(true);
  });

  it('aposta sem mercado completo e sem estatísticas entra sem estimativa de chance', () => {
    const [o] = opcoesDeAposta(pedido(ou('1win', 2.5, 1.9, 1.9).slice(0, 1), { apoio: undefined }));
    expect(o.temEstimativa).toBe(false);
    expect(o.chance).toBeCloseTo(1 / 1.9);
    expect(o.ev).toBeCloseTo(0);
  });

  it('a mesma aposta lida em dois prints aparece uma vez, com a odd mais recente', () => {
    const velha = ou('1win', 2.5, 1.9, 1.9).map((l) => ({
      ...l,
      horarioColeta: '2099-10-26T10:00:00-03:00',
    }));
    const nova = ou('1win', 2.5, 1.8, 2.0);
    const op = opcoesDeAposta(pedido([...velha, ...nova]));
    expect(op).toHaveLength(2);
    expect(op.find((o) => o.linha.lado === 'over')?.odd).toBe(1.8);
  });

  it('as travas da banca reduzem a aposta e avisam', () => {
    const travas = {
      bancaInicial: 130,
      bancaAtual: 100,
      pico: 130,
      drawdown: 0.23,
      fatorKelly: 0.5,
      pausadoAte: null,
      perdasHoje: 5,
      diaEncerrado: true,
      expostoHoje: 0,
      motivos: [],
    };
    const r = melhoresEntradas(pedido(ou('1win', 1.5, 1.4, 3.0), { travas }));
    expect(r.entradas[0].stake).toBe(0.005);
    expect(r.entradas[0].stakeValor).toBe(0.5);
    expect(r.bloqueio).toMatch(/dia encerrado/);
  });

  it('ordena pela maior chance e pega a melhor odd dentro da faixa', () => {
    const r = melhoresEntradas(
      pedido([...ou('A', 1.5, 1.4, 3.0), ...ou('B', 1.5, 1.42, 2.95), ...ou('A', 2.5, 1.9, 1.95)]),
    );
    expect(r.entradas[0].casa).toBe('B');
    const chances = r.entradas.map((x) => x.chance);
    expect(chances).toEqual([...chances].sort((a, b) => b - a));
  });
});
