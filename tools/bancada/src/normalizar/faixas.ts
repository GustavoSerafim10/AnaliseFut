/**
 * Faixas de odds PRÉ-REGISTRADAS (aprovadas antes de qualquer dado), sem sobreposição:
 *
 *   abaixo-1,40      odd < 1,40                    controle
 *   1,40–1,60        1,40 ≤ odd < 1,60             preferencial
 *   1,60–1,80        1,60 ≤ odd < 1,80             preferencial
 *   1,80–2,00        1,80 ≤ odd ≤ 2,00             preferencial (2,00 incluso)
 *   2,00–3,00        2,00 < odd ≤ 3,00             controle
 *   acima-3,00       odd > 3,00                    controle
 *
 * A faixa preferencial (1,40 a 2,00) é DIMENSÃO DE ANÁLISE: não é filtro nem motivo para entrar.
 */

export type IdFaixa =
  'abaixo-1,40' | '1,40–1,60' | '1,60–1,80' | '1,80–2,00' | '2,00–3,00' | 'acima-3,00';

export interface Faixa {
  id: IdFaixa;
  preferencial: boolean;
}

export const FAIXAS: readonly Faixa[] = [
  { id: 'abaixo-1,40', preferencial: false },
  { id: '1,40–1,60', preferencial: true },
  { id: '1,60–1,80', preferencial: true },
  { id: '1,80–2,00', preferencial: true },
  { id: '2,00–3,00', preferencial: false },
  { id: 'acima-3,00', preferencial: false },
];

/** Faixa de uma odd decimal; null quando a odd não é válida (não finita ou ≤ 1). */
export function faixaDe(odd: number | null | undefined): IdFaixa | null {
  if (typeof odd !== 'number' || !Number.isFinite(odd) || odd <= 1) return null;
  if (odd < 1.4) return 'abaixo-1,40';
  if (odd < 1.6) return '1,40–1,60';
  if (odd < 1.8) return '1,60–1,80';
  if (odd <= 2) return '1,80–2,00';
  if (odd <= 3) return '2,00–3,00';
  return 'acima-3,00';
}

export const ehPreferencial = (f: IdFaixa | null): boolean =>
  f !== null && FAIXAS.some((x) => x.id === f && x.preferencial);
