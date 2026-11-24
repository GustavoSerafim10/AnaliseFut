/**
 * Itens da reprodução histórica a partir da junção da F1.1, em dois universos de conservação:
 *  - revisões de evidência: cada uma é um item da F1.2a (com as marcas da entrada);
 *  - entradas do histórico: cada uma tem exatamente um destino — coberta por evidência,
 *    irmã vinculada à raiz, ou a reprocessar.
 */
import type { EntradaHistorico } from '../../../../apps/web/src/historico';
import type { EntradaCanonica, Juncao } from '../leitura/juntarBackups';
import type { ItemReproducao } from './reproduzir';

export interface ItemEntrada {
  entrada: EntradaHistorico;
  marcas: string[];
  destino: 'coberta-por-evidencia' | 'irma-vinculada' | 'reprocessar';
  revisoesCobertas: number;
}

export interface Itens {
  revisoes: ItemReproducao[];
  entradas: ItemEntrada[];
}

/** Marcas herdadas da F1.1 por entrada canônica. */
export function marcasDa(c: EntradaCanonica): string[] {
  const m: string[] = [];
  if (c.criterio === 'desempate-por-conteudo') m.push('cronologiaNaoComprovada');
  return m;
}

export function montarItens(j: Juncao): Itens {
  const marcasPorId = new Map(j.entradas.map((c) => [c.entrada.id, marcasDa(c)]));
  const revisoesPorId = new Map<string, number>();
  for (const ev of j.evidencias)
    revisoesPorId.set(ev.meta.idJogo, (revisoesPorId.get(ev.meta.idJogo) ?? 0) + 1);

  const revisoes: ItemReproducao[] = j.evidencias.map((ev) => ({
    evidencia: ev,
    marcas: marcasPorId.get(ev.meta.idJogo) ?? [],
  }));
  const entradas: ItemEntrada[] = j.entradas.map((c) => {
    const n = revisoesPorId.get(c.entrada.id) ?? 0;
    return {
      entrada: c.entrada,
      marcas: marcasDa(c),
      // a evidência, quando existe, é a fonte mais forte: a entrada não é reprocessada em dobro
      destino:
        n > 0 ? 'coberta-por-evidencia' : c.entrada.irmaDe ? 'irma-vinculada' : 'reprocessar',
      revisoesCobertas: n,
    };
  });
  return { revisoes, entradas };
}
