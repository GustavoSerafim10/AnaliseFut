/**
 * Seção 4 — Data Quality calculada a partir dos dados que realmente chegaram.
 * Falta de informação nunca vira confiança. As odds ainda limitam depois (ajustarDQ).
 */
import type { DQ } from './tipos';

export interface InsumosDQ {
  /** menor nº de jogos entre os dois times; null = sem base para λ */
  jogosMin: number | null;
  temXg: boolean;
  temChutes: boolean;
  /** quantas plataformas de estatística trouxeram dados (SofaScore, SuperScore, Flashscore) */
  fontesStats: number;
  desfalquesConhecidos: boolean;
  ligaTop: boolean;
  escalacaoProvavel: boolean;
}

export function avaliarDQ(i: InsumosDQ): { dq: DQ; motivos: string[] } {
  const motivos: string[] = [];
  if (i.jogosMin === null)
    return { dq: 'E', motivos: ['sem jogos/gols dos dois times: sem base para λ'] };
  if (i.jogosMin <= 3) return { dq: 'D', motivos: [`só ${i.jogosMin} jogos na amostra (≤ 3)`] };

  const faltaA: string[] = [];
  if (!i.ligaTop) faltaA.push('liga não marcada como top');
  if (i.jogosMin < 10) faltaA.push('menos de 10 jogos');
  if (!i.temXg) faltaA.push('sem xG');
  if (!i.desfalquesConhecidos) faltaA.push('desfalques não informados');
  if (i.fontesStats < 2) faltaA.push('só uma plataforma de estatística');
  if (!i.escalacaoProvavel) faltaA.push('escalação provável não conferida');
  if (!faltaA.length) return { dq: 'A', motivos: ['todos os critérios de A atendidos'] };

  const faltaB: string[] = [];
  if (i.jogosMin < 6) faltaB.push(`${i.jogosMin} jogos (B exige ≥ 6)`);
  if (!i.temXg && !i.temChutes) faltaB.push('sem xG nem chutes no alvo');
  if (!i.desfalquesConhecidos) faltaB.push('desfalques não informados');
  if (!faltaB.length) {
    motivos.push(`não é A: ${faltaA.join(', ')}`);
    return { dq: 'B', motivos };
  }
  motivos.push(`não é B: ${faltaB.join(', ')}`);
  return { dq: 'C', motivos };
}
