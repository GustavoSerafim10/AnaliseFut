/**
 * Competição e temporada da AMOSTRA de estatísticas, lidas do cabeçalho do print (só para
 * exibição: nada daqui entra no λ nem na DQ).
 *
 * SofaScore (comparação de equipes): entre "Adicionar outra equipe" e "Geral" há uma linha com o
 * seletor de cada time — "Campeonato Brasileiro Série A v 2026 v Campeonato Brasileiro Série A v
 * 2026". Esquerda = mandante, direita = visitante (regra dos prints do usuário).
 * SuperScore: logo abaixo de um título de seção em caixa alta ("ESTATÍSTICAS PRINCIPAIS",
 * "FINALIZAÇÕES"...) vem "Brasileiro Série A 2026" ou "Série A 26/27"; vale para os dois times.
 *
 * Nada é adivinhado: sem âncora ou sem texto legível, a lista sai vazia. Temporada só é
 * "reconstruída" quando o OCR comeu a barra de um par consecutivo (2627 → 2026/27).
 * "Todas as competições" é marcado explicitamente (amostra mista, nunca competição única).
 */
import { semAcento } from './texto';

export type FonteContexto = 'sofascore' | 'superscore';

export interface LeituraContexto {
  fonte: FonteContexto;
  lado: 'casa' | 'fora' | 'ambos';
  /** texto limpo da competição; null quando só a temporada foi lida */
  competicao: string | null;
  /** chave para comparar grafias ("Brasileiro-SérieA" = "Campeonato Brasileiro Série A") */
  chaveCompeticao: string | null;
  /** filtro "Todas as competições": a amostra mistura competições */
  todasCompeticoes: boolean;
  /** "2026" ou "2026/27"; null quando ilegível */
  temporada: string | null;
  confianca: 'lida' | 'reconstruida' | 'parcial';
  /** a linha original do OCR, para conferência */
  trecho: string;
}

const norm = (s: string) => semAcento(s).toLowerCase();

const TODAS =
  /todas?\s+as\s+competic|todos\s+os\s+(torneios|campeonatos)|all\s+(competitions|tournaments)/;

/** Chave de comparação: sem acento, caixa, pontuação, espaços e a palavra "campeonato". */
export function chaveDeCompeticao(s: string): string {
  return norm(s)
    .replace(/\bcampeonato\b/g, '')
    .replace(/\bbrasileirao\b/g, 'brasileiro')
    .replace(/[^a-z0-9]/g, '');
}

/** Temporada normalizada; null quando o texto não é uma temporada legível. */
export function lerTemporada(t: string): { temporada: string; reconstruida: boolean } | null {
  const s = t.replace(/\s+/g, '');
  let m = s.match(/^(20\d\d)$/);
  if (m) return { temporada: m[1], reconstruida: false };
  m = s.match(/^(20\d\d)[/-](\d\d)$/) ?? s.match(/^(20\d\d)[/-]20(\d\d)$/);
  if (m) {
    const a = Number(m[1].slice(2));
    return Number(m[2]) === a + 1 ? { temporada: `${m[1]}/${m[2]}`, reconstruida: false } : null;
  }
  m = s.match(/^(\d\d)[/-](\d\d)$/);
  if (m)
    return Number(m[2]) === Number(m[1]) + 1
      ? { temporada: `20${m[1]}/${m[2]}`, reconstruida: false }
      : null;
  // o OCR comeu a barra: só um par CONSECUTIVO vira temporada (2627 → 2026/27)
  m = s.match(/^(\d\d)(\d\d)$/);
  if (m && Number(m[2]) === Number(m[1]) + 1)
    return { temporada: `20${m[1]}/${m[2]}`, reconstruida: true };
  return null;
}

/** Tira o lixo do OCR no começo ("3}", "\", "O", "A" do ícone da bandeira) e o "v" final. */
function limparCompeticao(s: string): string {
  const t = s.trim().split(/\s+/);
  // lixo do ícone/bandeira: só símbolos, 1 letra, ou 2 MAIÚSCULAS ("ED") — "La Liga" fica
  while (t.length > 1 && /^(?:[^\p{L}]+|\p{L}[^\p{L}]?|\p{Lu}{2}[^\p{L}]?)$/u.test(t[0])) t.shift();
  return t
    .join(' ')
    .replace(/\s+[vV∨]$/, '')
    .trim();
}

