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
  | 'escanteiosContra'
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
  | 'penaltisConcedidos'
  | 'cortes'
  | 'tirosDeMeta'
  | 'laterais'
  | 'passesCertos'
  | 'bolasLongas';

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
    faixa: [0.4, 4],
  },
  {
    campo: 'golsMarcados',
    rotulo: 'Gols marcados (total)',
    re: /gols m[ae]rcados/,
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
    // só o rótulo exato: "Gols <lixo do OCR>" não pode virar média de gols
    re: /gols por (partida|jogo)|^gols$/,
    formato: 'decimal1',
    faixa: [0.4, 4],
  },
  // média de xG na temporada abaixo de 0,2 não existe: é OCR ("0", "1" sem ponto)
  { campo: 'xgot', rotulo: 'xGOT', re: /xgot|xcot/, formato: 'decimal1', faixa: [0.2, 4] },
  {
    campo: 'xg',
    rotulo: 'xG (gols esperados)',
    re: /gols esperados|\bxg\b/,
    formato: 'decimal1',
    faixa: [0.2, 4],
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
    campo: 'escanteiosContra',
    rotulo: 'Escanteios cedidos',
    re: /escanteios (contra|sofridos|cedidos|concedidos)/,
    formato: 'decimal1',
    faixa: [0, 15],
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
    re: /cartoes amare/,
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
    faixa: [1, 8],
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
  {
    campo: 'cortes',
    rotulo: 'Cortes por jogo',
    re: /^cortes/,
    formato: 'decimal1',
    faixa: [3, 60],
  },
  {
    campo: 'tirosDeMeta',
    rotulo: 'Tiros de meta por jogo',
    re: /tiros de meta/,
    formato: 'decimal1',
    faixa: [1, 20],
  },
  {
    campo: 'laterais',
    rotulo: 'Laterais por jogo',
    re: /^laterais/,
    formato: 'decimal1',
    faixa: [5, 40],
  },
  {
    campo: 'passesCertos',
    rotulo: 'Passes certos por jogo',
    // "passes certos no campo de defesa/ataque" (SuperScore) é outro dado
    re: /passes certos(?! no campo)/,
    formato: 'decimal1',
    faixa: [80, 900],
  },
  {
    campo: 'bolasLongas',
    rotulo: 'Bolas longas certas por jogo',
    re: /bolas longas/,
    formato: 'decimal1',
    faixa: [3, 80],
  },
];

/**
 * Rótulos por extenso para reconhecer por semelhança o que o OCR escreveu errado
 * ("Gals por partida", "Asgsistências", "Chutee certos"). null = rótulo conhecido que não
 * é campo (fica em "outros"), para não virar o vizinho parecido.
 */
const FRASES: [CampoStat | null, string][] = [
  ['nota', 'nota sofascore'],
  ['partidas', 'partidas'],
  ['golsMarcados', 'gols marcados'],
  ['golsSofridos', 'gols sofridos'],
  ['assistencias', 'assistencias'],
  ['golsPorJogo', 'gols por partida'],
  ['golsPorJogo', 'gols por jogo'],
  ['chutesNoAlvo', 'chutes certos por jogo'],
  ['grandesChances', 'grandes chances de gol por jogo'],
  ['grandesChancesPerdidas', 'grandes chances perdidas por jogo'],
  ['posse', 'posse de bola'],
  ['passesCertos', 'passes certos por partida'],
  ['bolasLongas', 'bolas longas certas por jogo'],
  ['jogosSemSofrer', 'jogos sem sofrer gols'],
  ['golsSofridosPorJogo', 'gols sofridos por jogo'],
  ['interceptacoes', 'interceptacoes por jogo'],
  ['desarmes', 'desarmes por jogo'],
  [null, 'desarmes por partida'],
  ['cortes', 'cortes por jogo'],
  ['penaltisConcedidos', 'gols de penalti concedidos'],
  ['defesasGoleiro', 'defesas por jogo'],
  ['faltas', 'faltas por jogo'],
  ['impedimentos', 'impedimentos por jogo'],
  ['tirosDeMeta', 'tiros de meta por jogo'],
  ['laterais', 'laterais por jogo'],
  ['cartoesAmarelos', 'cartoes amarelos por partida'],
  ['cartoesVermelhos', 'cartoes vermelhos'],
];

