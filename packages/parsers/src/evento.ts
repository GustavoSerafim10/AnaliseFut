/**
 * Identidade estável do evento (o jogo): é ela que decide se duas apostas são "do mesmo jogo" para
 * o teto de exposição por jogo. Nomes diferentes não podem fazer o mesmo jogo virar dois eventos.
 *
 * O evento é: a data + os DOIS times, sem importar a ordem (mandante e visitante trocados são o
 * mesmo jogo) e sem importar acento, caixa, pontuação, "FC/SC/CP..." ou "Milão" × "Milan".
 * A comparação tolerante (`mesmoEvento`) aceita também nome abreviado ("Sporting" =
 * "Sporting Clube de Portugal CP"); na dúvida ela erra para o lado conservador (mesmo jogo).
 */
import { similaridadeTime, tokensDoNome } from './times';

export interface RefEvento {
  casa: string;
  fora: string;
  /** AAAA-MM-DD, no fuso de quem registrou */
  data: string;
}

/** A parte da data de um ISO ("2026-10-26T20:00:00-03:00") ou de uma data pura. */
export const dataDoEvento = (isoOuData: string): string => isoOuData.trim().slice(0, 10);

const SEPARADOR = /\s+[×xX]\s+/;

/** Lê o texto "Casa × Fora" (como as pernas das múltiplas guardam o jogo). null se não for jogo. */
export function eventoDoTexto(jogo: string, inicio: string): RefEvento | null {
  const partes = jogo.split(SEPARADOR);
  if (partes.length !== 2) return null;
  const data = dataDoEvento(inicio);
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? { casa: partes[0], fora: partes[1], data } : null;
}

const chaveDoTime = (nome: string) => tokensDoNome(nome).join('-');

/**
 * Id canônico: "AAAA-MM-DD|time|time" com os times em ordem alfabética. null se faltar nome ou
 * data (um evento sem identificação não pode ser tratado como "o mesmo" que outro).
 */
export function idDoEvento(e: RefEvento): string | null {
  const a = chaveDoTime(e.casa);
  const b = chaveDoTime(e.fora);
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}$/.test(e.data)) return null;
  return `${e.data}|${[a, b].sort().join('|')}`;
}

/** Mesmo jogo: mesmo id canônico, ou mesma data com os dois times reconhecidos como os mesmos. */
export function mesmoEvento(a: RefEvento, b: RefEvento): boolean {
  const ia = idDoEvento(a);
  const ib = idDoEvento(b);
  if (!ia || !ib) return false;
  if (ia === ib) return true;
  if (a.data !== b.data) return false;
  const igual = (x: string, y: string) => similaridadeTime(x, y) >= 1;
  return (
    (igual(a.casa, b.casa) && igual(a.fora, b.fora)) ||
    (igual(a.casa, b.fora) && igual(a.fora, b.casa))
  );
}
