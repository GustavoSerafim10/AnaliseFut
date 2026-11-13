/**
 * Política ÚNICA de exposição: todos os limites e frações de stake do motor, num lugar só.
 *
 * Etapa 3C: consolidação SEM mudar nenhum valor. Os números abaixo são exatamente os que já
 * valiam (kelly.ts, v4.ts e entradas.ts). Qualquer mudança de limite exige autorização expressa
 * e a atualização do teste `politicaExposicao.test.ts`, que trava estes valores.
 *
 * A política é:
 *   - no máximo 2% da banca por aposta (1% no R3 e em cada entrada da lista);
 *   - no máximo 2% da banca por jogo, somando TODAS as apostas registradas no mesmo evento;
 *   - no máximo 6% da banca por dia.
 * (O antigo limite de 5% por "lote" foi removido: não correspondia a nada no motor.)
 *
 * Precedência: a regra mais restritiva vence. A stake autorizada é o MENOR entre o Kelly
 * fracionado (já reduzido por filtro e drawdown), o teto geral por aposta, o teto do nível de
 * referência ou da lista, o que resta do teto do jogo e o que resta do teto do dia.
 */

export type NivelStake = 'R1' | 'R2' | 'R3';

export const POLITICA_EXPOSICAO = {
  /** teto geral por aposta, fração da banca: vale sempre, para qualquer origem de stake */
  tetoGeralPorAposta: 0.02,
  /** teto agregado por jogo: soma de TODAS as apostas registradas no mesmo evento, em qualquer mercado */
  tetoPorJogo: 0.02,
  /** teto específico por nível de referência da V4 (o R3 é preço do modelo: mais apertado) */
  tetoPorNivel: { R1: 0.02, R2: 0.02, R3: 0.01 } as Record<NivelStake, number>,
  /** teto de cada entrada da lista "Melhores entradas" */
  tetoListaEntradas: 0.01,
  /** teto diário: soma de tudo o que foi registrado no dia (banca.ts: TETO_DIA) */
  tetoPorDia: 0.06,
  /** fração de Kelly por nível de referência da V4 */
  kellyPorNivel: { R1: 1 / 4, R2: 1 / 6, R3: 1 / 8 } as Record<NivelStake, number>,
  /** fração de Kelly por DQ e robustez (V3.3 e lista): 1/4 só com DQ A/B, ROBUSTA e escalação certa */
  kellyForte: 0.25,
  kellyPadrao: 0.125,
  /** qualidade dos dados que nunca autoriza exposição */
  dqSemExposicao: ['D', 'E'] as readonly string[],
};

/**
 * O que ainda cabe neste jogo (fração da banca): teto por jogo menos o já comprometido. Valor
 * ausente conta como zero comprometido; valor inválido (NaN, negativo) conta como jogo cheio.
 */
export function folgaDoJogo(expostoJogo?: number): number {
  if (expostoJogo === undefined) return POLITICA_EXPOSICAO.tetoPorJogo;
  if (!Number.isFinite(expostoJogo) || expostoJogo < 0) return 0;
  return Math.max(0, POLITICA_EXPOSICAO.tetoPorJogo - expostoJogo);
}

/** Teto da aposta: o do nível (se houver) ou o geral; nunca acima do geral. */
export function tetoDaAposta(nivel?: NivelStake): number {
  const especifico = nivel ? POLITICA_EXPOSICAO.tetoPorNivel[nivel] : undefined;
  return Math.min(POLITICA_EXPOSICAO.tetoGeralPorAposta, especifico ?? Infinity);
}
