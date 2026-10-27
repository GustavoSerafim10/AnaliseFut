/**
 * Regra 0.10 — texto "a aposta ganha se…" para conferir o lado antes de calcular.
 */
import { ehLinhaDeQuarto } from './liquidacao';
import { NOME_ESTATISTICA } from './contagens';
import { estatisticaDoMercado, normalizarLado } from './mercados';
import type { LinhaOdd, NomesTimes } from './tipos';

const num = (n: number) => String(n).replace('.', ',');
const sinal = (n: number) => (n > 0 ? `+${num(n)}` : num(n));
const naoVencerPor = (n: number) => (n === 1 ? 'NÃO vencer' : `NÃO vencer por ${n}+ gols`);

function textoHandicap(time: string, adversario: string, L: number): string {
  if (ehLinhaDeQuarto(L)) {
    return `${time} ${sinal(L)}: aposta dividida em ${sinal(L - 0.25)} e ${sinal(L + 0.25)} (meio ganho / meia perda possíveis)`;
  }
  if (Number.isInteger(L)) {
    if (L === 0) return `${time} vencer; empate devolve a aposta`;
    if (L < 0)
      return `${time} vencer por ${-L + 1}+ gols; vitória por exatamente ${-L} devolve a aposta`;
    return `${adversario} ${naoVencerPor(L)}; vitória de ${adversario} por exatamente ${L} devolve a aposta`;
  }
  if (L < 0)
    return Math.ceil(-L) === 1 ? `${time} vencer` : `${time} vencer por ${Math.ceil(-L)}+ gols`;
  return `${adversario} ${naoVencerPor(Math.ceil(L))}`;
}

function textoTotal(lado: string, L: number, alvo: string, unidade = 'gols'): string {
  const base = `${alvo} ${lado === 'over' ? 'mais' : 'menos'} de ${num(L)} ${unidade}`;
  if (ehLinhaDeQuarto(L))
    return `${base} (linha de quarto: metade em ${num(L - 0.25)}, metade em ${num(L + 0.25)})`;
  if (Number.isInteger(L)) return `${base}; exatamente ${L} devolve a aposta`;
  return base;
}

/** Handicap de escanteios/cartões: compara a contagem dos dois times com a linha. */
function textoHandicapContagem(time: string, adversario: string, L: number, unidade: string) {
  const base = `${unidade} de ${time} ${sinal(L)} > ${unidade} de ${adversario}`;
  if (ehLinhaDeQuarto(L)) return `${base} (linha de quarto: meio ganho / meia perda possíveis)`;
  if (Number.isInteger(L)) return `${base}; empate com a linha devolve a aposta`;
  if (L < 0) return `${time} ter pelo menos ${Math.ceil(-L)} ${unidade} a mais que ${adversario}`;
  const n = Math.ceil(L);
  return `${time} NÃO ter ${n}+ ${unidade} a menos que ${adversario}`;
}

function descreverNivel3(l: LinhaOdd, nomes: NomesTimes): string | null {
  const estat = estatisticaDoMercado(l.mercado);
  if (!estat) return null;
  const u = NOME_ESTATISTICA[estat];
  const lado = normalizarLado(l.lado);
  const L = l.linha;
  const nomeTime = (t: 'casa' | 'fora') => (t === 'casa' ? nomes.casa : nomes.fora);
  switch (l.mercado) {
    case 'escanteios_total':
    case 'cartoes_total':
      return L === undefined ? null : textoTotal(lado, L, 'sair', u);
    case 'escanteios_time':
    case 'cartoes_time':
      if (L === undefined || !l.time) return null;
      return textoTotal(lado, L, `${nomeTime(l.time)} ter`, u);
    case 'escanteios_ah':
    case 'cartoes_ah':
      if (L === undefined || (lado !== 'casa' && lado !== 'fora')) return null;
      return textoHandicapContagem(
        nomeTime(lado),
        nomeTime(lado === 'casa' ? 'fora' : 'casa'),
        L,
        u,
      );
    case 'escanteios_1x2':
    case 'cartoes_1x2':
      return lado === '1'
        ? `${nomes.casa} ter mais ${u} que ${nomes.fora}`
        : lado === '2'
          ? `${nomes.fora} ter mais ${u} que ${nomes.casa}`
          : `os dois times terem o mesmo número de ${u}`;
    case 'primeiro_escanteio':
      return lado === 'nenhum'
        ? 'não sair escanteio no jogo'
        : `${nomeTime(lado === 'fora' ? 'fora' : 'casa')} cobrar o primeiro escanteio`;
    default:
      return null;
  }
}

export function descreverAposta(l: LinhaOdd, nomes: NomesTimes): string {
  const lado = normalizarLado(l.lado);
  const L = l.linha;
  const tempo = l.periodo === 'FT' ? '' : l.periodo === '1T' ? ' (1º tempo)' : ' (2º tempo)';
  const nomeTime = (t: 'casa' | 'fora') => (t === 'casa' ? nomes.casa : nomes.fora);
  const r1x2 = (r: string) =>
    r === '1' ? `${nomes.casa} vencer` : r === '2' ? `${nomes.fora} vencer` : 'empate';

  let texto: string;
  switch (l.mercado) {
    case '1X2':
      texto = r1x2(lado);
      break;
    case 'DC':
      texto = lado.split('').map(r1x2).join(' ou ');
      break;
    case 'DNB':
      texto = `${r1x2(lado)}; empate devolve a aposta`;
      break;
    case 'AH':
      if (L === undefined || (lado !== 'casa' && lado !== 'fora')) return `${l.mercado} ${l.lado}`;
      texto = textoHandicap(nomeTime(lado), nomeTime(lado === 'casa' ? 'fora' : 'casa'), L);
      break;
    case 'total':
      if (L === undefined) return `${l.mercado} ${l.lado}`;
      texto = textoTotal(lado, L, 'sair');
      break;
    case 'total_time':
      if (L === undefined || !l.time) return `${l.mercado} ${l.lado}`;
      texto = `${textoTotal(lado, L, `${nomeTime(l.time)} marcar`)} (conta só os gols de ${nomeTime(l.time)})`;
      break;
    case 'ambas':
      texto = lado === 'sim' ? 'os dois times marcarem' : 'pelo menos um time NÃO marcar';
      break;
    case 'vencer_sem_sofrer':
      texto = `${nomeTime(l.time ?? 'casa')} vencer sem sofrer gol${lado === 'nao' ? ': NÃO' : ''}`;
      break;
    default:
      texto =
        descreverNivel3(l, nomes) ??
        `${l.mercado} — ${l.lado}${L !== undefined ? ` ${num(L)}` : ''}`;
  }
  return `Ganha se: ${texto}${tempo}.`;
}