/** Rótulos do SuperScore (só para semelhança; a ordem acima é a das linhas do SofaScore). */
const FRASES_SUPERSCORE: [CampoStat | null, string][] = [
  ['golsPorJogo', 'gols'],
  ['xg', 'gols esperados xg'],
  ['finalizacoes', 'finalizacoes totais'],
  ['chutesNoAlvo', 'chutes no gol'],
  ['grandesChances', 'grandes chances criadas'],
  ['escanteios', 'escanteios'],
  ['faltas', 'faltas cometidas'],
  ['faltasSofridas', 'faltas cobradas'],
  ['cartoesAmarelos', 'cartoes amarelos'],
  ['chutesFora', 'chutes fora do gol'],
  ['chutesBloqueados', 'chutes bloqueados'],
  ['finalizacoesDentroArea', 'finalizacoes dentro da area'],
  ['finalizacoesForaArea', 'finalizacoes fora da area'],
  ['ataquesPerigosos', 'ataques perigosos'],
  ['grandesChancesMarcadas', 'grandes chances marcadas'],
  ['toquesAreaAdversaria', 'toques na area adversaria'],
  ['defesasGoleiro', 'defesas do goleiro'],
  ['golsEvitados', 'gols evitados'],
  [null, 'passes certos no campo de defesa'],
  [null, 'passes certos no campo de ataque'],
  [null, 'bola na trave'],
  [null, 'dribles vencidos'],
  [null, 'posses perdidas'],
  [null, 'passes no terco final'],
  [null, 'lancamentos'],
  [null, 'erros que levaram a finalizacao'],
  [null, 'bloqueios'],
  [null, 'duelos vencidos'],
  [null, 'duelos no chao vencidos'],
  [null, 'bolas aereas vencidas'],
];

/** 0–1: 1 − distância de edição ÷ tamanho do maior. */
function semelhanca(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let ant = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = cur;
  }
  return 1 - ant[n] / Math.max(m, n);
}

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
    .replace(/\bgo[il1]s\b|\bgots\b|\bgos\b/g, 'gols')
    .replace(/assisten/g, 'assisten')
    .replace(/interceptac\w*/g, 'interceptacoes')
    .replace(/\bduetos\b/g, 'duelos')
    .replace(/finalizag/g, 'finalizac');
}

interface TokenNum {
  valor: number;
  temPonto: boolean;
  /** quantos dígitos estavam escritos ("01" = 2) */
  digitos: number;
  pos: number;
}

