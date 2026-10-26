/** Limpeza do texto que sai do OCR. */

export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function normalizarTexto(t: string): string {
  return t
    .replace(/\r/g, '')
    .replace(/(\d),(\d)/g, '$1.$2') // 3,55 → 3.55
    .replace(/[−–—]/g, '-')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
}

/** Número que pode ser uma odd ou uma linha: 1.24, 6.5, -1.5, (+0.25), 2 */
export function lerNumero(token: string): number | null {
  const m = /^\(?([+-]?\d{1,3}(?:\.\d{1,3})?)\)?$/.exec(token);
  return m ? Number(m[1]) : null;
}

/** Linha "sem preço" = nenhum número decimal (candidata a título de mercado). */
export function temNumeroDecimal(linha: string): boolean {
  return /\d\.\d/.test(linha);
}
