/**
 * Leitura da decisão para a tela (só exibição: nada aqui muda o cálculo do motor).
 *
 * 1. EV só pelo mercado: no R3 o P_true mistura modelo e mercado (w × P_modelo + (1 − w) ×
 *    P_mercado). Mostrar o EV com w = 0 deixa visível quanto do EV vem só da opinião do modelo.
 *    É a mesma conta do motor (emRisco × (P × odd efetiva − 1)), com o P do mercado.
 * 2. Liga principal sem a caixinha: o R3 em mercado principal só vale fora de liga principal
 *    (lição 3). Se a competição parece grande e "Liga bem coberta" está desmarcada, o motor pode
 *    precificar 1X2/gols com o modelo e uma casa só — o aviso pede para conferir a caixinha.
 */
import type { AvaliacaoV4 } from '@pe/engine';

/** EV do mesmo preço contra o mercado sem margem, sem o modelo. null quando o modelo não entrou. */
export function evSoMercado(
  a: Pick<AvaliacaoV4, 'nivel' | 'wModelo' | 'pConsenso' | 'oddEfetiva' | 'emRisco'>,
): number | null {
  if (a.nivel !== 'R3' || !a.wModelo) return null;
  return a.emRisco * (a.pConsenso * a.oddEfetiva - 1);
}

const normal = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** divisões de acesso e copas menores: nunca contam como principal */
const SEGUNDA_LINHA =
  /\b(serie [b-d]|2\.? bundesliga|segunda|championship|league (one|two)|ligue 2|la liga 2|laliga 2|sub-?\d+|u\d{2}|feminin|women|amistos)/;
/** top 5 europeias, Brasileirão, Champions, Libertadores e grandes seleções */
const PRINCIPAL =
  /\b(champions|libertadores|europa league|conference league|premier league|la ?liga|bundesliga|serie a|ligue 1|brasileir|copa do mundo|world cup|eurocopa|euro 20\d\d|copa america|copa do brasil|sul-?americana)/;

export function pareceLigaPrincipal(competicao: string | undefined | null): boolean {
  if (!competicao) return false;
  const c = normal(competicao);
  return !SEGUNDA_LINHA.test(c) && PRINCIPAL.test(c);
}

export function avisoLigaPrincipal(
  competicao: string | undefined | null,
  ligaTop: boolean | undefined,
): string | null {
  if (ligaTop || !pareceLigaPrincipal(competicao)) return null;
  return `"${competicao}" parece liga principal, mas "Liga bem coberta" está desmarcada: sem ela o motor pode precificar 1X2 e gols só com o modelo e poucas casas (R3). Marque a caixinha no Contexto da aba Partida.`;
}

/**
 * P2: o aviso usa a competição cadastrada do jogo; vazia, usa a lida nos prints de estatística
 * (nunca "Todas as competições"), dizendo de onde veio. Só exibição.
 */
export function avisoLigaDoJogo(
  competicaoJogo: string | undefined | null,
  competicaoAmostra: string | null | undefined,
  ligaTop: boolean | undefined,
): string | null {
  if (competicaoJogo?.trim()) return avisoLigaPrincipal(competicaoJogo, ligaTop);
  if (!competicaoAmostra) return null;
  const a = avisoLigaPrincipal(competicaoAmostra, ligaTop);
  return (
    a && `${a} (competição lida nos prints de estatística: o jogo está sem competição cadastrada)`
  );
}
