/**
 * Dicionário de sinônimos: título do mercado no print → tipo de mercado do motor.
 * Calibrado com prints reais da 1win; os nomes usados por Bet365, Betano, Superbet e Pinnacle
 * (em português) entram pelo formato público dessas casas, ainda sem prints reais.
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

/**
 * Ordem importa: mais específicos primeiro. Mercados que PARECEM outros mas se liquidam
 * diferente (ex.: "Vitória antecipada 1:0" não é o 1X2) vão para 'outro' antes de tudo.
 */
export const SINONIMOS_MERCADO: [RegExp, TipoMercado][] = [
  // PlayOn: o 1X2 de escanteios tem este título
  [/quem tem mais escanteios/, 'escanteios_1x2'],
  [
    // Futamina/Jogou: "Pagamento antecipado" (paga com 2 gols de vantagem), "Resultado + ambas",
    // "Resultado + total" e o handicap europeu de 3 vias ("Resultado com handicap")
    // 99Play: "Handicap 1×2" (3 vias, "Começa 0:2"), "Botafogo SP devolve aposta" (é dupla chance
    // com devolução, não o empate anula), "Qual equipe vai marcar", "Botafogo SP para marcar"
    // CasaDeApostas: "Handicap 0:1" (3 vias), "<time> para vencer um dos tempos", "<time> sem sofrer gols"
    /handicap \d ?: ?\d|vencer (em )?(ambos|um)( dos| os)? tempos|(?<!vencer )sem sofrer|handicap 1 ?[x×] ?2|(?<!empate )devolve aposta|qual equipe|para marcar|^\S* ?marcador\b|vitoria antecipada|pagamento antecipado|resultado com handicap|(resultado( final)?|total de gols|gols) ?(\+|e) ?(ambas|total)|nao sofre gol|a partir de desvantagem|qualquer um dos tempos|ambos os tempos vencer|vencer ambos os tempos|red card|penalidade|penalti/,
    'outro',
  ],
  // minuto do 1º gol, tempo com mais gols e par/ímpar dos gols de UM time ("Total de gols -
  // Cruzeiro. Par/Impar"; o " - " some na normalização da 1win) não têm modelo
  [/goal time|tempo mais competitivo|em qual tempo|gols?( -)? [^.]+\. ?(par|impar)/, 'outro'],
  // corrida de escanteios ("Primeira a executar N cantos") e último escanteio também não
  [/a executar|ultimo canto|ultimo escanteio/, 'outro'],
  // combinados ("1X2 e os dois times devem marcar", "Resultado e Total", "Total e ambos os
  // times marcam") não são o 1X2 nem o ambos: Frosinone a zero @ 4 virava "1 @ 4"
  [
    /(1x2|resultado|total|gols?) e (os )?(dois|ambos)|e (os )?(dois|ambos) (os )?times|resultado e total|numero exato/,
    'outro',
  ],
  [/cart(ao|oes).*handicap|handicap.*cart(ao|oes)/, 'cartoes_ah'],
  // só cartões AMARELOS têm modelo; primeiro cartão e dupla chance de cartões não
  [/primeiro cartao|(dupla|hipotese).*cart|cart.*(dupla|hipotese)|vermelho/, 'outro'],
  [/cart(ao|oes) amarelos?.*resultado|resultado.*cart(ao|oes) amarelos?/, 'cartoes_1x2'],
  [/total.*cart(ao|oes) amarelos?|cart(ao|oes) amarelos?.*total/, 'cartoes_total'],
  [/cart(ao|oes)|amarelo/, 'outro'],
  [/primeiro escanteio|1o escanteio|primeiro canto/, 'primeiro_escanteio'],
  [/(escanteios?|cantos?) (impar|par)\b|escala de escanteios/, 'outro'],
  [/handicap de escanteios|escanteios?.*handicap|cantos?.*handicap/, 'escanteios_ah'],
  [/(escanteios?|cantos?).*(resultado|1 ?x ?2)|corners?.*result/, 'escanteios_1x2'],
  [/(escanteios?|cantos?)[. ]*(total|mais\/menos|over)?/, 'escanteios_total'],
  [/chutes|finalizac|impediment|laterais|tiros de meta/, 'outro'],
  [/resultado correto|placar (exato|correto)|resultado exato/, 'placar_exato'],
  [/intervalo ?[/f]+ ?final|intervalo final|ht ?\/ ?ft/, 'intervalo_final'],
  [/dupla (chance|hipotese)|(chance|hipotese) dupla|double chance/, 'DC'],
  [/empate anula|empate devolve|draw no bet|\bdnb\b/, 'DNB'],
  [
    /ambos (os )?(times )?marca|ambas (as )?(equipes )?marca|\bbtts\b|both teams|gol de ambos/,
    'ambas',
  ],
  [/marcar em ambos os tempos/, 'marcar_2_tempos'],
  [/vencer sem sofrer/, 'vencer_sem_sofrer'],
  [/primeiro gol|proximo gol|marcar o primeiro|marca primeiro|primeiro a marcar/, 'primeiro_gol'],
  [/ultimo gol|marcar o ultimo/, 'ultimo_gol'],
  [/handicap europeu|handicap 3/, 'AH_europeu'],
  [/handicap( asiatico)?/, 'AH'],
  [/par ?\/ ?impar|impar ?\/ ?par|par ou impar/, 'par_impar'],
  [
    /resultado do (1|2|primeiro|segundo).{0,2} tempo|resultado do tempo regulamentar|resultado (final|do jogo|da partida)|\b1x2\b|vencedor (da partida|do jogo|do encontro)|money ?line|^resultado$/,
    '1X2',
  ],
  [
    /total de gols|gols mais ?\/ ?menos|gols \+ ?\/ ?-|over ?\/ ?under|mais ?\/ ?menos|acima ?\/ ?abaixo|\btota(l|is)\b/,
    'total',
  ],
];

