/**
 * Leitor de estatísticas de time (SofaScore "comparar equipes" e SuperScore "estatísticas de
 * equipe – Média"). Lê TODAS as linhas "rótulo + 2 valores"; as conhecidas viram campos do
 * modelo, as demais ficam em `outros`. Nunca inventa: valor ilegível fica vazio e é sinalizado.
 */
import type { NomesTimes } from '@pe/engine';
import { semAcento } from './texto';
import { similaridadeTime, tokensDoNome } from './times';

export type FonteStats = 'sofascore' | 'superscore';
type Formato = 'inteiro' | 'decimal1' | 'decimal2' | 'percentual';

export type CampoStat =
  | 'partidas'
  | 'golsMarcados'
  | 'golsSofridos'
  | 'golsPorJogo'
  | 'golsSofridosPorJogo'
  | 'xg'
  | 'xgot'
  | 'finalizacoes'
  | 'chutesNoAlvo'
  | 'chutesFora'
  | 'chutesBloqueados'
  | 'finalizacoesDentroArea'
  | 'finalizacoesForaArea'
  | 'grandesChances'
  | 'grandesChancesMarcadas'
  | 'grandesChancesPerdidas'
  | 'escanteios'
  | 'impedimentos'
  | 'faltas'
  | 'faltasSofridas'
  | 'cartoesAmarelos'
  | 'cartoesVermelhos'
  | 'posse'
  | 'jogosSemSofrer'
  | 'defesasGoleiro'
  | 'golsEvitados'
  | 'nota'
  | 'assistencias'
  | 'ataques'
  | 'ataquesPerigosos'
  | 'toquesAreaAdversaria'
  | 'interceptacoes'
  | 'desarmes'
  | 'penaltisConcedidos';

interface DefCampo {
  campo: CampoStat;
  rotulo: string;
  re: RegExp;
  formato: Formato;
  faixa: [number, number];
}

