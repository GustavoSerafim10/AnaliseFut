/**
 * Módulo INTERNO do Ledger (não reexportado por `index.ts`): descrição SEGURA de um valor lançado.
 *
 * Um `catch` recebe qualquer coisa: um `Error` comum, `null`, um texto, ou um objeto hostil (getter em
 * `message` que lança, `toString` / `valueOf` / `Symbol.toPrimitive` que lançam, Proxy). Montar a
 * mensagem de erro do Ledger não pode lançar de novo. Por isso:
 *  - de um objeto, só se usa a propriedade PRÓPRIA `message` quando ela é um DADO de texto (lida pelo
 *    descritor: nenhum getter é executado; `Error` comuns guardam a mensagem assim);
 *  - um primitivo vira texto com `String` (que nunca executa código do valor);
 *  - qualquer outra coisa, ou falha ao inspecionar (Proxy que lança), vira um texto FIXO.
 */
export function descreverFalha(e: unknown): string {
  if (e === null || (typeof e !== 'object' && typeof e !== 'function')) return String(e);
  try {
    const d = Object.getOwnPropertyDescriptor(e, 'message');
    if (d && 'value' in d && typeof d.value === 'string') return d.value as string;
  } catch {
    /* Proxy que lança ao ser inspecionado: cai no texto fixo */
  }
  return 'falha sem mensagem legível';
}
