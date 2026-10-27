/**
 * Seção 15 — sensibilidade: a vantagem sobrevive a erros razoáveis no λ?
 * ROBUSTA (EV > 0 em todos) · MODERADA (na maioria) · FRÁGIL (não é BET).
 */
import { blend } from './gates';
import { fracaoEmRisco, probEfetiva } from './liquidacao';
import { criarModelo, distribuicaoModelo, type LambdasContagem, type Liquidador } from './mercados';
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

/** Erro razoável de λ: ±10% em gols; ±15% em escanteios/cartões (modelo mais simples). */
export const ERRO_LAMBDA = 0.1;
export const ERRO_LAMBDA_NIVEL3 = 0.15;

export function analisarSensibilidade(p: {
  liq: Liquidador;
  lambdas: Lambdas;
  lambdaMercado: Lambdas | null;
  rho: number;
  fracao1T: number;
  pMercado: number;
  w: number;
  odd: number;
  /** λ de escanteios/cartões: no nível 3 são ESTES que variam nos cenários */
  contagens?: LambdasContagem;
}): ResultadoSensibilidade {
  const estat =
    p.liq.tipo === 'contagem' || p.liq.tipo === 'primeira_contagem' ? p.liq.estatistica : null;
  const lambdasBase = estat ? p.contagens?.[estat] : p.lambdas;
  if (!lambdasBase) throw new Error('sensibilidade sem λ da estatística da aposta');
  const erro = estat ? ERRO_LAMBDA_NIVEL3 : ERRO_LAMBDA;
  const modeloCom = (l: Lambdas) =>
    estat
      ? criarModelo(p.lambdas, p.rho, p.fracao1T, { ...p.contagens, [estat]: l })
      : criarModelo(l, p.rho, p.fracao1T);
  const avaliar = (nome: string, l: Lambdas): CenarioSensibilidade => {
    const d = distribuicaoModelo(p.liq, modeloCom(l));
    const pModelo = probEfetiva(d);
    const pFinal = blend(pModelo, p.pMercado, p.w);
    return { nome, lambdas: l, pModelo, pFinal, ev: fracaoEmRisco(d) * (pFinal * p.odd - 1) };
  };
  const { casa, fora } = lambdasBase;
  const base = avaliar('base', lambdasBase);
  const sobe = 1 + erro;
  const desce = 1 - erro;

  // direção adversa de cada λ: a que derruba a probabilidade da aposta
  const adversoCasa =
    avaliar('', { casa: casa * sobe, fora }).pModelo >=
    avaliar('', { casa: casa * desce, fora }).pModelo
      ? desce
      : sobe;
  const adversoFora =
    avaliar('', { casa, fora: fora * sobe }).pModelo >=
    avaliar('', { casa, fora: fora * desce }).pModelo
      ? desce
      : sobe;
  const pct = (f: number) => `${f < 1 ? '−' : '+'}${Math.round(erro * 100)}%`;
  const nomeL = estat ? `λ ${estat}` : 'λ';

  const cenarios: CenarioSensibilidade[] = [
    avaliar(`${nomeL} casa ${pct(adversoCasa)} (adverso)`, { casa: casa * adversoCasa, fora }),
    avaliar(`${nomeL} fora ${pct(adversoFora)} (adverso)`, { casa, fora: fora * adversoFora }),
    avaliar(`ambos ${nomeL} ${pct(desce)}`, { casa: casa * desce, fora: fora * desce }),
    avaliar(`ambos ${nomeL} adversos`, { casa: casa * adversoCasa, fora: fora * adversoFora }),
  ];
  if (p.lambdaMercado && !estat) {
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
