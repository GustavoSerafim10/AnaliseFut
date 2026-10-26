/**
 * Parser do layout da 1win: título do mercado seguido das seleções, por exemplo
 *   Total
 *   Abaixo De 2.5 3.55 | Acima De 2.5 1.29
 *   Handicap
 *   Aston Villa -1.5 1.61 | Viking 1.5 2.24
 * Também aceita a forma de tabela (cabeçalho "Abaixo De | Acima De" e linhas "2.5 3.55 1.29").
 * O que não reconhece vai para `naoReconhecidas`: nunca chuta valores.
 */
import type { NomesTimes, TipoMercado } from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import { detectarTituloMercado, type MercadoDetectado } from './sinonimos';
import { lerNumero, normalizarTexto, semAcento, temNumeroDecimal } from './texto';
import { reconhecerTime } from './times';

export interface ContextoParser {
  jogo: NomesTimes;
  /** data do jogo/coleta, YYYY-MM-DD, para montar o horário ISO */
  data: string;
  /** fuso, padrão Brasília */
  fuso?: string;
  casa?: string;
}

export interface ResultadoParser {
  linhas: OddLine[];
  horarioColeta?: string;
  avisos: string[];
  naoReconhecidas: string[];
}

const COM_LINHA: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'total',
  'total_time',
  'AH',
  'AH_europeu',
  'escanteios_total',
  'escanteios_ah',
  'cartoes_ah',
]);

const CONFIANCA_OCR = 0.6;

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

function interpretarLado(
  ctx: MercadoDetectado,
  rotulo: string,
  jogo: NomesTimes,
): { lado: string; time?: 'casa' | 'fora' } | null {
  switch (ctx.mercado) {
    case 'total':
    case 'total_time':
    case 'escanteios_total': {
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
      return ((l) => (l ? { lado: l } : null))(ladoResultado(rotulo, jogo, true));
    case 'DNB':
      return ((l) => (l ? { lado: l } : null))(ladoResultado(rotulo, jogo, false));
    case 'DC': {
      const r = semAcento(rotulo).replace(/\s/g, '');
      return /^(1x|12|x2)$/.test(r) ? { lado: r.toUpperCase() } : null;
    }
    case 'ambas': {
      const lado = ladoSimNao(rotulo);
      return lado ? { lado } : null;
    }
    case 'par_impar': {
      const r = semAcento(rotulo);
      return /impar/.test(r) ? { lado: 'impar' } : /\bpar\b/.test(r) ? { lado: 'par' } : null;
    }
    default:
      return null;
  }
}

/** Horário do print: primeiro "HH:MM" que aparecer (barra de status). */
function horarioDoTexto(linhas: string[], ctx: ContextoParser): string | undefined {
  for (const l of linhas) {
    const m = /(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/.exec(l);
    if (m) return `${ctx.data}T${m[1].padStart(2, '0')}:${m[2]}:00${ctx.fuso ?? '-03:00'}`;
  }
  return undefined;
}

export function parse1win(texto: string, ctx: ContextoParser): ResultadoParser {
  const linhasTexto = normalizarTexto(texto).split('\n');
  const casa = ctx.casa ?? '1win';
  const horarioColeta = horarioDoTexto(linhasTexto, ctx);
  const avisos: string[] = [];
  const naoReconhecidas: string[] = [];
  const linhas: OddLine[] = [];
  if (!horarioColeta)
    avisos.push('horário de coleta não encontrado no print: preencher na conferência');

  let mercado: MercadoDetectado | null = null;
  let colunas: ('over' | 'under')[] | null = null;

  const emitir = (lado: { lado: string; time?: 'casa' | 'fora' }, odd: number, linha?: number) => {
    if (!mercado) return;
    linhas.push({
      casa,
      mercado: mercado.mercado,
      periodo: mercado.periodo,
      lado: lado.lado,
      time: lado.time,
      linha,
      odd,
      horarioColeta,
      fonte: 'ocr',
      confianca: CONFIANCA_OCR,
    });
  };

  for (const bruta of linhasTexto) {
    if (!temNumeroDecimal(bruta)) {
      const t = semAcento(bruta);
      // cabeçalho de tabela "Abaixo De | Acima De"
      if (mercado && /abaixo|menos|under/.test(t) && /acima|mais|over/.test(t)) {
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
      }
      continue;
    }
    if (!mercado) {
      naoReconhecidas.push(bruta);
      continue;
    }

    // forma de tabela: "2.5 3.55 1.29"
    const tabela = /^([+-]?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/.exec(bruta);
    if (colunas && tabela) {
      const L = Number(tabela[1]);
      emitir({ lado: colunas[0], time: mercado.time }, Number(tabela[2]), L);
      emitir({ lado: colunas[1], time: mercado.time }, Number(tabela[3]), L);
      continue;
    }

    // forma "rótulo [linha] odd" repetida na mesma linha
    const precisaLinha = COM_LINHA.has(mercado.mercado);
    const tokens = bruta.split(/[\s|]+/).filter(Boolean);
    let rotulo: string[] = [];
    let linha: number | undefined;
    let emitiu = false;
    for (const tok of tokens) {
      const n = lerNumero(tok);
      // inteiros sem ponto em mercados sem linha são rótulos ("1", "2", "12")
      const ehRotuloNumerico = n !== null && !precisaLinha && !tok.includes('.');
      if (n === null || ehRotuloNumerico) {
        rotulo.push(tok);
        continue;
      }
      if (precisaLinha && linha === undefined && rotulo.length > 0) {
        linha = n;
        continue;
      }
      const lado = interpretarLado(mercado, rotulo.join(' '), ctx.jogo);
      if (lado && n > 1) {
        emitir(lado, n, precisaLinha ? linha : undefined);
        emitiu = true;
      }
      rotulo = [];
      linha = undefined;
    }
    if (!emitiu) naoReconhecidas.push(bruta);
  }

  if (linhas.length === 0) avisos.push('nenhuma odd reconhecida neste print');
  return { linhas, horarioColeta, avisos, naoReconhecidas };
}
