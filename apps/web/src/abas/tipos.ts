import type { Dispatch, SetStateAction } from 'react';
import type { Derivado } from '../dados';
import type { Leitura, Rascunho } from '../estado';

export interface PropsAba {
  r: Rascunho;
  setR: Dispatch<SetStateAction<Rascunho>>;
  d: Derivado;
  /** abre o jogo de exemplo (#demo) */
  abrirExemplo?: () => void;
}

/** Helpers para adicionar/remover textos de prints de um grupo. */
export function acoesPrints(setR: PropsAba['setR'], grupo: string) {
  return {
    onLido: (l: Leitura) =>
      setR((x) => ({ ...x, prints: { ...x.prints, [grupo]: [...(x.prints[grupo] ?? []), l] } })),
    onRemover: (i: number) =>
      setR((x) => ({
        ...x,
        prints: { ...x.prints, [grupo]: (x.prints[grupo] ?? []).filter((_, j) => j !== i) },
      })),
  };
}