/** Ordem importa: padrões mais específicos primeiro. */
export const CAMPOS_STATS: DefCampo[] = [
  { campo: 'nota', rotulo: 'Nota SofaScore', re: /nota/, formato: 'decimal2', faixa: [5, 9] },
  { campo: 'partidas', rotulo: 'Partidas', re: /^partidas\b/, formato: 'inteiro', faixa: [1, 70] },
  {
    campo: 'golsSofridosPorJogo',
    rotulo: 'Gols sofridos por jogo',
    re: /gols sofridos por/,
    formato: 'decimal1',
    faixa: [0, 5],
  },
  {
    campo: 'golsMarcados',
    rotulo: 'Gols marcados (total)',
    re: /gols marcados/,
    formato: 'inteiro',
    faixa: [0, 200],
  },
  {
    campo: 'golsSofridos',
    rotulo: 'Gols sofridos (total)',
    re: /gols sofridos/,
    formato: 'inteiro',
    faixa: [0, 200],
  },
  {
    campo: 'golsPorJogo',
    rotulo: 'Gols por jogo',
    re: /gols por partida|^gols$|^gols\b(?! (esperados|evitados|de))/,
    formato: 'decimal1',
    faixa: [0, 5],
  },
  { campo: 'xgot', rotulo: 'xGOT', re: /xgot|xcot/, formato: 'decimal1', faixa: [0, 5] },
  {
    campo: 'xg',
    rotulo: 'xG (gols esperados)',
    re: /gols esperados|\bxg\b/,
    formato: 'decimal1',
    faixa: [0, 5],
  },
  {
    campo: 'golsEvitados',
    rotulo: 'Gols evitados',
    re: /gols evitados/,
    formato: 'decimal1',
    faixa: [-3, 3],
  },
  {
    campo: 'penaltisConcedidos',
    rotulo: 'Gols de pênalti concedidos',
    re: /penalti/,
    formato: 'inteiro',
    faixa: [0, 30],
  },
  {
    campo: 'jogosSemSofrer',
    rotulo: 'Jogos sem sofrer gols',
    re: /sem sofrer/,
    formato: 'inteiro',
    faixa: [0, 70],
  },
  {
    campo: 'finalizacoesDentroArea',
    rotulo: 'Finalizações dentro da área',
    re: /dentro da area/,
    formato: 'decimal1',
    faixa: [0, 30],
  },
  {
    campo: 'finalizacoesForaArea',
    rotulo: 'Finalizações fora da área',
    re: /fora da area/,
    formato: 'decimal1',
    faixa: [0, 30],
  },
  {
    campo: 'finalizacoes',
    rotulo: 'Finalizações totais',
    re: /finaliza\w* totais/,
    formato: 'decimal1',
    faixa: [2, 40],
  },
  {
    campo: 'chutesFora',
    rotulo: 'Chutes fora do gol',
    re: /chutes fora/,
    formato: 'decimal1',
    faixa: [0, 25],
  },
  {
    campo: 'chutesBloqueados',
    rotulo: 'Chutes bloqueados',
    re: /chutes bloqueados/,
    formato: 'decimal1',
    faixa: [0, 15],
  },
  {
    campo: 'chutesNoAlvo',
    rotulo: 'Chutes no alvo por jogo',
    re: /chutes certos|chutes ?no gol/,
    formato: 'decimal1',
    faixa: [0, 15],
  },
  {
    campo: 'grandesChancesMarcadas',
    rotulo: 'Grandes chances marcadas',
    re: /chances marcadas/,
    formato: 'decimal1',
    faixa: [0, 6],
  },
  {
    campo: 'grandesChancesPerdidas',
    rotulo: 'Grandes chances perdidas',
    re: /chances perdidas/,
    formato: 'decimal1',
    faixa: [0, 6],
  },
  {
    campo: 'grandesChances',
    rotulo: 'Grandes chances criadas',
    re: /chances criadas|chances de go/,
    formato: 'decimal1',
    faixa: [0, 8],
  },
  {
    campo: 'escanteios',
    rotulo: 'Escanteios',
    re: /escanteios/,
    formato: 'decimal1',
    faixa: [0, 15],
  },
  {
    campo: 'impedimentos',
    rotulo: 'Impedimentos',
    re: /impediment/,
    formato: 'decimal1',
    faixa: [0, 6],
  },
  {
    campo: 'faltasSofridas',
    rotulo: 'Faltas sofridas',
    re: /faltas cobradas|faltas sofridas/,
    formato: 'decimal1',
    faixa: [3, 30],
  },
  {
    campo: 'faltas',
    rotulo: 'Faltas cometidas',
    re: /faltas/,
    formato: 'decimal1',
    faixa: [3, 30],
  },
  {
    campo: 'cartoesVermelhos',
    rotulo: 'Cartões vermelhos (total)',
    re: /cartoes vermelhos/,
    formato: 'inteiro',
    faixa: [0, 30],
  },
  {
    campo: 'cartoesAmarelos',
    rotulo: 'Cartões amarelos por jogo',
    re: /cartoes amarelos/,
    formato: 'decimal1',
    faixa: [0, 6],
  },
  {
    campo: 'posse',
    rotulo: 'Posse de bola (%)',
    re: /posse de bola/,
    formato: 'percentual',
    faixa: [20, 80],
  },
  {
    campo: 'defesasGoleiro',
    rotulo: 'Defesas do goleiro por jogo',
    re: /defesas/,
    formato: 'decimal1',
    faixa: [0, 10],
  },
  {
    campo: 'assistencias',
    rotulo: 'Assistências (total)',
    re: /assist/,
    formato: 'inteiro',
    faixa: [0, 150],
  },
  {
    campo: 'ataquesPerigosos',
    rotulo: 'Ataques perigosos',
    re: /ataques perigosos/,
    formato: 'decimal1',
    faixa: [5, 120],
  },
  { campo: 'ataques', rotulo: 'Ataques', re: /^ataques$/, formato: 'decimal1', faixa: [30, 200] },
  {
    campo: 'toquesAreaAdversaria',
    rotulo: 'Toques na área adversária',
    re: /toques na area/,
    formato: 'decimal1',
    faixa: [3, 60],
  },
  {
    campo: 'interceptacoes',
    rotulo: 'Interceptações',
    re: /intercep/,
    formato: 'decimal1',
    faixa: [0, 25],
  },
  {
    campo: 'desarmes',
    rotulo: 'Desarmes por jogo',
    re: /desarmes por jogo/,
    formato: 'decimal1',
    faixa: [0, 40],
  },
];

export const DEF_CAMPO: Record<CampoStat, DefCampo> = Object.fromEntries(
  CAMPOS_STATS.map((d) => [d.campo, d]),
) as Record<CampoStat, DefCampo>;

