import { chaveSelecao, type LinhaOdd } from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import { detectarCasa, detectarFonte, type FonteDetectada } from './fonte';
import { checarSanidade } from './sanidade';
import {
  parse1win,
  parse1winVarios,
  type ContextoParser,
  type ResultadoParser,
} from './parser1win';

export * from './texto';
export * from './times';
export * from './evento';
export * from './fonte';
export * from './sinonimos';
export * from './parser1win';
export * from './sanidade';
export * from './estatisticas';
export * from './contexto';
export * from './tabelaOcr';
export * from './consolidacao';
export * from './escalacao';
export * from './camisa';
export * from './cabecalho';
export * from './conferirPrint';
export * from './ultimas';

export interface LeituraPrint extends ResultadoParser {
  fonte: FonteDetectada;
  reconhecido: boolean;
}

export interface ContextoCasa extends ContextoParser {
  /** horário do arquivo de cada print, na mesma ordem dos textos */
  horariosPadrao?: (string | undefined)[];
}

/**
 * Todos os prints de UMA casa de apostas → odds. O layout "título do mercado + rótulo [linha]
 * odd" é o mesmo leitor para toda casa; o nome da casa vem da aba. Se o print mostrar a marca
 * de outra casa, avisa (odd lançada na casa errada estraga o consenso e a melhor odd).
 */
export function lerOddsCasa(textos: string[], ctx: ContextoCasa): ResultadoParser {
  const r = parse1winVarios(textos, ctx);
  const casa = (ctx.casa ?? '1win').trim().toLowerCase();
  const outras = new Set(
    textos
      .map(detectarCasa)
      .filter(
        (c): c is string => !!c && c.toLowerCase() !== casa && !casa.includes(c.toLowerCase()),
      ),
  );
  for (const c of outras)
    r.avisos.push(`há print com a marca da ${c}: confira se ele é mesmo da ${ctx.casa}`);
  return r;
}

/** O que as leituras dos prints confirmaram e o que precisa ser conferido. */
export interface AuditoriaLeitura {
  /** quantas vezes os prints foram lidos */
  leituras: number;
  total: number;
  confirmadas: number;
  divergentes: { linha: OddLine; valores: { odd: number; votos: number }[] }[];
  /** entrou na análise, mas só a primeira leitura viu */
  umaLeitura: OddLine[];
  /** só uma releitura viu: ficou de fora */
  descartadas: OddLine[];
  foraDaAnalise: { linha: OddLine; motivo: string }[];
  semOutroLado: OddLine[];
}

/** Sanidade das odds finais: o que sai da análise e o que veio sem o outro lado. */
function comSanidade(linhas: OddLine[]): Pick<AuditoriaLeitura, 'foraDaAnalise' | 'semOutroLado'> {
  const problemas = checarSanidade(linhas as LinhaOdd[]);
  const fora = new Map<number, string>();
  for (const p of problemas)
    if (p.nivel === 'erro' && !fora.has(p.indice)) fora.set(p.indice, p.mensagem);
  const sem = new Set(
    problemas
      .filter((p) => p.nivel === 'alerta' && /sem (todos os lados|o outro lado)/.test(p.mensagem))
      .map((p) => p.indice),
  );
  return {
    foraDaAnalise: [...fora].map(([i, motivo]) => ({ linha: linhas[i], motivo })),
    semOutroLado: linhas.filter((_, i) => sem.has(i) && !fora.has(i)),
  };
}

/**
 * Vários jogos de leitura dos mesmos prints: cada jogo é lido inteiro (um print herda o mercado
 * de outro) e cada odd vai por votos. Empate fica com a primeira leitura. Odd que a primeira
 * leitura não viu só entra se mais de uma releitura concordar: uma sozinha pode inventar mercado.
 */
