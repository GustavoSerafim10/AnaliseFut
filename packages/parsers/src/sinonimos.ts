/**
 * Dicionário de sinônimos: título do mercado no print → tipo de mercado do motor.
 * Para uma casa nova, basta acrescentar padrões aqui.
 */
import type { NomesTimes, Periodo, Time, TipoMercado } from '@pe/engine';
import { semAcento } from './texto';
import { reconhecerTime } from './times';

export interface MercadoDetectado {
  mercado: TipoMercado;
  periodo: Periodo;
  time?: Time;
}

/** Ordem importa: os mais específicos primeiro. */
export const SINONIMOS_MERCADO: [RegExp, TipoMercado][] = [
  [/escanteios?.*(handicap)|cantos?.*handicap/, 'escanteios_ah'],
  [/(escanteios?|cantos?)[. ]*(total|mais\/menos|over)?/, 'escanteios_total'],
  [/cartoes?.*handicap/, 'cartoes_ah'],
  [/intervalo ?\/ ?final|intervalo final|ht ?\/ ?ft/, 'intervalo_final'],
  [/dupla (chance|hipotese)|double chance/, 'DC'],
  [/empate anula|draw no bet|\bdnb\b/, 'DNB'],
  [/ambos (os times )?marca|ambas (as equipes )?marca|\bbtts\b|both teams/, 'ambas'],
  [/handicap europeu|handicap 3/, 'AH_europeu'],
  [/handicap( asiatico)?/, 'AH'],
  [/placar (exato|correto)|resultado exato/, 'placar_exato'],
  [/par ?\/ ?impar|par ou impar/, 'par_impar'],
  [
    /resultado do tempo regulamentar|resultado final|\b1x2\b|vencedor (da partida|do jogo)|^resultado$/,
    '1X2',
  ],
  [/total de gols|gols mais ?\/ ?menos|over ?\/ ?under|mais ?\/ ?menos|^total\b|\btotal$/, 'total'],
];

function detectarPeriodo(t: string): Periodo {
  if (/1[ºo°]? ?tempo|primeiro tempo|1st half|\b1t\b/.test(t)) return '1T';
  if (/2[ºo°]? ?tempo|segundo tempo|2nd half|\b2t\b/.test(t)) return '2T';
  return 'FT';
}

export function detectarTituloMercado(linha: string, jogo: NomesTimes): MercadoDetectado | null {
  const t = semAcento(linha).trim();
  const periodo = detectarPeriodo(t);

  // "Aston Villa total", "Total individual Viking", "Total do time"
  if (/\btotal\b/.test(t) && !/escanteio|canto|cartao/.test(t)) {
    const time = reconhecerTime(
      t.replace(/total|individual|de gols|do time|da equipe/g, ' '),
      jogo,
    );
    if (time) return { mercado: 'total_time', periodo, time };
  }
  for (const [re, mercado] of SINONIMOS_MERCADO) {
    if (re.test(t)) return { mercado, periodo };
  }
  return null;
}
