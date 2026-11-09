/**
 * As odds de uma casa saem dos prints guardados: apagar um print tira as odds dele, e um leitor
 * corrigido vale sem colar nada de novo. O que foi corrigido à mão ou importado continua.
 */
import { chaveSelecao, criarLiquidador, type LinhaOdd, type TipoMercado } from '@pe/engine';
import { checarSanidade, juntarLinhas } from '@pe/parsers';
import type { OddLine } from '@pe/schemas';
import { num } from './estado';

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

export interface RascunhoOdd {
  mercado: TipoMercado;
  periodo: 'FT' | '1T' | '2T';
  lado: string;
  time: '' | 'casa' | 'fora';
  linha: string;
  odd: string;
}

/** A odd digitada, pronta para entrar na casa; nada entra com mercado, lado ou linha inválidos. */
export function montarOddManual(
  d: RascunhoOdd,
  casa: string,
  horarioColeta: string,
): { linha: OddLine } | { erro: string } {
  const odd = num(d.odd);
  if (odd === undefined || odd <= 1) return { erro: 'Preencha a odd (maior que 1).' };
  const linha: OddLine = {
    casa,
    mercado: d.mercado,
    periodo: d.periodo,
    lado: d.lado,
    time: d.time || undefined,
    linha: num(d.linha),
    odd,
    horarioColeta,
    fonte: 'manual',
  };
  const problema = checarSanidade([linha as LinhaOdd]).find((p) => p.nivel === 'erro');
  if (problema) return { erro: problema.mensagem };
  const r = criarLiquidador(linha as LinhaOdd);
  return r.ok ? { linha } : { erro: r.motivo };
}

/** Grava a odd digitada; substitui a mesma seleção da casa e tira os cartões vazios do botão antigo. */
export function incluirOddManual(odds: OddLine[], nova: OddLine): OddLine[] {
  const k = chave(nova);
  const vazio = (o: OddLine) =>
    o.fonte === 'manual' &&
    o.mercado === '1X2' &&
    o.lado === '1' &&
    o.odd === 2 &&
    !o.horarioColeta;
  return [...odds.filter((o) => !vazio(o) && !(o.casa === nova.casa && chave(o) === k)), nova];
}
