/**
 * Dicionário de sinônimos: título do mercado no print → tipo de mercado do motor.
 * Calibrado com prints reais da 1win. Para uma casa nova, basta acrescentar padrões aqui.
 */
import type { NomesTimes, Periodo, Time, TipoMercado } from '@pe/engine';
import { semAcento } from './texto';
import { reconhecerTime } from './times';

export interface MercadoDetectado {
  mercado: TipoMercado;
  periodo: Periodo;
  time?: Time;
}

/**
 * Ordem importa: mais específicos primeiro. Mercados que PARECEM outros mas se liquidam
 * diferente (ex.: "Vitória antecipada 1:0" não é o 1X2) vão para 'outro' antes de tudo.
 */
export const SINONIMOS_MERCADO: [RegExp, TipoMercado][] = [
  [
    /vitoria antecipada|a partir de desvantagem|qualquer um dos tempos|ambos os tempos vencer|red card|penalidade|penalti/,
    'outro',
  ],
  [/cart(ao|oes).*handicap|handicap.*cart(ao|oes)/, 'cartoes_ah'],
  // só cartões AMARELOS têm modelo; primeiro cartão e dupla chance de cartões não
  [/primeiro cartao|(dupla|hipotese).*cart|cart.*(dupla|hipotese)|vermelho/, 'outro'],
  [/cart(ao|oes) amarelos?.*resultado|resultado.*cart(ao|oes) amarelos?/, 'cartoes_1x2'],
  [/total.*cart(ao|oes) amarelos?|cart(ao|oes) amarelos?.*total/, 'cartoes_total'],
  [/cart(ao|oes)|amarelo/, 'outro'],
  [/primeiro escanteio|1o escanteio|primeiro canto/, 'primeiro_escanteio'],
  [/handicap de escanteios|escanteios?.*handicap|cantos?.*handicap/, 'escanteios_ah'],
  [/escanteios?.*resultado|cantos?.*resultado/, 'escanteios_1x2'],
  [/(escanteios?|cantos?)[. ]*(total|mais\/menos|over)?/, 'escanteios_total'],
  [/chutes|finalizac|impediment|laterais|tiros de meta/, 'outro'],
  [/resultado correto|placar (exato|correto)|resultado exato/, 'placar_exato'],
  [/intervalo ?\/ ?final|intervalo final|ht ?\/ ?ft/, 'intervalo_final'],
  [/dupla (chance|hipotese)|hipotese dupla|double chance/, 'DC'],
  [/empate anula|draw no bet|\bdnb\b/, 'DNB'],
  [/ambos (os times )?marca|ambas (as equipes )?marca|\bbtts\b|both teams/, 'ambas'],
  [/marcar em ambos os tempos/, 'marcar_2_tempos'],
  [/vencer sem sofrer/, 'vencer_sem_sofrer'],
  [/primeiro gol|marcar o primeiro|marca primeiro/, 'primeiro_gol'],
  [/ultimo gol|marcar o ultimo/, 'ultimo_gol'],
  [/handicap europeu|handicap 3/, 'AH_europeu'],
  [/handicap( asiatico)?/, 'AH'],
  [/par ?\/ ?impar|impar ?\/ ?par|par ou impar/, 'par_impar'],
  [
    /resultado do tempo regulamentar|resultado (final|do jogo)|\b1x2\b|vencedor (da partida|do jogo)|^resultado$/,
    '1X2',
  ],
  [
    /total de gols|gols mais ?\/ ?menos|over ?\/ ?under|mais ?\/ ?menos|^total\b|\btotal\b/,
    'total',
  ],
];

/** Barra de abas da casa ("Todos Principal Totais Handicap metade"): não é título de mercado. */
export function ehBarraDeAbas(linha: string): boolean {
  const t = semAcento(linha);
  const abas = [
    'todos',
    'principal',
    'totais',
    'handicap',
    'metade',
    'intervalos',
    'chutes',
    'placar exa',
    'cartoes/penalidades',
  ];
  return abas.filter((a) => t.includes(a)).length >= 2;
}

function detectarPeriodo(t: string): Periodo {
  if (/1[ºo°]? ?(tempo|parte)|primeir[oa] (tempo|parte)|1st half|\b1t\b/.test(t)) return '1T';
  if (/2[ºo°]? ?(tempo|parte)|segund[oa] (tempo|parte)|2nd half|\b2t\b/.test(t)) return '2T';
  return 'FT';
}

export function detectarTituloMercado(linha: string, jogo: NomesTimes): MercadoDetectado | null {
  const t = semAcento(linha).trim();
  if (ehBarraDeAbas(t)) return null;
  const periodo = detectarPeriodo(t);

  // "Aston Villa total", "Escanteios. CR Flamengo total", "Cartões amarelos. CR Flamengo total"
  if (/\btotal\b/.test(t)) {
    const time = reconhecerTime(
      t.replace(
        /escanteios?|cantos?|cart(ao|oes)|amarelos?|total|individual|de gols|do time|da equipe/g,
        ' ',
      ),
      jogo,
    );
    const cartoes = /cart(ao|oes)|amarelo/.test(t);
    if (time)
      return {
        mercado: /escanteio|canto/.test(t)
          ? 'escanteios_time'
          : cartoes
            ? /amarelo/.test(t)
              ? 'cartoes_time'
              : 'outro'
            : 'total_time',
        periodo,
        time,
      };
  }
  for (const [re, mercado] of SINONIMOS_MERCADO) {
    if (re.test(t)) return { mercado, periodo };
  }
  return null;
}
