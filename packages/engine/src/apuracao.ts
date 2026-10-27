/**
 * Fase 4 — apuração depois do jogo: quanto a aposta rendeu com o placar real e se a odd
 * pega bateu a de fechamento (CLV). Usa os MESMOS liquidadores do modelo.
 */
import { NOME_ESTATISTICA } from './contagens';
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