export interface ValorLido {
  casa?: number;
  fora?: number;
  /** linha do OCR de onde veio */
  bruto: string;
  avisos: string[];
}

export interface LeituraStats {
  fonte: FonteStats;
  campos: Partial<Record<CampoStat, ValorLido>>;
  outros: { rotulo: string; casa?: number; fora?: number; bruto: string }[];
  /** true quando o print tinha o visitante na coluna da esquerda */
  colunasInvertidas: boolean;
  avisos: string[];
}

/** Erros típicos do OCR nesses sites. */
function corrigirRotulo(t: string): string {
  return t
    .replace(/\bgo[il1]s\b|\bgots\b/g, 'gols')
    .replace(/assisten/g, 'assisten')
    .replace(/interceptac\w*/g, 'interceptacoes')
    .replace(/\bduetos\b/g, 'duelos')
    .replace(/finalizag/g, 'finalizac');
}

interface TokenNum {
  valor: number;
  temPonto: boolean;
  pos: number;
}

/** Separa números e palavras. "17.3(59.9%)" → 17.3; "[158" → 158; "W6.97" → 6.97. */
function tokenizar(linha: string): { nums: TokenNum[]; palavras: { txt: string; pos: number }[] } {
  const limpa = linha.replace(/\(\s*[\d.,]+\s*%\s*\)/g, ' ');
  const nums: TokenNum[] = [];
  const palavras: { txt: string; pos: number }[] = [];
  limpa
    .split(/\s+/)
    .filter(Boolean)
    .forEach((tok, pos) => {
      const t = tok.replace(/^[[(|~«»“”"']+|[\])|.,;:'"»”]+$/g, '');
      const m = /^[A-Za-z]?(-?\d{1,4}(?:[.,]\d{1,2})?)(%)?$/.exec(t);
      if (m && !/^\d{1,2}:\d{2}$/.test(tok)) {
        nums.push({ valor: Number(m[1].replace(',', '.')), temPonto: /[.,]/.test(m[1]), pos });
      } else if (/[a-zà-ú]{2,}/i.test(t)) {
        palavras.push({ txt: t, pos });
      }
    });
  return { nums, palavras };
}

/** Rótulo = a maior sequência contínua de palavras da linha (o resto é lixo do OCR). */
function rotuloPrincipal(palavras: { txt: string; pos: number }[]): {
  txt: string;
  ini: number;
  fim: number;
} {
  const grupos: { txt: string; pos: number }[][] = [];
  for (const p of palavras) {
    const g = grupos[grupos.length - 1];
    if (g && p.pos === g[g.length - 1].pos + 1) g.push(p);
    else grupos.push([p]);
  }
  const tamanho = (g: { txt: string }[]) => g.reduce((s, p) => s + p.txt.length, 0);
  const melhor = grupos.reduce((a, b) => (tamanho(b) > tamanho(a) ? b : a));
  return {
    txt: melhor.map((p) => p.txt).join(' '),
    ini: melhor[0].pos,
    fim: melhor[melhor.length - 1].pos,
  };
}

/** Sites mostram médias com 1 casa decimal: "20" lido sem ponto = 2.0; "248" = 24.8. */
function interpretar(tok: TokenNum, def: DefCampo): { valor: number; corrigido: boolean } {
  if (def.formato === 'decimal1' && !tok.temPonto)
    return { valor: tok.valor / 10, corrigido: true };
  if (def.formato === 'decimal2' && !tok.temPonto)
    return { valor: tok.valor / 100, corrigido: true };
  return { valor: tok.valor, corrigido: false };
}

function acharCampo(rotulo: string): DefCampo | undefined {
  return CAMPOS_STATS.find((d) => d.re.test(rotulo));
}

function detectarInversao(linhas: string[], jogo: NomesTimes): boolean {
  for (const l of linhas) {
    const t = semAcento(l);
    const ic = posicaoDoTime(t, jogo.casa);
    const iff = posicaoDoTime(t, jogo.fora);
    if (ic >= 0 && iff >= 0 && ic !== iff) return iff < ic;
  }
  return false;
}

/** Índice da primeira palavra da linha que é uma palavra marcante do nome do time (4+ letras). */
function posicaoDoTime(texto: string, nome: string): number {
  const marcas = tokensDoNome(nome).filter((t) => t.length >= 4);
  const palavras = texto.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/);
  return palavras.findIndex((p) => marcas.some((m) => similaridadeTime(p, m) === 1));
}

export function lerEstatisticas(texto: string, fonte: FonteStats, jogo: NomesTimes): LeituraStats {
  const linhas = texto
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const colunasInvertidas = detectarInversao(linhas, jogo);
  const campos: LeituraStats['campos'] = {};
  const outros: LeituraStats['outros'] = [];
  const avisos: string[] = [];
  if (colunasInvertidas)
    avisos.push(`${jogo.fora} aparece na coluna da esquerda: colunas trocadas automaticamente`);

  for (const bruto of linhas) {
    const { nums, palavras } = tokenizar(bruto);
    if (!palavras.length || !nums.length) continue;
    const rot = rotuloPrincipal(palavras);
    const rotulo = corrigirRotulo(semAcento(rot.txt));
    const def = acharCampo(rotulo);
    // posição dos números em relação ao rótulo define a coluna
    const antes = nums.filter((n) => n.pos < rot.ini);
    const depois = nums.filter((n) => n.pos > rot.fim);
    let esq: TokenNum | undefined;
    let dir: TokenNum | undefined;
    let avisoPosicao: string | undefined;
    if (fonte === 'superscore') {
      esq = antes[antes.length - 1];
      dir = depois[0];
    } else if (depois.length >= 2) {
      [esq, dir] = depois;
    } else if (depois.length === 1) {
      // o valor ilegível virou "palavra" (ex.: 42 → "yp"): a posição dela diz qual coluna sumiu
      const lixo = palavras.filter((p) => p.pos > rot.fim);
      if (lixo.some((p) => p.pos > depois[0].pos)) esq = depois[0];
      else if (lixo.some((p) => p.pos < depois[0].pos)) dir = depois[0];
      if (esq || dir)
        avisoPosicao = `um dos valores ficou ilegível; ${depois[0].valor} atribuído à coluna da ${esq ? 'esquerda' : 'direita'} pela posição: conferir`;
      else avisos.push(`"${bruto}": só um valor legível, não dá para saber de qual time`);
    }
    if (!esq && !dir) continue;

    if (!def) {
      outros.push({ rotulo: rot.txt, casa: esq?.valor, fora: dir?.valor, bruto });
      continue;
    }
    if (campos[def.campo]?.casa !== undefined && campos[def.campo]?.fora !== undefined) continue; // repetido entre prints

    const v: ValorLido = { bruto, avisos: avisoPosicao ? [avisoPosicao] : [] };
    const aplicar = (tok: TokenNum | undefined): number | undefined => {
      if (!tok) return undefined;
      const { valor, corrigido } = interpretar(tok, def);
      if (corrigido) v.avisos.push(`ponto decimal perdido no OCR: ${tok.valor} lido como ${valor}`);
      if (valor < def.faixa[0] || valor > def.faixa[1]) {
        v.avisos.push(
          `${valor} fora da faixa plausível (${def.faixa[0]}–${def.faixa[1]}): conferir`,
        );
      }
      return valor;
    };
    const ve = aplicar(esq);
    const vd = aplicar(dir);
    v.casa = colunasInvertidas ? vd : ve;
    v.fora = colunasInvertidas ? ve : vd;
    const anterior = campos[def.campo];
    campos[def.campo] = {
      ...v,
      casa: v.casa ?? anterior?.casa,
      fora: v.fora ?? anterior?.fora,
    };
  }
  return { fonte, campos, outros, colunasInvertidas, avisos };
}

/** Junta a leitura de vários prints do mesmo site (rolagem com sobreposição). */
export function juntarLeiturasStats(leituras: LeituraStats[]): LeituraStats | null {
  if (!leituras.length) return null;
  const base: LeituraStats = {
    fonte: leituras[0].fonte,
    campos: {},
    outros: [],
    colunasInvertidas: leituras.some((l) => l.colunasInvertidas),
    avisos: [],
  };
  for (const l of leituras) {
    for (const [c, v] of Object.entries(l.campos) as [CampoStat, ValorLido][]) {
      const a = base.campos[c];
      base.campos[c] = a
        ? {
            ...a,
            casa: a.casa ?? v.casa,
            fora: a.fora ?? v.fora,
            avisos: [...a.avisos, ...v.avisos],
          }
        : v;
    }
    for (const o of l.outros)
      if (!base.outros.some((x) => x.rotulo === o.rotulo)) base.outros.push(o);
    base.avisos.push(...l.avisos);
  }
  return base;
}
