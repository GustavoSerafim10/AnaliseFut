/**
 * Competição e temporada da amostra de estatísticas, para a TELA e o PROMPT (Parte A).
 * Não entra no λ, na DQ nem na evidência (P4: relível depois a partir do OCR gravado).
 *
 * item3d responde o checklist "a amostra mistura temporadas e competições?":
 *  - SIM: "Todas as competições", lados diferentes, SofaScore × SuperScore diferentes, mais de
 *    uma temporada, temporada anterior ou competição diferente da cadastrada no jogo
 *  - NÃO: tudo lido, para os dois times, e coerente
 *  - DADO INDISPONÍVEL: cabeçalho ilegível ou só parte lida (nada é presumido)
 */
import { lerContextoAmostra, type LeituraContexto } from '@pe/parsers';
import type { Rascunho } from './estado';

export interface ContextoAmostra {
  leituras: LeituraContexto[];
  legivel: boolean;
  /** competições distintas lidas (texto do primeiro print de cada uma) */
  competicoes: string[];
  temporadas: string[];
  todas: boolean;
  mista: boolean;
  fontesDivergem: boolean;
  /** null quando o jogo não tem competição cadastrada */
  coincideComJogo: boolean | null;
  temporadaRelativa: 'atual' | 'anterior' | 'indeterminada';
  item3d: 'SIM' | 'NÃO' | 'DADO INDISPONÍVEL';
  motivos: string[];
  /** a competição única lida (nunca "Todas as competições"); usada no aviso de liga (P2) */
  competicaoPrincipal: string | null;
}

/** P3: "atual"/"anterior" só quando a data do jogo não deixa dúvida. */
export function temporadaRelativa(
  temporada: string,
  dataJogo: string,
): ContextoAmostra['temporadaRelativa'] {
  const m = dataJogo.match(/^(\d{4})-(\d{2})/);
  if (!m) return 'indeterminada';
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const unico = temporada.match(/^(\d{4})$/);
  if (unico) {
    const t = Number(unico[1]);
    return t === ano ? 'atual' : t < ano ? 'anterior' : 'indeterminada';
  }
  const dividida = temporada.match(/^(\d{4})\/(\d{2})$/);
  if (!dividida) return 'indeterminada';
  const inicio = Number(dividida[1]);
  // temporada europeia: agosto do 1º ano a maio do 2º; junho e julho são ambíguos
  if ((ano === inicio && mes >= 8) || (ano === inicio + 1 && mes <= 5)) return 'atual';
  if (ano > inicio + 1 || (ano === inicio + 1 && mes >= 8)) return 'anterior';
  return 'indeterminada';
}

const chaveLivre = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\bcampeonato\b/g, '')
    .replace(/\bbrasileirao\b/g, 'brasileiro')
    .replace(/[^a-z0-9]/g, '');

