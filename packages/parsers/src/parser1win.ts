/**
 * Leitor de odds por título de mercado + "rótulo [linha] odd". Serve para qualquer casa com
 * esse layout (Bet365, Betano, Superbet, Pinnacle…); calibrado com prints reais da 1win
 * (Flamengo × Atlético-MG, 26/10/2026):
 *   Total                                   ← título do mercado
 *   Abaixo De 2.5 2.4 | Acima De 2.5 1.58   ← "rótulo [linha] odd" na mesma linha
 *   CR Flamengo Empate Atlético-MG          ← rótulos numa linha…
 *   1.26 5.7 12.4                           ← …e as odds na linha de baixo
 * Também aceita a forma de tabela (cabeçalho "Abaixo De | Acima De" e linhas "2.5 3.55 1.29").
 * Corrige erros típicos do OCR (ponto decimal perdido, "AcimaDel5", "O" no lugar de "0").
 * O que não reconhece vai para `naoReconhecidas`: nunca chuta valores.
 */
import type { NomesTimes, TipoMercado } from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import { detectarTituloMercado, ehBarraDeAbas, type MercadoDetectado } from './sinonimos';
import { lerNumero, normalizarTexto, semAcento, temNumeroDecimal } from './texto';
import { reconhecerTime } from './times';

export interface ContextoParser {
  jogo: NomesTimes;
  /** data do jogo, YYYY-MM-DD, para montar o horário ISO */
  data: string;
  /** fuso, padrão Brasília */
  fuso?: string;
  casa?: string;
  /** horário de coleta a usar se o print não mostrar um legível (ex.: hora do arquivo) */
  horarioPadrao?: string;
  /** mercado em vigor no início do texto (bloco sem título resolvido por outro print) */
  mercadoInicial?: MercadoDetectado;
}

export interface ResultadoParser {
  linhas: OddLine[];
  horarioColeta?: string;
  avisos: string[];
  naoReconhecidas: string[];
  /** linhas de mercados sem modelo (cartões, vitória antecipada…), ignoradas de propósito */
  ignoradas: number;
  /** linhas com odds ANTES do primeiro título (o título ficou no print anterior) */
  orfas: string[];
  /** linha do texto → mercado em que foi lida (para resolver órfãs de outros prints) */
  lidasPorMercado: { linha: string; mercado: MercadoDetectado }[];
}

const COM_LINHA: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'total',
  'total_time',
  'AH',
  'AH_europeu',
  'escanteios_total',
  'escanteios_time',
  'escanteios_ah',
  'cartoes_total',
  'cartoes_time',
  'cartoes_ah',
]);

/** Ordem padrão das odds quando os rótulos vêm numa linha e as odds na de baixo. */
const ORDEM_PADRAO: Partial<Record<TipoMercado, string[]>> = {
  '1X2': ['1', 'X', '2'],
  escanteios_1x2: ['1', 'X', '2'],
  cartoes_1x2: ['1', 'X', '2'],
  DC: ['1X', '12', 'X2'],
  DNB: ['1', '2'],
  primeiro_gol: ['casa', 'fora', 'nenhum'],
  ultimo_gol: ['casa', 'fora', 'nenhum'],
};

/** título de mercado da 1win: termina na setinha de recolher, lida como "A", "a", "~" ou "^" */
const TITULO_COM_SETA = /[A-Za-zÀ-ú]{3,}.*\s[Aa~^»]$/;

const CONFIANCA_OCR = 0.6;
const CONFIANCA_CORRIGIDA = 0.45;

