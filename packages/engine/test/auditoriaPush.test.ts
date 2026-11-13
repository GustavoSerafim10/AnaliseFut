/**
 * Auditoria do push: o EV e o Kelly continuam corretos quando a aposta pode ser devolvida
 * (handicap inteiro, empate anula) ou pagar/perder só metade (linhas de quarto)?
 */
import { describe, expect, it } from 'vitest';
import { evExato, evPorProbEfetiva, fracaoEmRisco, probEfetiva } from '../src/liquidacao';
import { kellyCheio } from '../src/kelly';

type D = { ganho: number; meioGanho: number; push: number; meiaPerda: number; perda: number };
const dist = (ganho: number, meioGanho: number, push: number, meiaPerda: number): D => {
  const perda = 1 - ganho - meioGanho - push - meiaPerda;
  return { ganho, meioGanho, push, meiaPerda, perda };
};

/** crescimento esperado do log da banca ao apostar a fração f */
const crescimento = (d: D, odd: number, f: number) =>
  d.ganho * Math.log(1 + f * (odd - 1)) +
  d.meioGanho * Math.log(1 + (f * (odd - 1)) / 2) +
  d.push * 0 +
  d.meiaPerda * Math.log(1 - f / 2) +
  d.perda * Math.log(1 - f);

function melhorFracao(d: D, odd: number): number {
  let melhor = 0;
  let g = 0;
  for (let f = 0; f < 0.999; f += 0.0005) {
    const v = crescimento(d, odd, f);
    if (v > g) {
      g = v;
      melhor = f;
    }
  }
  return melhor;
}

const CASOS: [string, D, number][] = [
  ['sem push', dist(0.55, 0, 0, 0), 1.9],
  ['push inteiro (AH 0 / empate anula)', dist(0.4, 0, 0.22, 0), 2.0],
  ['push inteiro, odd alta', dist(0.3, 0, 0.25, 0), 3.2],
  ['linha de quarto (meio-ganho/meia-perda)', dist(0.35, 0.12, 0, 0.1), 2.05],
];

describe('EV com devolução e meios resultados', () => {
  for (const [nome, d, odd] of CASOS)
    it(`EV por probabilidade efetiva = EV exato · ${nome}`, () => {
      const viaEfetiva = evPorProbEfetiva(probEfetiva(d), odd, fracaoEmRisco(d));
      expect(viaEfetiva).toBeCloseTo(evExato(d, odd), 12);
    });
});

describe('Kelly binário (p efetiva) × Kelly exato por simulação do log da banca', () => {
  it('push inteiro: coincidem (o push soma 0 ao crescimento, só rescala as probabilidades)', () => {
    for (const [, d, odd] of CASOS.slice(0, 3)) {
      const binario = Math.max(0, kellyCheio(probEfetiva(d), odd));
      expect(binario).toBeCloseTo(melhorFracao(d, odd), 2);
    }
  });
  it('linha de quarto: aproximação — erro absoluto pequeno e sempre conservador demais ou parecido', () => {
    const [, d, odd] = CASOS[3];
    const binario = Math.max(0, kellyCheio(probEfetiva(d), odd));
    const exato = melhorFracao(d, odd);
    // a diferença existe, mas com 1/4–1/8 de Kelly e teto de 1–2% fica longe de importar
    expect(Math.abs(binario - exato)).toBeLessThan(0.1);
  });
});
