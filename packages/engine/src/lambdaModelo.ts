/**
 * Seção 9.2/9.3 — λ do modelo a partir das estatísticas dos times.
 * Todo ajuste é declarado; λ sai com valor central e faixa.
 */
import type { Lambdas, Time } from './tipos';

export const MANDO_PADRAO = 1.12;
export const MEDIA_GOLS_PADRAO = 1.3;
export const FATOR_CHUTE_NO_ALVO = 0.32;
/**
 * xG por grande chance criada (todas as finalizações do time, não só a da grande chance).
 * Calibrado com os prints reais do SuperScore (Média), Flamengo × Atlético-MG 26/10/2026:
 * 1,8 xG / 3,4 grandes chances = 0,53 e 1,4 / 2,6 = 0,54. Amostra de 2 times: recalibrar
 * com cada jogo que trouxer xG e grandes chances (ver teste "calibração do fator").
 */
export const FATOR_GRANDE_CHANCE = 0.53;
export const LIMITE_MATCHUP = 0.08;
export const FAIXA_LAMBDA = 0.1;

/** Médias por jogo. */
export interface EstatisticasTime {
  jogos: number;
  golsPro: number;
  golsContra: number;
  xg?: number;
  chutesNoAlvo?: number;
  chutesNoAlvoContra?: number;
  /** grandes chances criadas por jogo */
  grandesChances?: number;
}

export interface PriorTime {
  ataque: number;
  defesa: number;
  /** ordem de preferência: rating (temporada anterior/Elo) → mercado → neutro */
  fonte: 'rating' | 'mercado' | 'neutro';
}

export const PRIOR_NEUTRO: PriorTime = { ataque: 1, defesa: 1, fonte: 'neutro' };

export interface AjusteLambda {
  time: Time;
  tipo: 'desfalque' | 'matchup' | 'contexto' | 'liga' | 'sos';
  /** multiplicador do λ (0,95 = −5%) */
  fator: number;
  descricao: string;
}

export interface ParametrosLambdaModelo {
  mediaGolsPorTime?: number;
  mando?: number;
  priorCasa?: PriorTime;
  priorFora?: PriorTime;
  ajustes?: AjusteLambda[];
}

export interface ResultadoLambdaModelo {
  lambdas: Lambdas;
  faixa: { casa: [number, number]; fora: [number, number] };
  priorNeutro: boolean;
  declaracoes: string[];
  /** desfalque CRÍTICO (> ±12%) → WATCHLIST */
  desfalqueCritico: boolean;
}

export function producaoOfensiva(s: EstatisticasTime): { valor: number; metodo: string } {
  if (s.xg !== undefined)
    return { valor: 0.65 * s.xg + 0.35 * s.golsPro, metodo: '65% xG + 35% gols' };
  const gc = s.grandesChances;
  if (s.chutesNoAlvo !== undefined && gc !== undefined)
    return {
      valor:
        0.5 * s.golsPro +
        0.25 * FATOR_CHUTE_NO_ALVO * s.chutesNoAlvo +
        0.25 * FATOR_GRANDE_CHANCE * gc,
      metodo: 'sem xG: 50% gols + 25% (0,32 × chutes no alvo) + 25% (0,53 × grandes chances)',
    };
  if (s.chutesNoAlvo !== undefined)
    return {
      valor: 0.5 * s.golsPro + 0.5 * FATOR_CHUTE_NO_ALVO * s.chutesNoAlvo,
      metodo: 'sem xG: 50% gols + 50% (0,32 × chutes no alvo)',
    };
  if (gc !== undefined)
    return {
      valor: 0.5 * s.golsPro + 0.5 * FATOR_GRANDE_CHANCE * gc,
      metodo: 'sem xG: 50% gols + 50% (0,53 × grandes chances)',
    };
  return { valor: s.golsPro, metodo: 'só gols (sem xG e sem chutes no alvo — limitação)' };
}

export function producaoCedida(s: EstatisticasTime): { valor: number; metodo: string } {
  if (s.chutesNoAlvoContra !== undefined)
    return {
      valor: 0.5 * s.golsContra + 0.5 * FATOR_CHUTE_NO_ALVO * s.chutesNoAlvoContra,
      metodo: '50% gols sofridos + 50% (0,32 × chutes no alvo contra)',
    };
  return { valor: s.golsContra, metodo: 'só gols sofridos (limitação)' };
}

/** Peso da amostra no shrinkage: n / (n + 8) */
export function pesoAmostra(n: number): number {
  return n / (n + 8);
}

export function classificarDesfalque(fator: number): 'BAIXO' | 'MÉDIO' | 'ALTO' | 'CRÍTICO' {
  const d = Math.abs(1 - fator);
  if (d <= 0.03) return 'BAIXO';
  if (d <= 0.07) return 'MÉDIO';
  if (d <= 0.12) return 'ALTO';
  return 'CRÍTICO';
}

export function calcularLambdaModelo(
  casa: EstatisticasTime,
  fora: EstatisticasTime,
  p: ParametrosLambdaModelo = {},
): ResultadoLambdaModelo {
  const media = p.mediaGolsPorTime ?? MEDIA_GOLS_PADRAO;
  const mando = p.mando ?? MANDO_PADRAO;
  if (media <= 0) throw new Error('média de gols por time deve ser > 0');
  const priorC = p.priorCasa ?? PRIOR_NEUTRO;
  const priorF = p.priorFora ?? PRIOR_NEUTRO;
  const declaracoes: string[] = [];

  const rating = (s: EstatisticasTime, prior: PriorTime, nome: string) => {
    const of = producaoOfensiva(s);
    const ce = producaoCedida(s);
    const w = pesoAmostra(s.jogos);
    const ataque = w * (of.valor / media) + (1 - w) * prior.ataque;
    const defesa = w * (ce.valor / media) + (1 - w) * prior.defesa;
    declaracoes.push(
      `${nome}: ataque ${of.metodo}; defesa ${ce.metodo}; shrinkage n=${s.jogos} → peso ${w.toFixed(2)} da amostra, resto do prior (${prior.fonte})`,
    );
    return { ataque, defesa };
  };
  const rc = rating(casa, priorC, 'casa');
  const rf = rating(fora, priorF, 'fora');

  let lc = rc.ataque * rf.defesa * media * mando;
  let lf = (rf.ataque * rc.defesa * media) / mando;
  declaracoes.push(`base: média ${media} gols/time, mando ${mando}`);

  let desfalqueCritico = false;
  for (const a of p.ajustes ?? []) {
    let fator = a.fator;
    if (a.tipo === 'matchup')
      fator = Math.max(1 - LIMITE_MATCHUP, Math.min(1 + LIMITE_MATCHUP, fator));
    if (a.tipo === 'desfalque') {
      const nivel = classificarDesfalque(fator);
      if (nivel === 'CRÍTICO') desfalqueCritico = true;
      declaracoes.push(`desfalque ${nivel}: ${a.descricao} (${a.time} ×${fator})`);
    } else {
      declaracoes.push(`${a.tipo}: ${a.descricao} (${a.time} ×${fator})`);
    }
    if (a.time === 'casa') lc *= fator;
    else lf *= fator;
  }

  const faixa = (x: number): [number, number] => [x * (1 - FAIXA_LAMBDA), x * (1 + FAIXA_LAMBDA)];
  return {
    lambdas: { casa: lc, fora: lf },
    faixa: { casa: faixa(lc), fora: faixa(lf) },
    priorNeutro: priorC.fonte === 'neutro' || priorF.fonte === 'neutro',
    declaracoes,
    desfalqueCritico,
  };
}
