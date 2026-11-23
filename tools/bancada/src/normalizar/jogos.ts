/**
 * Jogo = unidade independente da bancada. Todas as observações de um jogo (mercados, camadas,
 * apostas irmãs, análises repetidas do mesmo jogo com ids diferentes) formam UM grupo; a
 * inferência (F1.4) reamostra jogos, nunca observações soltas.
 */
import type { EntradaHistorico } from '../../../../apps/web/src/historico';
import type { Exclusao } from '../contrato';
import type { EntradaCanonica } from '../leitura/juntarBackups';

export type EstadoResultado =
  | 'sem-resultado'
  /** só o fechamento, sem placar (o NaN intencional do site; no JSON vira null) */
  | 'fechamento-sem-placar'
  | 'resultado-sem-fechamento'
  | 'completo';

export interface PlacarNormalizado {
  casa: number;
  fora: number;
  intervalo: { casa: number; fora: number } | null;
  escanteios: { casa: number; fora: number } | null;
  cartoes: { casa: number; fora: number } | null;
}

export interface Jogo {
  chaveJogo: string;
  idsHistorico: string[];
  casa: string;
  fora: string;
  competicao: string;
  inicio: string;
  placar: PlacarNormalizado | null;
  /** entradas do mesmo jogo com placares diferentes: placar null e a marca */
  conflitoPlacar: boolean;
}

const finito = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const par = (p: unknown) => {
  const x = p as { casa?: unknown; fora?: unknown } | undefined;
  return x && finito(x.casa) && finito(x.fora) ? { casa: x.casa, fora: x.fora } : null;
};

/** Nome do time sem acento, caixa e espaços extras (a mesma partida digitada de jeitos diferentes). */
export const normalizarNome = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Chave do jogo: mandante + visitante + início. null quando falta algum dos três. */
export function chaveJogo(e: EntradaHistorico): string | null {
  const casa = e.rascunho?.jogo?.casa;
  const fora = e.rascunho?.jogo?.fora;
  const inicio = e.resumo?.inicio;
  if (typeof casa !== 'string' || typeof fora !== 'string' || typeof inicio !== 'string')
    return null;
  if (!casa.trim() || !fora.trim() || !Number.isFinite(Date.parse(inicio))) return null;
  return `${normalizarNome(casa)}|${normalizarNome(fora)}|${new Date(inicio).toISOString()}`;
}

export function estadoResultado(e: EntradaHistorico): EstadoResultado {
  const r = e.resultado;
  if (!r) return 'sem-resultado';
  const placar = finito(r.casa) && finito(r.fora);
  const fechamento = finito(r.oddFechamento) && r.oddFechamento > 1;
  if (!placar) return fechamento ? 'fechamento-sem-placar' : 'sem-resultado';
  return fechamento ? 'completo' : 'resultado-sem-fechamento';
}

export function placarDe(e: EntradaHistorico): PlacarNormalizado | null {
  const r = e.resultado;
  const p = par(r);
  if (!p) return null;
  return {
    ...p,
    intervalo: par(r?.intervalo),
    escanteios: par(r?.escanteios),
    cartoes: par(r?.cartoes),
  };
}

export function montarJogos(entradas: EntradaCanonica[]): {
  jogos: Jogo[];
  chavePorId: Map<string, string>;
  exclusoes: Exclusao[];
} {
  const exclusoes: Exclusao[] = [];
  const chavePorId = new Map<string, string>();
  const porChave = new Map<string, EntradaHistorico[]>();
  for (const { entrada, fontes } of entradas) {
    const k = chaveJogo(entrada);
    if (!k) {
      exclusoes.push({
        categoria: 'jogo-sem-chave',
        fonte: fontes[0] ?? '',
        id: entrada.id,
        motivo: 'análise sem mandante, visitante ou horário de início válido',
      });
      continue;
    }
    chavePorId.set(entrada.id, k);
    porChave.set(k, [...(porChave.get(k) ?? []), entrada]);
  }
  const jogos: Jogo[] = [...porChave.entries()].map(([k, es]) => {
    const ordenadas = [...es].sort((a, b) => a.id.localeCompare(b.id));
    const placares = ordenadas.map(placarDe).filter((p): p is PlacarNormalizado => !!p);
    const distintos = new Set(placares.map((p) => JSON.stringify(p)));
    const raiz = ordenadas.find((e) => !e.irmaDe) ?? ordenadas[0];
    return {
      chaveJogo: k,
      idsHistorico: ordenadas.map((e) => e.id),
      casa: raiz.rascunho.jogo.casa,
      fora: raiz.rascunho.jogo.fora,
      competicao: raiz.rascunho.jogo.competicao ?? '',
      inicio: new Date(raiz.resumo.inicio).toISOString(),
      placar: distintos.size === 1 ? placares[0] : null,
      conflitoPlacar: distintos.size > 1,
    };
  });
  jogos.sort((a, b) => a.chaveJogo.localeCompare(b.chaveJogo));
  return { jogos, chavePorId, exclusoes };
}
