/**
 * Fase 5 — nível 3: modelo próprio para escanteios e cartões amarelos.
 * Contagem de cada time ~ binomial negativa (variância = φ × média), times independentes.
 * O λ sai da média própria de cada time (e da média cedida, quando houver), com o mesmo
 * shrinkage n/(n+8) do λ de gols. Todo ajuste é declarado.
 */
import { pesoAmostra } from './lambdaModelo';
import type { MatrizPlacar } from './poisson';
import type { Lambdas } from './tipos';

export type Estatistica = 'escanteios' | 'cartoes';

export const NOME_ESTATISTICA: Record<Estatistica, string> = {
  escanteios: 'escanteios',
  cartoes: 'cartões amarelos',
};

/** Variância ÷ média de cada time: cartões dispersam mais (árbitro, clima do jogo). */
export const DISPERSAO: Record<Estatistica, number> = { escanteios: 1.25, cartoes: 1.6 };
/** Fração do jogo inteiro que sai no 1º tempo. */
export const FRACAO_1T_CONTAGEM: Record<Estatistica, number> = { escanteios: 0.46, cartoes: 0.38 };
/** Média por time numa liga típica (prior do shrinkage). */
export const MEDIA_CONTAGEM_PADRAO: Record<Estatistica, number> = { escanteios: 5.0, cartoes: 2.2 };
/** Mandante tem mais escanteios e leva menos cartões. */
export const MANDO_CONTAGEM: Record<Estatistica, number> = { escanteios: 1.1, cartoes: 0.93 };
const MAXIMO: Record<Estatistica, number> = { escanteios: 30, cartoes: 16 };

/** Médias por jogo de um time. */
export interface StatsContagem {
  jogos: number;
  /** do próprio time: escanteios a favor / cartões recebidos */
  favor: number;
  /** escanteios cedidos ao adversário (quando a fonte mostra) */
  contra?: number;
}

export interface ResultadoLambdaContagem {
  estatistica: Estatistica;
  lambdas: Lambdas;
  declaracoes: string[];
}

export function calcularLambdaContagem(
  estatistica: Estatistica,
  casa: StatsContagem,
  fora: StatsContagem,
  p: { media?: number; mando?: number } = {},
): ResultadoLambdaContagem {
  const media = p.media ?? MEDIA_CONTAGEM_PADRAO[estatistica];
  const mando = p.mando ?? MANDO_CONTAGEM[estatistica];
  if (media <= 0) throw new Error(`média de ${estatistica} por time deve ser > 0`);
  const nome = NOME_ESTATISTICA[estatistica];
  const declaracoes: string[] = [];
  const rating = (s: StatsContagem, quem: string) => {
    const w = pesoAmostra(s.jogos);
    const ataque = w * (s.favor / media) + (1 - w);
    const defesa = s.contra !== undefined ? w * (s.contra / media) + (1 - w) : 1;
    declaracoes.push(
      `${quem}: ${nome} ${s.favor.toFixed(1)}/jogo${s.contra !== undefined ? `, cedidos ${s.contra.toFixed(1)}/jogo` : ' (sem dado cedido: adversário neutro)'}; shrinkage n=${s.jogos} → peso ${w.toFixed(2)}`,
    );
    return { ataque, defesa };
  };
  const rc = rating(casa, 'casa');
  const rf = rating(fora, 'fora');
  declaracoes.push(
    `base: média ${media} ${nome}/time, mando ×${mando}, dispersão φ=${DISPERSAO[estatistica]}${estatistica === 'cartoes' ? '; árbitro não considerado' : ''}`,
  );
  return {
    estatistica,
    lambdas: {
      casa: rc.ataque * rf.defesa * media * mando,
      fora: (rf.ataque * rc.defesa * media) / mando,
    },
    declaracoes,
  };
}

/** P(X = k), k = 0..max, binomial negativa com média μ e variância φμ (φ ≤ 1 → Poisson). */
export function pmfContagem(media: number, phi: number, max: number): number[] {
  if (!Number.isFinite(media) || media < 0) throw new Error(`média inválida: ${media}`);
  const pmf: number[] = [];
  if (media === 0) return Array.from({ length: max + 1 }, (_, k) => (k === 0 ? 1 : 0));
  if (phi <= 1) {
    let p = Math.exp(-media);
    for (let k = 0; k <= max; k++) {
      pmf.push(p);
      p *= media / (k + 1);
    }
  } else {
    const r = media / (phi - 1);
    const q = r / (r + media);
    let p = Math.pow(q, r);
    for (let k = 0; k <= max; k++) {
      pmf.push(p);
      p *= ((k + r) / (k + 1)) * (1 - q);
    }
  }
  const soma = pmf.reduce((s, x) => s + x, 0);
  return pmf.map((x) => x / soma);
}

/** matriz[casa][fora], times independentes. */
export function matrizContagem(
  estatistica: Estatistica,
  lambdas: Lambdas,
  fracao = 1,
): MatrizPlacar {
  const phi = DISPERSAO[estatistica];
  const max = MAXIMO[estatistica];
  const pc = pmfContagem(lambdas.casa * fracao, phi, max);
  const pf = pmfContagem(lambdas.fora * fracao, phi, max);
  return pc.map((a) => pf.map((b) => a * b));
}