export function lerOddsCasaConsenso(
  prints: { texto: string; releituras?: string[] }[],
  ctx: ContextoCasa,
  minVotosSemPrimeira = 2,
): ResultadoParser & { auditoria: AuditoriaLeitura } {
  const principal = lerOddsCasa(
    prints.map((p) => p.texto),
    ctx,
  );
  const jogos = Math.max(0, ...prints.map((p) => p.releituras?.length ?? 0));
  if (!jogos) {
    const unicas = juntarLinhas(principal.linhas).linhas;
    return {
      ...principal,
      auditoria: {
        leituras: 1,
        total: unicas.length,
        confirmadas: 0,
        divergentes: [],
        umaLeitura: [],
        descartadas: [],
        ...comSanidade(unicas),
      },
    };
  }
  const leituras = [juntarLinhas(principal.linhas).linhas];
  for (let j = 0; j < jogos; j++) {
    const comEsta = prints.flatMap((p, i) =>
      p.releituras?.[j] !== undefined ? [{ texto: p.releituras[j], i }] : [],
    );
    const lidas = lerOddsCasa(
      comEsta.map((p) => p.texto),
      { ...ctx, horariosPadrao: comEsta.map((p) => ctx.horariosPadrao?.[p.i]) },
    );
    leituras.push(juntarLinhas(lidas.linhas).linhas);
  }
  const votos = new Map<string, Map<number, OddLine[]>>();
  leituras.forEach((linhas) => {
    for (const l of linhas) {
      const k = chaveSelecao(l as LinhaOdd);
      const porOdd = votos.get(k) ?? new Map<number, OddLine[]>();
      porOdd.set(l.odd, [...(porOdd.get(l.odd) ?? []), l]);
      votos.set(k, porOdd);
    }
  });
  const naPrimeira = new Set(leituras[0].map((l) => chaveSelecao(l as LinhaOdd)));
  const linhas: OddLine[] = [];
  const divergentes: AuditoriaLeitura['divergentes'] = [];
  const umaLeitura: OddLine[] = [];
  const descartadas: OddLine[] = [];
  let confirmadas = 0;
  for (const [k, porOdd] of votos) {
    let melhor: OddLine[] = [];
    for (const v of porOdd.values()) if (v.length > melhor.length) melhor = v;
    if (!naPrimeira.has(k) && melhor.length < minVotosSemPrimeira) {
      // linha que não anda de 0,25 em 0,25 é lixo do OCR: não precisa de conferência
      const l = melhor[0].linha;
      if (l === undefined || Number.isInteger(l * 4)) descartadas.push(melhor[0]);
      continue;
    }
    linhas.push(melhor[0]);
    if (porOdd.size > 1)
      divergentes.push({
        linha: melhor[0],
        valores: [...porOdd].map(([odd, v]) => ({ odd, votos: v.length })),
      });
    else if (melhor.length === 1) umaLeitura.push(melhor[0]);
    else confirmadas++;
  }
  return {
    ...principal,
    linhas,
    auditoria: {
      leituras: leituras.length,
      total: linhas.length,
      confirmadas,
      divergentes,
      umaLeitura,
      descartadas,
      ...comSanidade(linhas),
    },
  };
}

/** Texto do OCR → odds. Layout desconhecido = aviso, nunca valor inventado. */
export function lerPrint(texto: string, ctx: ContextoParser): LeituraPrint {
  const { fonte } = detectarFonte(texto);
  if (fonte === '1win') return { ...parse1win(texto, ctx), fonte, reconhecido: true };
  const vazio = {
    linhas: [],
    avisos: [] as string[],
    naoReconhecidas: [] as string[],
    ignoradas: 0,
    orfas: [] as string[],
    lidasPorMercado: [],
    fonte,
    reconhecido: false,
  };
  if (fonte === 'desconhecida') {
    vazio.avisos.push(
      'não reconheci este print: use "Importar JSON" ou digite as odds na conferência',
    );
  } else {
    vazio.avisos.push(
      `print de ${fonte} reconhecido, mas o leitor de estatísticas chega na Fase 2b`,
    );
  }
  return vazio;
}

/**
 * Junta vários prints do mesmo jogo e remove duplicadas (os prints se sobrepõem ao rolar
 * a tela). Na repetição fica a coleta mais recente.
 */
export function juntarLinhas(...listas: OddLine[][]): { linhas: OddLine[]; duplicadas: number } {
  const mapa = new Map<string, OddLine>();
  let duplicadas = 0;
  for (const l of listas.flat()) {
    const k = `${l.casa.trim().toLowerCase()}#${chaveSelecao(l as LinhaOdd)}`;
    const atual = mapa.get(k);
    if (atual) {
      duplicadas++;
      if ((l.horarioColeta ?? '') < (atual.horarioColeta ?? '')) continue;
    }
    mapa.set(k, l);
  }
  return { linhas: [...mapa.values()], duplicadas };
}
export * from './resultado';