/** Corrige erros típicos do OCR nos prints da 1win antes de interpretar. */
export function normalizar1win(texto: string): string {
  return (
    normalizarTexto(texto)
      // "+1.5" / "+ 1.5" (Pinnacle, Bet365): o sinal grudado ou solto antes da linha
      .replace(/([ \t]|^)\+[ \t]+(\d)/gm, '$1+$2')
      // "AcimaDel5" / "AcimaDe25" / "AcimaDe?2.0" → "Acima De 1.5"; linha de total tem 1 casa decimal
      .replace(
        /\b(abaixo|acima)[ \t]*de[ \t]*\??([l\d][\dl]*(?:\.\d+)?)/gi,
        (_, lado: string, n: string) => {
          let v = n.replace(/l/g, '1');
          if (!v.includes('.') && v.length >= 2) v = `${v.slice(0, -1)}.${v.slice(-1)}`;
          return `${lado[0].toUpperCase()}${lado.slice(1).toLowerCase()} De ${v}`;
        },
      )
      // "CR Flamengo O 1.03" → "CR Flamengo 0 1.03"
      .replace(/([ \t])[Oo](?=[ \t]+\d)/g, '$10')
      // "Atlético-MG1 1.49" → "Atlético-MG 1 1.49"
      .replace(/(-[A-Za-zÀ-ú]{2,})(\d)/g, '$1 $2')
      // tema claro: "CRFlamengo -0.25 1.61" (sigla grudada) e "CR Flamengo1 1.06" (linha grudada)
      .replace(/\b(CR|EC|SC|CA|SE|FC|AC|CD|AD|RB)(?=[A-ZÀ-Ú][a-zà-ú]{2,})/g, '$1 ')
      .replace(/([A-ZÀ-Ú][a-zà-ú]{2,})([+-]?\d+(?:\.\d+)?)(?=[ \t]|$)/gm, '$1 $2')
      // travessões soltos entre seleções
      .replace(/[ \t][—–-][ \t]/g, ' ')
  );
}

type OddLida = { odd: number; corrigida: boolean; alternativa?: number };

/**
 * A 1win sempre mostra a odd com ponto ("8.0", "21.0"): sem ponto = ponto perdido.
 * A leitura padrão põe o ponto depois do 1º dígito ("112" → 1.12); a alternativa, depois do
 * 2º ("11" → 11.0, "215" → 21.5). Quem escolhe é a margem do mercado (resolverAmbiguas).
 */
function lerOdd(tok: string): OddLida | null {
  const n = lerNumero(tok);
  if (n === null) return null;
  if (tok.includes('.') || tok.length < 2) return { odd: n, corrigida: false };
  const limpo = tok.replace(/[^\d]/g, '');
  const alternativa =
    limpo.length === 2 ? Number(limpo) : Number(`${limpo.slice(0, 2)}.${limpo.slice(2)}`);
  return { odd: Number(`${limpo[0]}.${limpo.slice(1)}`), corrigida: true, alternativa };
}

/** Margem plausível de um mercado completo (casas nunca dão menos de 2%). */
const MARGEM_MIN = 0.02;
const MARGEM_MAX = 0.3;
const MARGEM_TIPICA = 0.08;
const LADOS_DO_MERCADO: Partial<Record<TipoMercado, number>> = {
  '1X2': 3,
  escanteios_1x2: 3,
  cartoes_1x2: 3,
  DNB: 2,
  AH: 2,
  total: 2,
  total_time: 2,
  ambas: 2,
  escanteios_total: 2,
  escanteios_time: 2,
  escanteios_ah: 2,
  cartoes_total: 2,
  cartoes_time: 2,
  cartoes_ah: 2,
};
const HANDICAPS: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'AH',
  'escanteios_ah',
  'cartoes_ah',
]);

/**
 * Odds com ponto perdido têm duas leituras: fica a combinação que deixa a margem do mercado
 * plausível (2–30%, a mais perto de 8%). Ex.: escanteios "112 11 51" → 1.12 / 11.0 / 5.1.
 * Sem combinação plausível, fica a leitura padrão (e a sanidade acusa a margem).
 */
