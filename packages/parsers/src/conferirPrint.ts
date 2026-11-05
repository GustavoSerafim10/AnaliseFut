/**
 * Trava de print errado: avisa quando o print parece ser de outro jogo ou da área errada. Só
 * avisa com evidência no próprio print; na dúvida (print sem nome nem data) fica quieto, e nada
 * é bloqueado: o usuário decide.
 */
import type { NomesTimes } from '@pe/engine';
import { semAcento } from './texto';
import { reconhecerTime } from './times';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ODD = '\\d[\\d.,]*';

/** "5 de nov. de 2026, 14:45" (cabeçalho da 1win) */
function dataDoCabecalho(t: string): { data: string; hora?: string } | null {
  const m =
    /(\d{1,2}) de (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\w*\.? de (20\d{2})(?:,? *(\d{2}:\d{2}))?/.exec(
      t,
    );
  if (!m) return null;
  const mes = String(MESES.indexOf(m[2]) + 1).padStart(2, '0');
  return { data: `${m[3]}-${mes}-${m[1].padStart(2, '0')}`, hora: m[4] };
}

/** Nomes da fileira do resultado: "Milão 1.32 Empate 5.4 Ferencváros 9.6" ou só os rótulos. */
function timesDaFileira(linhas: string[]): [string, string] | null {
  const comOdds = new RegExp(`^(.+?) +${ODD} +empate +${ODD} +(.+?) +${ODD}$`);
  const soRotulos = /^(.+?) +empate +(.+)$/;
  for (const l of linhas) {
    if (/\b(ou|e)\b|\d:\d/.test(l) || l.split('empate').length !== 2) continue;
    const m = comOdds.exec(l) ?? (/\d/.test(l) ? null : soRotulos.exec(l));
    if (m) return [m[1], m[2]];
  }
  return null;
}

export function conferirPrintOdds(
  texto: string,
  c: { jogo: NomesTimes; data?: string; hora?: string; oddsLidas: number },
): string | null {
  const t = semAcento(texto);
  const linhas = t.split('\n').map((l) => l.trim());
  const nome = `${c.jogo.casa} × ${c.jogo.fora}`;
  const dia = dataDoCabecalho(t);
  if (dia && c.data && dia.data !== c.data)
    return `Este print parece ser de outro dia (${dia.data.split('-').reverse().join('/')}): confira se é de ${nome}.`;
  if (dia?.hora && c.hora && dia.hora !== c.hora)
    return `O print mostra o jogo às ${dia.hora}, e o cadastro diz ${c.hora}: confira se é de ${nome}.`;
  const times = timesDaFileira(linhas);
  if (times && !reconhecerTime(times[0], c.jogo) && !reconhecerTime(times[1], c.jogo))
    return `Os times do print não batem com ${nome}: confira se é deste jogo.`;
  if (!c.oddsLidas && /posse de bola|gols esperados|desarmes|grandes chances/.test(t))
    return 'Parece um print de estatísticas: ele vai na seção Estatísticas, não nas odds.';
  return null;
}

export function conferirPrintEstatisticas(texto: string): string | null {
  const t = semAcento(texto);
  const odds = t.match(/\b(abaixo|acima|mais|menos) ?de ?\d/g) ?? [];
  return odds.length >= 3
    ? 'Parece um print de odds: ele vai na seção Mercado, não nas estatísticas.'
    : null;
}
