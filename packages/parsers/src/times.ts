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

/** Uma letra trocada, sobrando ou faltando ("Valarenga" ~ "Valerenga"). */
function umaLetraDeDiferenca(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length < b.length ? a.slice(i) === b.slice(i + 1) : a.slice(i + 1) === b.slice(i);
}

function tokenBate(a: string, b: string, tolerante = false): boolean {
  if (a === b) return true;
  if (tolerante && a.length >= 6 && b.length >= 6 && umaLetraDeDiferenca(a, b)) return true;
  // prefixo para abreviações/OCR cortado ("Brugg" ~ "Brugge"), só com 4+ letras
  return a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a));
}

/** 0–1: fração dos tokens do nome mais curto encontrados no outro. */
export function similaridadeTime(a: string, b: string, tolerante = false): number {
  const ta = tokensDoNome(a);
  const tb = tokensDoNome(b);
  if (!ta.length || !tb.length) return 0;
  const [curto, longo] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const achados = curto.filter((t) => longo.some((u) => tokenBate(t, u, tolerante))).length;
  return achados / curto.length;
}

/**
 * Com , aceita uma letra errada no nome digitado, só se a comparação exata não achar
 * nenhum dos dois. Só para os prints do próprio jogo: numa tabela, Athletico viraria Atlético.
 */
export function reconhecerTime(texto: string, jogo: NomesTimes, tolerante = false): Time | null {
  const qual = (tol: boolean): Time | null => {
    const sc = similaridadeTime(texto, jogo.casa, tol);
    const sf = similaridadeTime(texto, jogo.fora, tol);
    if (Math.max(sc, sf) < 0.5 || sc === sf) return null;
    return sc > sf ? 'casa' : 'fora';
  };
  return qual(false) ?? (tolerante ? qual(true) : null);
}
