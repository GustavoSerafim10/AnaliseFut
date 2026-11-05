/**
 * As odds de uma casa saem dos prints guardados: apagar um print tira as odds dele, e um leitor
 * corrigido vale sem colar nada de novo. O que foi corrigido à mão ou importado continua.
 */
import { chaveSelecao, type LinhaOdd } from '@pe/engine';
import { juntarLinhas } from '@pe/parsers';
import type { OddLine } from '@pe/schemas';

const chave = (o: OddLine) => chaveSelecao(o as LinhaOdd);
const veioDoPrint = (o: OddLine) => !o.fonte || o.fonte === 'ocr';

/** Troca as odds lidas de print da casa pela leitura nova, sem tocar no que é à mão. */
export function aplicarLeitura(odds: OddLine[], casa: string, lidas: OddLine[]): OddLine[] {
  const proprias = odds.filter((o) => o.casa === casa && !veioDoPrint(o));
  const fixas = new Set(proprias.map(chave));
  const novas = juntarLinhas(lidas.map((o) => ({ ...o, casa }))).linhas.filter(
    (o) => !fixas.has(chave(o)),
  );
  return [...odds.filter((o) => o.casa !== casa), ...proprias, ...novas];
}

/**
 * Quantas odds guardadas não saem mais dos prints: lidas por uma versão antiga do leitor ou de um
 * print já apagado. Odd que você removeu de propósito não conta.
 */
export function oddsDefasadas(odds: OddLine[], casa: string, lidas: OddLine[]): number {
  const atuais = new Map(juntarLinhas(lidas).linhas.map((o) => [chave(o), o.odd]));
  return odds.filter((o) => o.casa === casa && veioDoPrint(o) && atuais.get(chave(o)) !== o.odd)
    .length;
}
