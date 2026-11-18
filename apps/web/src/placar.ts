/**
 * Leitura do que o usuário digita no resultado do jogo: placar, intervalo, escanteios, amarelos e as
 * odds de fechamento. Funções puras, sem React. Nada é "adivinhado": o que não for válido volta como
 * `invalido` com o motivo, e o formulário não deixa salvar.
 *
 * Isto é a validação da camada do aplicativo. O Ledger continua sendo a última barreira, com as mesmas
 * regras (placar: inteiros não negativos; odds: finitas e maiores que 1).
 */
import type { ParPlacar } from '@pe/engine';

export type Leitura<T> =
  { estado: 'vazio' } | { estado: 'ok'; valor: T } | { estado: 'invalido'; motivo: string };

/** "2" → 2. Só dígitos: recusa "1.5", "1,5", "-1", "+1", "1e2", "2x" e espaços no meio. */
export function lerInteiroNaoNegativo(texto: string): Leitura<number> {
  const t = texto.trim();
  if (t === '') return { estado: 'vazio' };
  if (!/^\d+$/.test(t))
    return { estado: 'invalido', motivo: `"${t}": use só um número inteiro, 0 ou mais` };
  const n = Number(t);
  if (!Number.isSafeInteger(n))
    return { estado: 'invalido', motivo: `"${t}": número grande demais` };
  return { estado: 'ok', valor: n };
}

/**
 * Um par (casa, fora) de inteiros não negativos. Os dois vazios = vazio; só um preenchido = inválido
 * (um lado sozinho não é um placar e não é descartado em silêncio).
 */
export function lerParInteiro(casa: string, fora: string): Leitura<ParPlacar> {
  const a = lerInteiroNaoNegativo(casa);
  const b = lerInteiroNaoNegativo(fora);
  if (a.estado === 'vazio' && b.estado === 'vazio') return { estado: 'vazio' };
  if (a.estado === 'invalido') return a;
  if (b.estado === 'invalido') return b;
  if (a.estado === 'vazio' || b.estado === 'vazio')
    return { estado: 'invalido', motivo: 'preencha os dois lados' };
  return { estado: 'ok', valor: { casa: a.valor, fora: b.valor } };
}

/** "1,85" ou "1.85" → 1.85. Finito e MAIOR QUE 1; recusa "1", "0,9", "-2", "abc", "1e3" e "Infinity". */
export function lerOdd(texto: string): Leitura<number> {
  const t = texto.trim();
  if (t === '') return { estado: 'vazio' };
  if (!/^\d+([.,]\d+)?$/.test(t)) return { estado: 'invalido', motivo: `"${t}": não é uma odd` };
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) return { estado: 'invalido', motivo: `"${t}": não é uma odd` };
  if (n <= 1) return { estado: 'invalido', motivo: `"${t}": a odd precisa ser maior que 1` };
  return { estado: 'ok', valor: n };
}

/**
 * Várias odds separadas por espaço ou ponto e vírgula ("3.4 5.2"). Qualquer item inválido invalida o
 * campo inteiro (antes, os inválidos eram descartados em silêncio). Vazio = nenhum outro lado.
 */
export function lerOddsDosOutrosLados(texto: string): Leitura<number[]> {
  const itens = texto.split(/[\s;]+/).filter((x) => x !== '');
  if (!itens.length) return { estado: 'vazio' };
  const valores: number[] = [];
  for (const item of itens) {
    const l = lerOdd(item);
    if (l.estado === 'invalido') return l;
    if (l.estado === 'ok') valores.push(l.valor);
  }
  return { estado: 'ok', valor: valores };
}
