/**
 * Seção 15 — sensibilidade: a vantagem sobrevive a erros razoáveis no λ?
 * ROBUSTA (EV > 0 em todos) · MODERADA (na maioria) · FRÁGIL (não é BET).
 */
import { blend } from './gates';
import { fracaoEmRisco, probEfetiva } from './liquidacao';
import { criarModelo, distribuicaoModelo, type Liquidador } from './mercados';
import type { Lambdas } from './tipos';

export type ClasseSensibilidade = 'ROBUSTA' | 'MODERADA' | 'FRÁGIL';

export interface CenarioSensibilidade {
  nome: string;
  lambdas: Lambdas;
  pModelo: number;
  pFinal: number;
  ev: number;
}

export interface ResultadoSensibilidade {
  classe: ClasseSensibilidade;
  cenarios: CenarioSensibilidade[];
  /** pior P_modelo entre base e cenários → price gate */
  pModeloInferior: number;
  positivos: number;
}

export function analisarSensibilidade(p: {
  liq: Liquidador;
  lambdas: Lambdas;
  lambdaMercado: Lambdas | null;
  rho: number;
  fracao1T: number;
  pMercado: number;
  w: number;
  odd: number;
}): ResultadoSensibilidade {
  const avaliar = (nome: string, l: Lambdas): CenarioSensibilidade => {
    const d = distribuicaoModelo(p.liq, criarModelo(l, p.rho, p.fracao1T));
    const pModelo = probEfetiva(d);
    const pFinal = blend(pModelo, p.pMercado, p.w);
    return { nome, lambdas: l, pModelo, pFinal, ev: fracaoEmRisco(d) * (pFinal * p.odd - 1) };
  };
  const { casa, fora } = p.lambdas;
  const base = avaliar('base', p.lambdas);

  // direção adversa de cada λ: a que derruba a probabilidade da aposta
  const adversoCasa =
    avaliar('', { casa: casa * 1.1, fora }).pModelo >=
    avaliar('', { casa: casa * 0.9, fora }).pModelo
      ? 0.9
      : 1.1;
  const adversoFora =
    avaliar('', { casa, fora: fora * 1.1 }).pModelo >=
    avaliar('', { casa, fora: fora * 0.9 }).pModelo
      ? 0.9
      : 1.1;
  const pct = (f: number) => (f < 1 ? '−10%' : '+10%');

  const cenarios: CenarioSensibilidade[] = [
    avaliar(`λ casa ${pct(adversoCasa)} (adverso)`, { casa: casa * adversoCasa, fora }),
    avaliar(`λ fora ${pct(adversoFora)} (adverso)`, { casa, fora: fora * adversoFora }),
    avaliar('ambos λ −10%', { casa: casa * 0.9, fora: fora * 0.9 }),
    avaliar('ambos λ adversos', { casa: casa * adversoCasa, fora: fora * adversoFora }),
  ];
  if (p.lambdaMercado) {
    cenarios.push(
      avaliar('λ_market no lugar do λ_modelo (casa)', { casa: p.lambdaMercado.casa, fora }),
    );
    cenarios.push(
      avaliar('λ_market no lugar do λ_modelo (fora)', { casa, fora: p.lambdaMercado.fora }),
    );
  }

  const positivos = cenarios.filter((c) => c.ev > 0).length;
  const classe: ClasseSensibilidade =
    base.ev <= 0
      ? 'FRÁGIL'
      : positivos === cenarios.length
        ? 'ROBUSTA'
        : positivos > cenarios.length / 2
          ? 'MODERADA'
          : 'FRÁGIL';

  return {
    classe,
    cenarios,
    pModeloInferior: Math.min(base.pModelo, ...cenarios.map((c) => c.pModelo)),
    positivos,
  };
}
