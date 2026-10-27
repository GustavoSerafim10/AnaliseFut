import type { Dispatch, SetStateAction } from 'react';
import type { Derivado } from '../dados';
import type { Leitura, Rascunho } from '../estado';
import type { Figurinhas } from '../figurinhas';

export interface PropsAba {
  r: Rascunho;
  setR: Dispatch<SetStateAction<Rascunho>>;
  d: Derivado;
  /** abre o jogo de exemplo (#demo) */
  abrirExemplo?: () => void;
  /** fotos escolhidas no aparelho para os três jogadores (só locais) */
  figurinhas?: Figurinhas;
  setFigurinhas?: (f: Figurinhas) => void;
  galeria?: string[];
  setGaleria?: (g: string[]) => void;
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
