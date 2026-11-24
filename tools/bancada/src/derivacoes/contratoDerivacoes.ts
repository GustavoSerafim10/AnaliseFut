/**
 * Contrato da F1.3 (derivações): os campos que a F1.1 deixou como "pendente F1.3", calculados
 * só na bancada, com o motor apenas LIDO. Três universos, cada registro com exatamente um estado:
 *
 *  - seleções (F1.1, só de análises com revisão de decisão): P do modelo bruto e ajustado,
 *    peso w, mistura e desfecho — conferidos contra os valores gravados na evidência
 *  - entradas das análises elegíveis (resumo.entrada; inclui v1/v2 sem evidência): só desfecho
 *  - apostas feitas (F1.1): só desfecho
 */
import type { StatusAnalise, StatusVinculado } from '../reproducao/contratoConsolidacao';

export const VERSAO_CONTRATO_DERIVACOES = 1;

/** Resultado do motor (apurarAposta): 1 ganho · ½ meio ganho · 0 devolvida · −½ meia perda · −1 perda */
export type ResultadoApuracao = 1 | 0.5 | 0 | -0.5 | -1;

export type EstadoDesfecho =
  /** apurado pelo placar (a devolução também é "apurado", com peso 0) */
  | 'apurado'
  /** sem resultado, ou só o fechamento (NaN do site, null no backup) */
  | 'sem-placar'
  /** entradas do mesmo jogo com placares diferentes (a F1.1 não escolhe um) */
  | 'placar-em-conflito'
  /** o motor precisa de um dado que o placar não tem (intervalo, escanteios, sequência...) */
  | 'dado-insuficiente'
  /** o motor não sabe liquidar esta linha */
  | 'mercado-desconhecido'
  /** placar apurável, mas a marcação manual registrada diverge da apuração automática (E3) */
  | 'conflito-manual';

/**
 * Régua do motor (probEfetiva): y e peso. Ganho y=1 peso 1; meio ganho y=1 peso ½; meia perda
 * y=0 peso ½; perda y=0 peso 1; devolução fora (peso 0, y null). NUNCA 0,75 nem 0,5 como y.
 */
export interface Desfecho {
  estado: EstadoDesfecho;
  resultado: ResultadoApuracao | null;
  y: 0 | 1 | null;
  peso: 0 | 0.5 | 1;
  rotulo: string | null;
  /** marcação manual registrada na entrada (green/red/devolvida), só para rastreio */
  manual: string | null;
  motivo: string | null;
}

export type EstadoDerivacao =
  | 'derivado'
  /** o recálculo não bate com o valor gravado (tolerância D3): marcado, nunca corrigido */
  | 'derivacao-divergente'
  /** sem λ do modelo na evidência, ou mercado que o modelo não cobre */
  | 'sem-modelo'
  /** análise sem revisão de evidência (backups v1/v2): não se fabrica P do modelo (E4) */
  | 'indisponivel-sem-evidencia';

export interface Conferencia {
  campo: string;
  gravado: number;
  recalculado: number;
  confere: boolean;
}

export interface DerivacaoSelecao {
  idHistorico: string;
  chave: string;
  chaveGrupo: string;
  /** status da análise na F1.2c (camada de confiança) */
  status: StatusVinculado | null;
  estado: EstadoDerivacao;
  motivo: string | null;
  nivelReferencia: string | null;
  pModeloBruto: number | null;
  pModeloAjustado: number | null;
  wMistura: number | null;
  /** parte "mercado" da mistura: P_true no R1/R2; P_consenso no R3 (o P_true do R3 já é mistura) */
  pMercadoBase: number | null;
  /** E1: w × P_modelo AJUSTADO + (1 − w) × P_mercado — a mistura que a V4 usou */
  pMistura: number | null;
  /** E1: a mesma mistura com o λ bruto, para a F1.4 medir o efeito do ajuste */
  pMisturaBruta: number | null;
  conferencias: Conferencia[];
  desfecho: Desfecho;
}

export interface DesfechoEntrada {
  idHistorico: string;
  status: StatusAnalise | null;
  /** chave da seleção da entrada, quando há linha */
  chave: string | null;
  /** a análise não registrou entrada (resumo.entrada ausente) */
  semEntrada: boolean;
  /** campos do modelo: só via seleção (com evidência); v1/v2 → indisponível (E4) */
  modelo: 'via-selecao' | 'indisponivel-sem-evidencia';
  desfecho: Desfecho | null;
}

export interface DesfechoAposta {
  idHistorico: string;
  irmaDe: string | null;
  status: StatusVinculado | null;
  chave: string | null;
  desfecho: Desfecho;
}

export interface Derivacoes {
  contrato: number;
  /** commit/descrição do motor usado no recálculo (E2: motor atual + conferência) */
  motor: string;
  selecoes: DerivacaoSelecao[];
  entradas: DesfechoEntrada[];
  apostas: DesfechoAposta[];
  conservacao: { selecoes: number; entradas: number; apostas: number };
}