function resolverAmbiguas(linhas: OddLine[], alternativas: Map<OddLine, number>): void {
  const grupos = new Map<string, OddLine[]>();
  for (const l of linhas) {
    const linhaGrupo =
      l.linha === undefined
        ? '-'
        : HANDICAPS.has(l.mercado) && l.lado === 'fora'
          ? -l.linha
          : l.linha;
    const k = [l.mercado, l.periodo, l.time ?? '-', linhaGrupo].join('|');
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  for (const g of grupos.values()) {
    const ambiguas = g.filter((l) => alternativas.has(l));
    if (!ambiguas.length || g.length !== LADOS_DO_MERCADO[g[0].mercado]) continue;
    let melhor: { margem: number; escolha: number } | null = null;
    for (let escolha = 0; escolha < 1 << ambiguas.length; escolha++) {
      const odd = (l: OddLine) => {
        const i = ambiguas.indexOf(l);
        return i >= 0 && escolha & (1 << i) ? alternativas.get(l)! : l.odd;
      };
      const margem = g.reduce((s, l) => s + 1 / odd(l), 0) - 1;
      if (margem < MARGEM_MIN || margem > MARGEM_MAX) continue;
      if (!melhor || Math.abs(margem - MARGEM_TIPICA) < Math.abs(melhor.margem - MARGEM_TIPICA))
        melhor = { margem, escolha };
    }
    const escolha = melhor?.escolha ?? 0;
    ambiguas.forEach((l, i) => {
      if (escolha & (1 << i)) l.odd = alternativas.get(l)!;
    });
  }
}

function ladoTotal(rotulo: string): 'over' | 'under' | null {
  const r = semAcento(rotulo);
  if (/abaixo|menos|under|\bu\b|^-$/.test(r)) return 'under';
  if (/acima|mais|over|\bo\b|^\+$/.test(r)) return 'over';
  return null;
}

function ladoResultado(rotulo: string, jogo: NomesTimes, comEmpate: boolean): string | null {
  const r = semAcento(rotulo)
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim();
  if (/^(v1|w1|p1|1)$/.test(r)) return '1';
  if (/^(v2|w2|p2|2)$/.test(r)) return '2';
  if (comEmpate && /^(x|empate|draw)$/.test(r)) return 'X';
  const t = reconhecerTime(r, jogo);
  return t === 'casa' ? '1' : t === 'fora' ? '2' : null;
}

function ladoSimNao(rotulo: string): 'sim' | 'nao' | null {
  const r = semAcento(rotulo);
  if (/\b(sim|yes)\b/.test(r)) return 'sim';
  if (/\b(nao|no)\b/.test(r)) return 'nao';
  return null;
}

type Lado = { lado: string; time?: 'casa' | 'fora' };

function interpretarLado(ctx: MercadoDetectado, rotulo: string, jogo: NomesTimes): Lado | null {
  const comoLado = (l: string | null) => (l ? { lado: l } : null);
  switch (ctx.mercado) {
    case 'total':
    case 'total_time':
    case 'escanteios_total':
    case 'escanteios_time':
    case 'cartoes_total':
    case 'cartoes_time': {
      const lado = ladoTotal(rotulo);
      return lado ? { lado, time: ctx.time } : null;
    }
    case 'AH':
    case 'escanteios_ah':
    case 'cartoes_ah': {
      const r = semAcento(rotulo).trim();
      const time = /^(1|v1)$/.test(r)
        ? 'casa'
        : /^(2|v2)$/.test(r)
          ? 'fora'
          : reconhecerTime(rotulo, jogo);
      return time ? { lado: time } : null;
    }
    case '1X2':
    case 'escanteios_1x2':
    case 'cartoes_1x2':
      return comoLado(ladoResultado(rotulo, jogo, true));
    case 'DNB':
      return comoLado(ladoResultado(rotulo, jogo, false));
    case 'DC': {
      const r = semAcento(rotulo).replace(/\s/g, '');
      if (/^(1x|12|x2)$/.test(r)) return { lado: r.toUpperCase() };
      // "Flamengo ou Empate", "Flamengo/Atlético-MG", "Empate ou Atlético-MG"
      const partes = semAcento(rotulo).split(/\s+ou\s+|\s*\/\s*/);
      if (partes.length !== 2) return null;
      const r1x2 = partes.map((p) => ladoResultado(p, jogo, true));
      if (r1x2.some((x) => !x) || r1x2[0] === r1x2[1]) return null;
      const lado = ['1', 'X', '2'].filter((x) => r1x2.includes(x)).join('');
      return { lado };
    }
    case 'ambas':
      return comoLado(ladoSimNao(rotulo));
    case 'par_impar': {
      const r = semAcento(rotulo);
      return /impar/.test(r) ? { lado: 'impar' } : /\bpar\b/.test(r) ? { lado: 'par' } : null;
    }
    case 'primeiro_gol':
    case 'ultimo_gol':
    case 'primeiro_escanteio': {
      if (/sem (gol|escanteio)|nenhum/.test(semAcento(rotulo))) return { lado: 'nenhum' };
      return comoLado(reconhecerTime(rotulo, jogo));
    }
    case 'vencer_sem_sofrer': {
      const time = reconhecerTime(rotulo, jogo);
      return time ? { lado: 'sim', time } : null;
    }
    default:
      return null;
  }
}

const escaparRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ordem dos lados pela posição dos rótulos ("Atalanta Sem Gol Fiorentina"): a 1win muda a ordem
 * dos quadros de um jogo para outro. null quando algum rótulo não aparece (fica a ordem padrão).
 */
function ordemPelosRotulos(rotulos: string, lados: string[], jogo: NomesTimes): string[] | null {
  const t = semAcento(rotulos);
  const nome = (n: string) => new RegExp(escaparRe(semAcento(n).split(/[\s-]+/)[0]));
  const pos = (lado: string) => {
    const l = lado.toLowerCase();
    if (l === '1' || l === 'casa') return t.search(nome(jogo.casa));
    if (l === '2' || l === 'fora') return t.search(nome(jogo.fora));
    if (l === 'x') return t.search(/empate|draw/);
    if (l === 'nenhum') return t.search(/sem (gol|escanteio)|nenhum/);
    return -1;
  };
  const ps = lados.map(pos);
  if (ps.some((p) => p < 0) || new Set(ps).size !== ps.length) return null;
  return lados
    .map((l, i) => ({ l, p: ps[i] }))
    .sort((a, b) => a.p - b.p)
    .map((x) => x.l);
}

/**
 * Horário do print: primeiro "HH:MM" legível (barra de status). A linha da data do jogo
 * ("29 de out. de 2026, 16:45") traz o horário do INÍCIO: com a barra de status ilegível, a
 * odd parecia coletada na hora do jogo.
 */
function horarioDoTexto(linhas: string[], ctx: ContextoParser): string | undefined {
  for (const l of linhas.slice(0, 4)) {
    if (/\b(19|20)\d{2}\b|\bde (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i.test(l))
      continue;
    const m = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/.exec(l);
    if (m) return `${ctx.data}T${m[1].padStart(2, '0')}:${m[2]}:00${ctx.fuso ?? '-03:00'}`;
  }
  return undefined;
}

export function parse1win(texto: string, ctx: ContextoParser): ResultadoParser {
  const linhasTexto = normalizar1win(texto).split('\n');
  const casa = ctx.casa ?? '1win';
  const doPrint = horarioDoTexto(linhasTexto, ctx);
  const horarioColeta = doPrint ?? ctx.horarioPadrao;
  const avisos: string[] = [];
  if (/(^|\s)\d{1,2}\/\d{1,2}(\s|$)/m.test(texto) && !/\d\.\d/.test(texto))
    avisos.push(
      'odds parecem fracionárias (ex.: 5/4): mude a casa para o formato decimal e envie de novo',
    );
  const naoReconhecidas: string[] = [];
  const linhas: OddLine[] = [];
  let ignoradas = 0;
  const alternativas = new Map<OddLine, number>();
  if (!doPrint && ctx.horarioPadrao)
    avisos.push('horário da barra de status ilegível: usado o horário do arquivo do print');
  if (!horarioColeta)
    avisos.push('horário de coleta não encontrado no print: preencher na conferência');

  let mercado: MercadoDetectado | null = ctx.mercadoInicial ?? null;
  let colunas: ('over' | 'under')[] | null = null;
  let rotulosPendentes: string | null = null;
  const orfas: string[] = [];
  const lidasPorMercado: ResultadoParser['lidasPorMercado'] = [];

  const emitir = (lado: Lado, o: OddLida, linha?: number) => {
    if (!mercado) return;
    const nova: OddLine = {
      casa,
      mercado: mercado.mercado,
      periodo: mercado.periodo,
      lado: lado.lado,
      time: lado.time,
      linha,
      odd: o.odd,
      horarioColeta,
      fonte: 'ocr',
      confianca: o.corrigida ? CONFIANCA_CORRIGIDA : CONFIANCA_OCR,
    };
    linhas.push(nova);
    if (o.alternativa !== undefined && o.alternativa > 1) alternativas.set(nova, o.alternativa);
  };

  for (const bruta of linhasTexto) {
    if (ehBarraDeAbas(bruta)) continue;

    if (!temNumeroDecimal(bruta) && !/^[\d\s.]+$/.test(bruta)) {
      const t = semAcento(bruta);
      // cabeçalho de tabela "Abaixo De | Acima De" / "Menos | Mais" — só essas palavras
      // ("Gols Mais/Menos" é título de mercado, não cabeçalho)
      const soColunas = !t.replace(/abaixo|acima|menos|mais|under|over|\bde\b|[|/\s]/g, '');
      if (mercado && soColunas && /abaixo|menos|under/.test(t) && /acima|mais|over/.test(t)) {
        colunas =
          t.search(/abaixo|menos|under/) < t.search(/acima|mais|over/)
            ? ['under', 'over']
            : ['over', 'under'];
        continue;
      }
      const titulo = detectarTituloMercado(bruta, ctx.jogo);
      if (titulo) {
        mercado = titulo;
        colunas = null;
        rotulosPendentes = null;
      } else if (TITULO_COM_SETA.test(bruta)) {
        // título que o motor não conhece: as odds dele não podem cair no mercado de cima
        // ("Vencer Ambos Os Tempos" depois do primeiro gol: "Atlético Mineiro 8.0" virava 1º gol @ 8)
        mercado = { mercado: 'outro', periodo: 'FT' };
        colunas = null;
        rotulosPendentes = null;
      } else {
        rotulosPendentes = bruta;
      }
      continue;
    }
    if (!mercado) {
      orfas.push(bruta);
      continue;
    }
    lidasPorMercado.push({ linha: assinatura(bruta), mercado });
    if (mercado.mercado === 'outro') {
      ignoradas++;
      continue;
    }

    // forma de tabela: "2.5 3.55 1.29"
    const tabela = /^([+-]?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/.exec(bruta);
    if (colunas && tabela) {
      const L = Number(tabela[1]);
      for (const [i, lado] of colunas.entries()) {
        const o = lerOdd(tabela[i + 2]);
        if (o) emitir({ lado, time: mercado.time }, o, L);
      }
      continue;
    }

    const tokens = bruta.split(/[\s|]+/).filter(Boolean);

    // handicap em colunas por time, só números: "-1.5 1.85 +1.5 2.01" (Bet365, Pinnacle)
    if (
      HANDICAPS.has(mercado.mercado) &&
      tokens.length === 4 &&
      tokens.every((t) => lerNumero(t) !== null)
    ) {
      const [l1, , l2] = tokens.map((t) => lerNumero(t) as number);
      const o1 = lerOdd(tokens[1]);
      const o2 = lerOdd(tokens[3]);
      if (Math.abs(l1 + l2) < 1e-9 && o1 && o2 && o1.odd > 1 && o2.odd > 1) {
        let primeiro: 'casa' | 'fora' = 'casa';
        if (rotulosPendentes) {
          const t = semAcento(rotulosPendentes);
          const pc = t.search(new RegExp(semAcento(ctx.jogo.casa).split(/\s+/)[0]));
          const pf = t.search(new RegExp(semAcento(ctx.jogo.fora).split(/[\s-]+/)[0]));
          if (pc >= 0 && pf >= 0 && pf < pc) primeiro = 'fora';
        }
        const segundo = primeiro === 'casa' ? 'fora' : 'casa';
        emitir({ lado: primeiro }, o1, l1);
        emitir({ lado: segundo }, o2, l2);
        continue;
      }
    }

    // só odds, com os rótulos na linha de cima: usa a ordem padrão do mercado
    const ordem = ORDEM_PADRAO[mercado.mercado];
    if (ordem && tokens.every((t) => lerNumero(t) !== null) && tokens.length === ordem.length) {
      let lados = [...ordem];
      const pelaPosicao =
        rotulosPendentes && mercado.mercado !== 'DC'
          ? ordemPelosRotulos(rotulosPendentes, ordem, ctx.jogo)
          : null;
      if (pelaPosicao) lados = pelaPosicao;
      else if (rotulosPendentes && mercado.mercado !== 'DC') {
        const t = semAcento(rotulosPendentes);
        const pc = t.search(new RegExp(semAcento(ctx.jogo.casa).split(/\s+/)[0]));
        const pf = t.search(new RegExp(semAcento(ctx.jogo.fora).split(/[\s-]+/)[0]));
        if (pc >= 0 && pf >= 0 && pf < pc) {
          lados = lados.map((l) =>
            l === '1' ? '2' : l === '2' ? '1' : l === 'casa' ? 'fora' : l === 'fora' ? 'casa' : l,
          );
        }
      }
      tokens.forEach((tok, i) => {
        const o = lerOdd(tok);
        if (o && o.odd > 1) emitir({ lado: lados[i] }, o);
      });
      rotulosPendentes = null;
      continue;
    }

    // forma "rótulo [linha] odd" repetida na mesma linha
    const precisaLinha = COM_LINHA.has(mercado.mercado);
    let rotulo: string[] = [];
    let linha: number | undefined;
    let linhaDaFileira: number | undefined;
    let emitiu = false;
    for (const tok of tokens) {
      const n = lerNumero(tok);
      // inteiros sem ponto em mercados sem linha são rótulos ("1", "2", "12")
      const ehRotuloNumerico =
        n !== null && !precisaLinha && !tok.includes('.') && rotulo.length === 0;
      if (n === null || ehRotuloNumerico) {
        rotulo.push(tok);
        continue;
      }
      if (precisaLinha && linha === undefined && rotulo.length > 0) {
        // "AcimaDed.5 1.6": a linha grudou no rótulo e saiu ilegível; nas colunas
        // Menos | Mais a fileira tem uma linha só, a do lado de lá
        if (linhaDaFileira !== undefined && /^(abaixo|acima)de\S*\d/i.test(rotulo.join('')))
          linha = linhaDaFileira;
        else {
          linha = n;
          continue;
        }
      }
      const lado = interpretarLado(mercado, rotulo.join(' '), ctx.jogo);
      const o = lerOdd(tok);
      if (lado && o && o.odd > 1) {
        emitir(lado, o, precisaLinha ? linha : undefined);
        emitiu = true;
      }
      linhaDaFileira = linha ?? linhaDaFileira;
      rotulo = [];
      linha = undefined;
    }
    if (!emitiu) naoReconhecidas.push(bruta);
  }

  resolverAmbiguas(linhas, alternativas);
  if (linhas.length === 0 && !orfas.length) avisos.push('nenhuma odd reconhecida neste print');
  return { linhas, horarioColeta, avisos, naoReconhecidas, ignoradas, orfas, lidasPorMercado };
}

/** Linha reduzida aos números, para reconhecer a mesma linha em dois prints. */
function assinatura(linha: string): string {
  return (linha.match(/[+-]?\d+(?:\.\d+)?/g) ?? []).join('|');
}

/**
 * Lê todos os prints de uma casa juntos. Linhas sem título no topo de um print (o título
 * ficou no print anterior) herdam o mercado SÓ se alguma delas for idêntica a uma linha já
 * lida com título em outro print — a sobreposição da rolagem é a evidência. Sem evidência,
 * continuam como "não lidas". Não depende da ordem dos prints.
 */
export function parse1winVarios(
  textos: string[],
  ctx: ContextoParser & { horariosPadrao?: (string | undefined)[] },
): ResultadoParser {
  const padrao = (i: number) => ctx.horariosPadrao?.[i] ?? ctx.horarioPadrao;
  // print sem a hora da barra de status: vale a do print colado mais perto dele (tirados juntos),
  // não a hora em que foi colado
  const proprios = textos.map((t) => horarioDoTexto(normalizar1win(t).split('\n'), ctx));
  const comHora = proprios.flatMap((h, j) => (h ? [{ h, j }] : []));
  const vizinho = (i: number) => {
    if (!comHora.length) return undefined;
    const t = Date.parse(padrao(i) ?? '');
    const dist = (j: number) => {
      const tj = Date.parse(padrao(j) ?? '');
      return Number.isFinite(t) && Number.isFinite(tj) ? Math.abs(t - tj) : 0;
    };
    return comHora.reduce((a, b) => (dist(b.j) < dist(a.j) ? b : a)).h;
  };
  const ctxDe = (i: number): ContextoParser => ({
    ...ctx,
    horarioPadrao: proprios[i] ?? vizinho(i) ?? padrao(i),
  });
  const res = textos.map((t, i) => parse1win(t, ctxDe(i)));
  const conhecidas = new Map<string, MercadoDetectado>();
  const registrar = (r: ResultadoParser) =>
    r.lidasPorMercado.forEach((x) => {
      if (x.linha.split('|').length >= 2 && !conhecidas.has(x.linha))
        conhecidas.set(x.linha, x.mercado);
    });
  res.forEach(registrar);

  const pendentes = res.map((r) => r.orfas);
  let mudou = true;
  while (mudou) {
    mudou = false;
    pendentes.forEach((orfas, i) => {
      if (!orfas.length) return;
      const m = orfas.map((l) => conhecidas.get(assinatura(l))).find(Boolean);
      if (!m) return;
      const extra = parse1win(orfas.join('\n'), { ...ctxDe(i), mercadoInicial: m });
      res[i].linhas.push(...extra.linhas);
      res[i].naoReconhecidas.push(...extra.naoReconhecidas);
      res[i].ignoradas += extra.ignoradas;
      registrar(extra);
      pendentes[i] = [];
      mudou = true;
    });
  }
  return {
    linhas: res.flatMap((r) => r.linhas),
    horarioColeta: res.find((r) => r.horarioColeta)?.horarioColeta,
    avisos: [...new Set(res.flatMap((r) => r.avisos))],
    naoReconhecidas: [...res.flatMap((r) => r.naoReconhecidas), ...pendentes.flat()],
    ignoradas: res.reduce((s, r) => s + r.ignoradas, 0),
    orfas: pendentes.flat(),
    lidasPorMercado: res.flatMap((r) => r.lidasPorMercado),
  };
}