const ehTemporadaOuLixo = (s: string) => /^[\d%/\-\s]{2,9}$/.test(s.trim());

function lerSofascore(linhas: string[]): LeituraContexto[] {
  const ini = linhas.findIndex((l) => /adicionar outra equipe/i.test(norm(l)));
  if (ini < 0) return [];
  const fim = linhas.findIndex((l, i) => i > ini && /^geral\b/i.test(norm(l).trim()));
  const bloco = linhas.slice(ini + 1, fim < 0 ? ini + 6 : fim);
  for (const linha of bloco) {
    const partes = linha
      .split(/\s+[vV∨\\]\s+|\s+[vV∨\\]$/)
      .map((p) => p.trim())
      .filter(Boolean);
    // a linha do seletor TEM o "v": sem ele é a linha dos nomes dos times, do país ou lixo
    if (partes.length < 2) continue;
    const comps: {
      competicao: string;
      temporada: string | null;
      reconstruida: boolean;
      bruta: boolean;
    }[] = [];
    for (const p of partes) {
      if (ehTemporadaOuLixo(p)) {
        const ult = comps.at(-1);
        if (ult && ult.temporada === null && !ult.bruta) {
          const t = lerTemporada(p);
          ult.temporada = t?.temporada ?? null;
          ult.reconstruida = !!t?.reconstruida;
          ult.bruta = true; // já houve tentativa (mesmo ilegível)
        }
        continue;
      }
      const c = limparCompeticao(p);
      if (/\p{L}{3,}/u.test(c))
        comps.push({ competicao: c, temporada: null, reconstruida: false, bruta: false });
    }
    if (!comps.length) continue;
    return comps.slice(0, 2).map((c, i) => {
      const todas = TODAS.test(norm(c.competicao));
      return {
        fonte: 'sofascore' as const,
        lado: i === 0 ? ('casa' as const) : ('fora' as const),
        competicao: c.competicao,
        chaveCompeticao: todas ? null : chaveDeCompeticao(c.competicao),
        todasCompeticoes: todas,
        temporada: c.temporada,
        confianca: c.temporada === null ? 'parcial' : c.reconstruida ? 'reconstruida' : 'lida',
        trecho: linha.trim(),
      };
    });
  }
  return [];
}

function lerSuperscore(linhas: string[]): LeituraContexto[] {
  for (let i = 1; i < linhas.length; i++) {
    const anterior = linhas[i - 1].trim();
    // título de seção: só letras maiúsculas (com acento) e espaços
    if (!/^[A-ZÀ-Ý ]{6,}$/.test(anterior)) continue;
    const linha = linhas[i].trim();
    const todas = TODAS.test(norm(linha));
    const m = linha.match(/^(\p{L}[\p{L}\s.\-']*?)\s+((?:20)?\d\d(?:[/-](?:20)?\d\d)?)$/u);
    if (!m && !todas) continue;
    const t = m ? lerTemporada(m[2]) : null;
    const competicao = m ? m[1].trim() : linha;
    return [
      {
        fonte: 'superscore',
        lado: 'ambos',
        competicao,
        chaveCompeticao: todas ? null : chaveDeCompeticao(competicao),
        todasCompeticoes: todas,
        temporada: t?.temporada ?? null,
        confianca: !t ? 'parcial' : t.reconstruida ? 'reconstruida' : 'lida',
        trecho: linha,
      },
    ];
  }
  return [];
}

/** Leituras de competição/temporada de um print; vazia = cabeçalho ilegível ou ausente. */
export function lerContextoAmostra(texto: string, fonte: FonteContexto): LeituraContexto[] {
  const linhas = texto.split(/\r?\n/);
  return fonte === 'sofascore' ? lerSofascore(linhas) : lerSuperscore(linhas);
}
