/**
 * Versão do motor e políticas vigentes, gravadas em TODO registro do Ledger.
 *
 * `VERSAO_MOTOR` é bumpada À MÃO sempre que muda a lógica de decisão, de precificação ou de
 * exposição. Como alguém pode esquecer, cada registro também leva a impressão digital das
 * POLÍTICAS (limites, gates, pesos, registro de casas): se um número mudou, a impressão muda,
 * mesmo sem trocar a versão, e a reprodução acusa `politicas_diferentes`.
 */
import { REGISTRO_CASAS, COMISSAO_BETFAIR } from '../casas';
import {
  DRAWDOWN_PAUSA,
  DRAWDOWN_REDUZ,
  DIAS_PAUSA,
  PERDAS_ENCERRAM_DIA,
  TETO_DIA,
} from '../banca';
import {
  CHANCE_SINAL_FORTE,
  DIVERGENCIA_MAX_ENTRADA,
  DIVERGENCIA_SINAL_FORTE,
  FOLGA_SINAL_FORTE,
  MAX_ENTRADAS,
  ODD_MAX_ENTRADA,
  ODD_MIN_ENTRADA,
  STAKE_ENTRADA,
} from '../entradas';
import { EV_MINIMO_BASE, EV_SANIDADE, PESO_MODELO_BASE, W_MAX_NIVEL3 } from '../gates';
import { EV_TOLERANCIA } from '../kelly';
import { FRACAO_1T } from '../mercados';
import { RHO_PADRAO } from '../poisson';
import { POLITICA_EXPOSICAO } from '../politicaExposicao';
import { LIMITE_OUTLIER } from '../precificacao';
import {
  DISCORDANCIA_FORTE,
  DIVERGENCIA_ALTA_V4,
  ERRO_REFERENCIA_R1,
  ERRO_REFERENCIA_R2,
  EV_EXPLODIDO_V4,
  EV_INVESTIGAR_V4,
  GATE_V4,
  JANELA_COMPARAVEL_MIN,
  JOGOS_MIN_NICHO,
  MARGEM_MAXIMA_REF,
  MIN_CASAS_CONSENSO,
} from '../v4';
import { sha256Hex } from './hash';
import type { Json } from './json';
import { serializarCanonico } from './json';

/** Bumpar quando a lógica de decisão, precificação ou exposição mudar. */
export const VERSAO_MOTOR = 'motor-2026-11-13.1';

/** Todos os números que decidem algo, num JSON auditável sem o código antigo. */
export function politicasVigentes(): Json {
  return JSON.parse(
    JSON.stringify({
      exposicao: POLITICA_EXPOSICAO,
      banca: {
        tetoDia: TETO_DIA,
        drawdownReduz: DRAWDOWN_REDUZ,
        drawdownPausa: DRAWDOWN_PAUSA,
        diasPausa: DIAS_PAUSA,
        perdasEncerramDia: PERDAS_ENCERRAM_DIA,
      },
      v4: {
        gates: GATE_V4,
        evInvestigar: EV_INVESTIGAR_V4,
        evExplodido: EV_EXPLODIDO_V4,
        minCasasConsenso: MIN_CASAS_CONSENSO,
        janelaComparavelMin: JANELA_COMPARAVEL_MIN,
        margemMaximaReferencia: MARGEM_MAXIMA_REF,
        jogosMinNicho: JOGOS_MIN_NICHO,
        discordanciaForte: DISCORDANCIA_FORTE,
        divergenciaAlta: DIVERGENCIA_ALTA_V4,
        erroReferenciaR1: ERRO_REFERENCIA_R1,
        erroReferenciaR2: ERRO_REFERENCIA_R2,
        comissaoBetfair: COMISSAO_BETFAIR,
      },
      gates: {
        pesoModeloBase: PESO_MODELO_BASE,
        evMinimoBase: EV_MINIMO_BASE,
        evSanidade: EV_SANIDADE,
        wMaxNivel3: W_MAX_NIVEL3,
      },
      kelly: { evTolerancia: EV_TOLERANCIA },
      modelo: { rho: RHO_PADRAO, fracao1T: FRACAO_1T },
      precificacao: { limiteOutlier: LIMITE_OUTLIER },
      entradas: {
        oddMin: ODD_MIN_ENTRADA,
        oddMax: ODD_MAX_ENTRADA,
        divergenciaMax: DIVERGENCIA_MAX_ENTRADA,
        divergenciaSinalForte: DIVERGENCIA_SINAL_FORTE,
        chanceSinalForte: CHANCE_SINAL_FORTE,
        folgaSinalForte: FOLGA_SINAL_FORTE,
        stakeEntrada: STAKE_ENTRADA,
        maxEntradas: MAX_ENTRADAS,
      },
      casas: REGISTRO_CASAS,
    }),
  ) as Json;
}

/** SHA-256 da serialização canônica das políticas. */
export async function impressaoDasPoliticas(
  politicas: Json = politicasVigentes(),
): Promise<string> {
  return sha256Hex(serializarCanonico(politicas));
}