export function resumirContextoAmostra(
  leituras: LeituraContexto[],
  jogo: { competicao?: string; data?: string },
): ContextoAmostra {
  const motivos: string[] = [];
  const comCompeticao = leituras.filter((l) => l.competicao || l.todasCompeticoes);
  const legivel = comCompeticao.length > 0;
  const todas = leituras.some((l) => l.todasCompeticoes);
  if (todas) motivos.push('filtro "Todas as competições" no print: a amostra mistura competições');

  const chaves = new Map<string, string>();
  for (const l of leituras)
    if (l.chaveCompeticao && !chaves.has(l.chaveCompeticao) && l.competicao)
      chaves.set(l.chaveCompeticao, l.competicao);
  const temporadas = [...new Set(leituras.map((l) => l.temporada).filter((t): t is string => !!t))];

  const sofa = leituras.filter((l) => l.fonte === 'sofascore');
  const casa = sofa.find((l) => l.lado === 'casa');
  const fora = sofa.find((l) => l.lado === 'fora');
  const ladosDiferentes =
    !!casa?.chaveCompeticao &&
    !!fora?.chaveCompeticao &&
    casa.chaveCompeticao !== fora.chaveCompeticao;
  if (ladosDiferentes)
    motivos.push(`mandante em "${casa!.competicao}" e visitante em "${fora!.competicao}"`);
  const variasTemporadas = temporadas.length > 1;
  if (variasTemporadas) motivos.push(`mais de uma temporada nos prints: ${temporadas.join(', ')}`);
  const mista = todas || ladosDiferentes || variasTemporadas;

  const chavesSofa = new Set(sofa.map((l) => l.chaveCompeticao).filter(Boolean));
  const chavesSup = new Set(
    leituras
      .filter((l) => l.fonte === 'superscore')
      .map((l) => l.chaveCompeticao)
      .filter(Boolean),
  );
  const fontesDivergem =
    chavesSofa.size > 0 && chavesSup.size > 0 && ![...chavesSup].some((k) => chavesSofa.has(k));
  if (fontesDivergem) motivos.push('SofaScore e SuperScore mostram competições diferentes');

  let coincideComJogo: boolean | null = null;
  const cad = jogo.competicao?.trim() ? chaveLivre(jogo.competicao) : '';
  if (cad && chaves.size) {
    coincideComJogo = [...chaves.keys()].every((k) => k.includes(cad) || cad.includes(k));
    if (!coincideComJogo)
      motivos.push(`competição da amostra diferente da cadastrada no jogo ("${jogo.competicao}")`);
  }

  const rel =
    temporadas.length === 1 && jogo.data
      ? temporadaRelativa(temporadas[0], jogo.data)
      : 'indeterminada';
  if (rel === 'anterior') motivos.push(`temporada ${temporadas[0]} anterior à data do jogo`);

  // os dois times cobertos: SuperScore vale para ambos; no SofaScore, os dois lados lidos
  const doisTimes =
    leituras.some((l) => l.lado === 'ambos' && l.competicao) ||
    (!!casa?.competicao && !!fora?.competicao);
  const temTemporada = temporadas.length > 0;
  const item3d: ContextoAmostra['item3d'] = !legivel
    ? 'DADO INDISPONÍVEL'
    : mista || fontesDivergem || rel === 'anterior' || coincideComJogo === false
      ? 'SIM'
      : doisTimes && temTemporada
        ? 'NÃO'
        : 'DADO INDISPONÍVEL';
  if (item3d === 'DADO INDISPONÍVEL' && legivel)
    motivos.push('leitura parcial do cabeçalho (falta um dos times ou a temporada)');

  return {
    leituras,
    legivel,
    competicoes: [...chaves.values()],
    temporadas,
    todas,
    mista,
    fontesDivergem,
    coincideComJogo,
    temporadaRelativa: rel,
    item3d,
    motivos,
    competicaoPrincipal: !todas && chaves.size === 1 ? [...chaves.values()][0] : null,
  };
}

/** Leituras dos prints de estatística do rascunho (o texto principal de cada print). */
export function contextoDoRascunho(r: Rascunho): ContextoAmostra {
  const ler = (fonte: 'sofascore' | 'superscore') =>
    (r.prints[fonte] ?? []).flatMap((p) => lerContextoAmostra(p.texto, fonte));
  return resumirContextoAmostra([...ler('sofascore'), ...ler('superscore')], r.jogo);
}

/** Uma linha legível: "Brasileiro Série A · 2026 · temporada atual". */
export function descreverContexto(c: ContextoAmostra): string | null {
  if (!c.legivel) return null;
  const comp = c.todas ? 'Todas as competições' : c.competicoes.join(' / ');
  const temp = c.temporadas.length ? ` · ${c.temporadas.join(' / ')}` : ' · temporada não lida';
  const rel =
    c.temporadaRelativa === 'atual'
      ? ' · temporada atual'
      : c.temporadaRelativa === 'anterior'
        ? ' · temporada ANTERIOR'
        : '';
  return `${comp}${temp}${rel}`;
}
