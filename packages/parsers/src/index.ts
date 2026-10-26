import { chaveSelecao, type LinhaOdd } from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import { detectarFonte, type FonteDetectada } from './fonte';
import { parse1win, type ContextoParser, type ResultadoParser } from './parser1win';

export * from './texto';
export * from './times';
export * from './fonte';
export * from './sinonimos';
export * from './parser1win';
export * from './sanidade';
export * from './estatisticas';
export * from './contexto';
export * from './consolidacao';

export interface LeituraPrint extends ResultadoParser {
  fonte: FonteDetectada;
  reconhecido: boolean;
}

/** Texto do OCR → odds. Layout desconhecido = aviso, nunca valor inventado. */
export function lerPrint(texto: string, ctx: ContextoParser): LeituraPrint {
  const { fonte } = detectarFonte(texto);
  if (fonte === '1win') return { ...parse1win(texto, ctx), fonte, reconhecido: true };
  const vazio = {
    linhas: [],
    avisos: [] as string[],
    naoReconhecidas: [] as string[],
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