/** Barra de abas da casa ("Todos Principal Totais Handicap metade"): não é título de mercado. */
export function ehBarraDeAbas(linha: string): boolean {
  const t = semAcento(linha);
  // título da 1win separa as partes com ". " ("Handicap asiático. Chutes"): não é a barra, e
  // sem isso o bloco de chutes herdava o "Handicap de escanteios" de cima
  if (/[a-z]\.\s+[a-z]/.test(t)) return false;
  // 99Play: mercado "Totais chutes" (são duas palavras de aba, mas é título)
  if (/\btotais chutes\b/.test(t)) return false;
  // PlayOn: "Principais Gols Handicap Tempos Escanteios" e "Escanteios e cartões Jogadores Outros Todos"
  if (/principais.*(gols|handicap|tempos)|jogadores.*(outros|todos)/.test(t)) return true;
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

  // estatística sem modelo, mesmo com nome de time e "total": "Londrina PR total de impedimentos"
  // virava gols do Londrina
  if (/chutes|finalizac|impediment|laterais|tiros de meta|\bfaltas\b/.test(t))
    return { mercado: 'outro', periodo };

  // "Aston Villa total", "Escanteios. CR Flamengo total", "Cartões amarelos. CR Flamengo total"
  // (par/ímpar dos gols de um time não é o total dele)
  // ("Escanteios. Athletico Paranaense totais": a 1win também escreve no plural)
  if (/\btota(l|is)\b/.test(t) && !/par ?\/ ?impar|impar ?\/ ?par/.test(t)) {
    const time = reconhecerTime(
      t.replace(
        /escanteios?|cantos?|cart(ao|oes)|amarelos?|totais|total|individual|de gols|do time|da equipe/g,
        ' ',
      ),
      jogo,
      true,
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
    // "<nome que não reconheço> total": é total de um time, nunca do jogo. Virar total do jogo já
    // deu EV falso duas vezes ("Milão total" 2.5 @ 1.74/2.08 contra 2.61/1.49 do jogo)
    // PlayOn: "Total de gols do <time>" nunca é o total do jogo, mesmo sem reconhecer o nome
    if (/\btotal de gols d[oae]s? (?!jogo|partida|confronto)[a-z]/.test(t))
      return { mercado: 'outro', periodo };
    const antes = /^(.*)\btota(l|is)\b[^a-z]*(a\b)?[^a-z]*$/.exec(t)?.[1] ?? '';
    const sobra = antes
      .replace(
        /escanteios?|cantos?|cart(ao|oes)|amarelos?|resultado|gols?|tempos?|partida|jogo|mais|menos|primeiro|segundo/g,
        ' ',
      )
      .match(/[a-z]{3,}/);
    if (sobra) return { mercado: 'outro', periodo };
  }
  for (const [re, mercado] of SINONIMOS_MERCADO) {
    if (!re.test(t)) continue;
    // CasaDeApostas: "Toulouse FC Vencer sem sofrer gols", com os lados "sim" e "não"
    const time =
      mercado === 'vencer_sem_sofrer'
        ? reconhecerTime(t.replace(/vencer sem sofrer.*/, ' '), jogo)
        : null;
    return time ? { mercado, periodo, time } : { mercado, periodo };
  }
  return null;
}
