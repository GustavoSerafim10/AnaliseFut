/**
 * Fase 4 — apuração depois do jogo: quanto a aposta rendeu com o placar real e se a odd
 * pega bateu a de fechamento (CLV). Usa os MESMOS liquidadores do modelo.
 */
import { NOME_ESTATISTICA } from './contagens';
import { removerMargem } from './devig';
import { criarLiquidador } from './mercados';
import type { LinhaOdd } from './tipos';

export interface ParPlacar {
  casa: number;
  fora: number;
}

export interface PlacarFinal extends ParPlacar {
  /** placar do intervalo: necessário para mercados de 1º/2º tempo e intervalo/final */
  intervalo?: ParPlacar;
  escanteios?: ParPlacar;
  cartoes?: ParPlacar;
}

export type Apuracao =
  | {
      ok: true;
      /** 1 ganho · 0,5 meio-ganho · 0 devolvida · −0,5 meia-perda · −1 perda */
      resultado: number;
      /** lucro por unidade apostada */
      lucro: number;
      rotulo: string;
    }
  | { ok: false; falta: string };

const ROTULO: Record<string, string> = {
  '1': 'ganhou',
  '0.5': 'meio ganho',
  '0': 'devolvida',
  '-0.5': 'meia perda',
  '-1': 'perdeu',
};

function concluir(resultado: number, odd: number): Apuracao {
  return {
    ok: true,
    resultado,
    lucro: resultado > 0 ? resultado * (odd - 1) : resultado,
    rotulo: ROTULO[String(resultado)] ?? String(resultado),
  };
}

export function apurarAposta(l: LinhaOdd, p: PlacarFinal): Apuracao {
  const r = criarLiquidador(l);
  if (!r.ok) return { ok: false, falta: r.motivo };
  const liq = r.liq;
  const ht = p.intervalo;
  const semIntervalo: Apuracao = { ok: false, falta: 'informar o placar do intervalo' };

  switch (liq.tipo) {
    case 'placar': {
      if (liq.periodo === 'FT') return concluir(liq.fn(p.casa, p.fora), l.odd);
      if (!ht) return semIntervalo;
      return liq.periodo === '1T'
        ? concluir(liq.fn(ht.casa, ht.fora), l.odd)
        : concluir(liq.fn(p.casa - ht.casa, p.fora - ht.fora), l.odd);
    }
    case 'tempos':
      if (!ht) return semIntervalo;
      return concluir(liq.fn(ht.casa, ht.fora, p.casa - ht.casa, p.fora - ht.fora), l.odd);
    case 'sequencia':
      if (p.casa + p.fora === 0) return concluir(liq.lado === 'nenhum' ? 1 : -1, l.odd);
      return { ok: false, falta: 'quem marcou primeiro/por último: apurar à mão' };
    case 'contagem': {
      const c = p[liq.estatistica];
      if (!c) return { ok: false, falta: `informar os ${NOME_ESTATISTICA[liq.estatistica]}` };
      if (liq.periodo !== 'FT')
        return {
          ok: false,
          falta: `${NOME_ESTATISTICA[liq.estatistica]} do 1º tempo: apurar à mão`,
        };
      return concluir(liq.fn(c.casa, c.fora), l.odd);
    }
    case 'primeira_contagem':
      return { ok: false, falta: 'quem cobrou o primeiro escanteio: apurar à mão' };
  }
}

/** CLV: quanto a odd pega supera a de fechamento (> 0 = bateu o mercado). */
export function clv(oddPega: number, oddFechamento: number): number {
  return oddPega / oddFechamento - 1;
}

/**
 * CLV da V4.0: contra a odd de fechamento JUSTA da referência. Com as odds dos outros
 * lados do mercado no fechamento, tira a margem (Shin em 3 lados, regra padrão em 2);
 * sem elas, usa a odd crua (CLV subestimado pela margem).
 */
export function clvJusto(
  oddPega: number,
  fechamentoLado: number,
  fechamentoOutros: number[] = [],
): { clv: number; oddJustaFechamento: number; semMargem: boolean } {
  if (!fechamentoOutros.length)
    return {
      clv: clv(oddPega, fechamentoLado),
      oddJustaFechamento: fechamentoLado,
      semMargem: false,
    };
  const odds = [fechamentoLado, ...fechamentoOutros];
  const p = removerMargem(odds, odds.length === 3 ? 'shin' : undefined).probs[0];
  return { clv: oddPega * p - 1, oddJustaFechamento: 1 / p, semMargem: true };
}

/** Brier de uma previsão de N resultados (soma dos quadrados; menor = melhor). */
export function brier(probs: number[], indiceOcorrido: number): number {
  return probs.reduce((s, p, i) => s + (p - (i === indiceOcorrido ? 1 : 0)) ** 2, 0);
}
