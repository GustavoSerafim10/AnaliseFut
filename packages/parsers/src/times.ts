/**
 * Reconhecimento de times pelo nome do jogo cadastrado, tolerante a nomes longos
 * ("Sporting Clube de Portugal CP" = Sporting).
 */
import type { NomesTimes, Time } from '@pe/engine';
import { semAcento } from './texto';

const PALAVRAS_VAZIAS = new Set([
  'fc',
  'cf',
  'sc',
  'cp',
  'ac',
  'as',
  'ss',
  'sl',
  'fk',
  'sk',
  'afc',
  'cd',
  'ud',
  'rc',
  'club',
  'clube',
  'de',
  'da',
  'do',
  'del',
  'la',
  'le',
  'the',
  'total',
]);

/** A 1win aportuguesa o nome ("Milão"), e o cadastro do jogo costuma vir como no SofaScore. */
const NOME_APORTUGUESADO: Record<string, string> = {
  milao: 'milan',
  napoles: 'napoli',
  sevilha: 'sevilla',
  genova: 'genoa',
};

export function tokensDoNome(nome: string): string[] {
  return semAcento(nome)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !PALAVRAS_VAZIAS.has(t))
    .map((t) => NOME_APORTUGUESADO[t] ?? t);
}

function tokenBate(a: string, b: string): boolean {
  if (a === b) return true;
  // prefixo para abreviações/OCR cortado ("Brugg" ~ "Brugge"), só com 4+ letras
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/** 0–1: fração dos tokens do nome mais curto encontrados no outro. */
export function similaridadeTime(a: string, b: string): number {
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  if (!ta.length || !tb.length) return 0;
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const achados = curto.filter((t) => longo.some((u) => tokenBate(t, u))).length;
  return achados / curto.length;
}

export function reconhecerTime(texto: string, jogo: NomesTimes): Time | null {
  const sc = similaridadeTime(texto, jogo.casa);
  const sf = similaridadeTime(texto, jogo.fora);
  if (Math.max(sc, sf) < 0.5 || sc === sf) return null;
  return sc > sf ? 'casa' : 'fora';
}