/** Separa números e palavras. "17.3(59.9%)" → 17.3; "[158" → 158; "W6.97" → 6.97. */
function tokenizar(linha: string): { nums: TokenNum[]; palavras: { txt: string; pos: number }[] } {
  const limpa = linha
    .replace(/\(\s*[\d., ]+%\s*\)/g, ' ')
    // "44 0%": o ponto do percentual virou espaço
    .replace(/\b(\d{1,2}) (\d)%/g, '$1.$2%');
  const nums: TokenNum[] = [];
  const palavras: { txt: string; pos: number }[] = [];
  limpa
    .split(/\s+/)
    .filter(Boolean)
    .forEach((tok, pos) => {
      const t = tok.replace(/^[[(|~«»“”"']+|[\])|.,;:'"»”!?]+$/g, '');
      const m = /^[A-Za-z]?(-?\d{1,4}(?:[.,]\d{1,2})?)(%)?$/.exec(t);
      if (m && !/^\d{1,2}:\d{2}$/.test(tok)) {
        nums.push({
          valor: Number(m[1].replace(',', '.')),
          temPonto: /[.,]/.test(m[1]),
          digitos: m[1].replace(/\D/g, '').length,
          pos,
        });
      } else if (/[a-zà-ú]{2,}/i.test(t) || /^[àaeé]$/.test(t)) {
        // "à", "e": ligam o rótulo ("Erros que levaram à finalização") em vez de cortá-lo
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
  // "44.0%" lido como "440%": percentual acima de 100 perdeu o ponto
  // "13.4" lido como "1394": o ponto virou dígito; só quando /10 sai da faixa e /100 não daria
  if (
    def.formato === 'decimal1' &&
    !tok.temPonto &&
    tok.valor >= 1000 &&
    tok.valor / 10 > def.faixa[1]
  ) {
    const s = String(tok.valor);
    const v = Number(`${s.slice(0, 2)}.${s.slice(3)}`);
    if (v >= def.faixa[0] && v <= def.faixa[1]) return { valor: v, corrigido: true };
  }
  if (def.formato === 'percentual' && !tok.temPonto && tok.valor > 100)
    return { valor: tok.valor / 10, corrigido: true };
  if (def.formato === 'decimal2' && !tok.temPonto)
    return { valor: tok.valor / 100, corrigido: true };
  return { valor: tok.valor, corrigido: false };
}

/** Palavra de até 3 letras que não faz parte de rótulo nenhum: é número que o OCR estragou. */
const LIXO_CURTO = (p: string) =>
  p.length <= 3 && !/^(por|de|da|do|no|na|em|gol|xg|e)$/i.test(semAcento(p));

/** undefined = rótulo ilegível; null = rótulo conhecido que não é campo (vai para "outros"). */
function acharCampo(rotulo: string): DefCampo | null | undefined {
  const exato = CAMPOS_STATS.find((d) => d.re.test(rotulo));
  if (exato) return exato;
  // só "por jogo" / "por partida" (2ª linha de um rótulo quebrado) serve para qualquer campo:
  // é ilegível, e no SofaScore a ordem das linhas resolve
  if (rotulo.replace(/\b(por|jogo|partida)\b/g, '').trim().length < 3) return undefined;
  // por semelhança: a frase inteira, ou o fim dela ("ry once perdidas" ~ "... perdidas por jogo")
  let melhor: { campo: CampoStat | null; s: number } = { campo: null, s: 0 };
  for (const [campo, frase] of [...FRASES, ...FRASES_SUPERSCORE]) {
    const s = Math.max(
      semelhanca(rotulo, frase),
      rotulo.length >= 8 ? semelhanca(rotulo, frase.slice(-rotulo.length)) - 0.05 : 0,
    );
    if (s > melhor.s) melhor = { campo, s };
  }
  if (melhor.s < 0.75) return undefined;
  return melhor.campo ? DEF_CAMPO[melhor.campo] : null;
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

  // 1ª passada: rótulo e os dois valores de cada linha
  const filas: {
    bruto: string;
    rotulo: string;
    def: DefCampo | null | undefined;
    esq?: TokenNum;
    dir?: TokenNum;
    avisoPosicao?: string;
  }[] = [];
  for (const bruto of linhas) {
    const { nums, palavras } = tokenizar(bruto);
    if (!nums.length) continue;
    if (!palavras.length) {
      // SofaScore: rótulo inteiro perdido ("=e 16 21"); a ordem das linhas diz qual é
      if (fonte === 'sofascore' && nums.length === 2)
        filas.push({ bruto, rotulo: '', def: undefined, esq: nums[0], dir: nums[1] });
      continue;
    }
    const rot = rotuloPrincipal(palavras);
    let rotulo = corrigirRotulo(semAcento(rot.txt));
    let def = acharCampo(rotulo);
    // "Gols marcados MH 44": o valor ilegível colou no rótulo como palavra curta
    let partes = rot.txt.split(' ');
    while (partes.length > 1 && LIXO_CURTO(partes[partes.length - 1])) {
      const semUltima = corrigirRotulo(semAcento(partes.slice(0, -1).join(' ')));
      const d = acharCampo(semUltima);
      if (!d || (def && d !== def)) break;
      partes = partes.slice(0, -1);
      rot.fim--;
      rot.txt = partes.join(' ');
      rotulo = semUltima;
      def = d;
    }
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
    // mesmo nome, outra métrica: "Bolas longas certas" do SuperScore (4,4) não é a do SofaScore
    // (16,3 por jogo); fica em "outros" para não virar divergência falsa
    if (fonte === 'superscore' && def?.campo === 'bolasLongas') def = null;
    filas.push({ bruto, rotulo: rot.txt, def, esq, dir, avisoPosicao });
  }

  // SofaScore tem as linhas sempre na mesma ordem: rótulo perdido (os de duas linhas, como
  // "Grandes chances de gol / por jogo", viram "=e 16 21") entre dois conhecidos é deduzido
  if (fonte === 'sofascore') {
    const ordem = (d: DefCampo) => FRASES.findIndex(([c]) => c === d.campo);
    for (let i = 0; i < filas.length; i++) {
      if (filas[i].def !== undefined || !filas[i].esq || !filas[i].dir) continue;
      let fim = i;
      while (fim + 1 < filas.length && filas[fim + 1].def === undefined) fim++;
      const ant = filas
        .slice(0, i)
        .reverse()
        .find((f) => f.def);
      const prox = filas.slice(fim + 1).find((f) => f.def);
      const n = fim - i + 1;
      // entre dois conhecidos: os que faltam entre eles; na ponta do print (o print acabou no
      // meio da tabela): os que vêm logo depois do último conhecido, ou logo antes do primeiro
      const vagos =
        ant?.def && prox?.def
          ? FRASES.slice(ordem(ant.def) + 1, ordem(prox.def))
          : ant?.def
            ? FRASES.slice(ordem(ant.def) + 1, ordem(ant.def) + 1 + n)
            : prox?.def
              ? FRASES.slice(Math.max(0, ordem(prox.def) - n), ordem(prox.def))
              : [];
      {
        if (vagos.length === n)
          vagos.forEach(([c], k) => {
            const f = filas[i + k];
            if (!c || !f.esq || !f.dir) return;
            f.def = DEF_CAMPO[c];
            f.avisoPosicao = `rótulo ilegível ("${f.rotulo}"): é ${DEF_CAMPO[c].rotulo} pela ordem das linhas do SofaScore, conferir`;
          });
      }
      i = fim;
    }
  }

  // 2ª passada: valores
  for (const { bruto, rotulo, def, esq, dir, avisoPosicao } of filas) {
    if (!def) {
      // cabeçalho da página (competição, temporada, menu) não é dado
      // cabeçalho da página (competição, temporada, menu) ou lixo ("OITO OUVTVOI") não é dado
      const cabecalho =
        !rotulo ||
        /campeonato|temporada|serie|mais|tenis|basquete|volei/i.test(semAcento(rotulo)) ||
        /\b[A-Z]{4,}\b/.test(rotulo) ||
        [esq, dir].some((t) => t && t.valor >= 1900);
      // SuperScore mostra toda média com 1 casa decimal: "55" é 5,5; "325" é 32,5
      const valor = (t?: TokenNum) =>
        t && (fonte === 'superscore' && !t.temPonto ? t.valor / 10 : t.valor);
      if (!cabecalho) outros.push({ rotulo, casa: valor(esq), fora: valor(dir), bruto });
      continue;
    }
    if (campos[def.campo]?.casa !== undefined && campos[def.campo]?.fora !== undefined) continue; // repetido entre prints

    const v: ValorLido = { bruto, avisos: avisoPosicao ? [avisoPosicao] : [] };
    const aplicar = (tok: TokenNum | undefined): number | undefined => {
      if (!tok) return undefined;
      // SuperScore sempre mostra "1.1": um dígito só, sem ponto, perdeu pedaço (pode ser 1.1,
      // 0.1, 1.0...); fica vazio em vez de virar 0,1
      if (fonte === 'superscore' && def.formato === 'decimal1' && tok.digitos === 1) {
        v.avisos.push(`"${tok.valor}" ilegível (o site mostra uma casa decimal): conferir`);
        return undefined;
      }
      const { valor, corrigido } = interpretar(tok, def);
      if (corrigido) v.avisos.push(`ponto decimal perdido no OCR: ${tok.valor} lido como ${valor}`);
      if (valor < def.faixa[0] || valor > def.faixa[1]) {
        // descartado: outro print (ou a correção à mão) completa o valor
        v.avisos.push(
          `${valor} fora da faixa plausível (${def.faixa[0]}–${def.faixa[1]}): descartado, conferir`,
        );
        return undefined;
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
  return coerencia({ fonte, campos, outros, colunasInvertidas, avisos });
}

/**
 * Total tem de bater com média × partidas ("Gols marcados 4" com 1,4 por jogo em 32 jogos é
 * o 44 com um dígito perdido). Sem bater, o total é descartado: a média serve de reserva.
 * Antes disso, partidas que não batem com total ÷ média ("32 3": o 32 do visitante perdeu
 * um dígito; 51 ÷ 1,6 ≈ 32) são repostas pela conta.
 */
function coerencia(l: LeituraStats): LeituraStats {
  const pares: [CampoStat, CampoStat][] = [
    ['golsMarcados', 'golsPorJogo'],
    ['golsSofridos', 'golsSofridosPorJogo'],
  ];
  for (const t of ['casa', 'fora'] as const) {
    const jogos = l.campos.partidas?.[t];
    const estimativas = pares
      .map(([total, media]) => {
        const vt = l.campos[total]?.[t];
        const vm = l.campos[media]?.[t];
        return vt !== undefined && vm ? vt / vm : undefined;
      })
      .filter((x): x is number => x !== undefined);
    if (!jogos || !estimativas.length) continue;
    const media = estimativas.reduce((a, b) => a + b, 0) / estimativas.length;
    const concordam = estimativas.every((e) => Math.abs(e - media) <= 0.1 * media);
    // a conta também tem de bater com as partidas do outro time (mesma competição): senão
    // o errado é o total ("Gols marcados 4" ÷ 1,4 ≈ 3 não repõe 32 partidas)
    const outro = l.campos.partidas?.[t === 'casa' ? 'fora' : 'casa'];
    const bateOutro = outro !== undefined && Math.abs(outro - media) <= 0.15 * outro;
    if (concordam && bateOutro && Math.abs(jogos - media) > 0.5 * media) {
      l.campos.partidas = {
        ...l.campos.partidas!,
        [t]: Math.round(media),
        avisos: [
          ...l.campos.partidas!.avisos,
          `${jogos} partidas não bate com gols ÷ média (≈ ${Math.round(media)}): reposto, conferir`,
        ],
      };
    }
  }
  for (const [total, media] of pares)
    for (const t of ['casa', 'fora'] as const) {
      const vt = l.campos[total]?.[t];
      const vm = l.campos[media]?.[t];
      const jogos = l.campos.partidas?.[t];
      if (vt === undefined || vm === undefined || !jogos) continue;
      const esperado = vm * jogos;
      // a média tem 1 casa decimal: arredondamento dá até ±0,05 × jogos de folga
      if (Math.abs(vt - esperado) <= Math.max(3, 0.05 * jogos + 0.1 * esperado)) {
        // valor posto pela posição (o vizinho ficou ilegível) que bate com a conta: confirmado
        const v = l.campos[total]!;
        if (v.avisos.some((a) => a.includes('pela posição')))
          l.campos[total] = {
            ...v,
            avisos: [
              ...v.avisos.filter((a) => !a.includes('pela posição')),
              `${vt} confirmado (o outro valor da linha ficou ilegível): bate com ${vm} por jogo × ${jogos} jogos (≈ ${Math.round(esperado)})`,
            ],
          };
        continue;
      }
      l.campos[total] = {
        ...l.campos[total]!,
        [t]: undefined,
        avisos: [
          ...l.campos[total]!.avisos,
          `${vt} não bate com ${vm} por jogo × ${jogos} jogos (≈ ${Math.round(esperado)}): descartado, conferir`,
        ],
      };
    }
  return l;
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
  return coerencia(base);
}
