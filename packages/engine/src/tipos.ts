/**
 * Tipos compartilhados do motor V3.3.
 *
 * Vocabulário (igual ao do protocolo):
 * - `casa` em LinhaOdd = casa de apostas (1win, Bet365…).
 * - `casa`/`fora` em Lambdas e `time` = mandante/visitante.
 */

export type Periodo = 'FT' | '1T' | '2T';
export type Time = 'casa' | 'fora';
export type DQ = 'A' | 'B' | 'C' | 'D' | 'E';

export const MERCADOS = [
  '1X2',
  'DC',
  'DNB',
  'AH',
  'AH_europeu',
  'total',
  'total_time',
  'ambas',
  'par_impar',
  'vencer_sem_sofrer',
  'marcar_2_tempos',
  'intervalo_final',
  'primeiro_gol',
  'ultimo_gol',
  'combo_resultado_total',
  'combo_1x2_ambas',
  'combo_total_ambas',
  'placar_exato',
  'n_exato_gols',
  'tempo_1o_gol',
  'escanteios_total',
  'escanteios_time',
  'escanteios_ah',
  'escanteios_1x2',
  'primeiro_escanteio',
  'cartoes_ah',
  'chutes_ah',
  'impedimentos_ah',
  'outro',
] as const;

export type TipoMercado = (typeof MERCADOS)[number];

/**
 * Uma odd lida de um print.
 *
 * Convenções de `lado` (maiúsculas/minúsculas tanto faz):
 * - 1X2 / AH_europeu: '1' | 'X' | '2'      · DC: '1X' | '12' | 'X2'   · DNB: '1' | '2'
 * - AH: 'casa' | 'fora', com `linha` do ponto de vista do lado apostado
 *   (Villa −1.5 → lado 'casa', linha −1.5; Viking +1.5 → lado 'fora', linha 1.5)
 * - total / total_time: 'over' | 'under' (total_time exige `time`)
 * - ambas / vencer_sem_sofrer / marcar_2_tempos: 'sim' | 'nao' (os dois últimos exigem `time`)
 * - par_impar: 'par' | 'impar'        · placar_exato: '2-1'   · n_exato_gols: '3' ou '5+'
 * - intervalo_final: 'X/1' (intervalo/final)   · primeiro_gol / ultimo_gol: 'casa' | 'fora' | 'nenhum'
 * - combos: '1&over', '1&sim', 'over&sim' (com `linha` quando houver total)
 */
export interface LinhaOdd {
  casa: string;
  mercado: TipoMercado;
  linha?: number;
  lado: string;
  odd: number;
  /** ISO 8601. Sem horário a odd não serve para o Price Gate. */
  horarioColeta?: string;
  periodo: Periodo;
  time?: Time;
}

export interface Lambdas {
  casa: number;
  fora: number;
}

export interface NomesTimes {
  casa: string;
  fora: string;
}
