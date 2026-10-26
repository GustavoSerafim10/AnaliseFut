/**
 * Regra 0.10 — texto "a aposta ganha se…" para conferir o lado antes de calcular.
 */
import { ehLinhaDeQuarto } from './liquidacao';
import { normalizarLado } from './mercados';
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

function textoTotal(lado: string, L: number, alvo: string): string {
  const base = `${alvo} ${lado === 'over' ? 'mais' : 'menos'} de ${num(L)} gols`;
  if (ehLinhaDeQuarto(L))
    return `${base} (linha de quarto: metade em ${num(L - 0.25)}, metade em ${num(L + 0.25)})`;
  if (Number.isInteger(L)) return `${base}; exatamente ${L} devolve a aposta`;
  return base;
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
      texto = `${l.mercado} — ${l.lado}${L !== undefined ? ` ${num(L)}` : ''}`;
  }
  return `Ganha se: ${texto}${tempo}.`;
}
