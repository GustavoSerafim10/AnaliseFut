/**
 * Geradores de backups para os testes da bancada, feitos com as funções REAIS da Fase 0 e do
 * site (rascunho de exemplo, derivar, salvarNoHistorico, montarEvidencia, escreverBackupGz,
 * exportarJson). Nada de dado real do usuário: tudo é o jogo de exemplo, com relógio fixo.
 */
import { vi } from 'vitest';
import {
  FORMATO_BACKUP,
  escreverBackupGz,
  type CabecalhoBackupGz,
} from '../../../../apps/web/src/backupGz';
import { derivar } from '../../../../apps/web/src/dados';
import { montarEvidencia, type Evidencia } from '../../../../apps/web/src/evidencias';
import { rascunhoExemplo } from '../../../../apps/web/src/exemplo';
import {
  exportarJson,
  salvarNoHistorico,
  type EntradaHistorico,
} from '../../../../apps/web/src/historico';

export const AGORA = new Date('2026-11-18T15:00:00Z');
const MIN = 60_000;

export interface Cenario {
  /** entrada do exemplo, com aposta e resultado registrados */
  entrada: EntradaHistorico;
  /** três revisões antes do apito (1, 2, 3) e uma gravada depois dele (4) */
  revisoes: Evidencia[];
  inicio: string;
}

let cache: Cenario | null = null;

/** O jogo de exemplo salvo no histórico, com revisões de evidência reais. */
export async function cenario(): Promise<Cenario> {
  if (cache) return structuredClone(cache);
  vi.useFakeTimers({ now: AGORA, toFake: ['Date'] });
  try {
    const r = { ...rascunhoExemplo(), idHistorico: 'jogo-1' };
    const d = derivar(r);
    const { lista } = salvarNoHistorico([], r, d, undefined, AGORA.getTime());
    const base = lista[0];
    const inicio = base.resumo.inicio;
    const apito = Date.parse(inicio);
    const quando = [-150, -90, -30, +10].map((m) => new Date(apito + m * MIN).toISOString());
    const revisoes: Evidencia[] = [];
    for (const [i, g] of quando.entries()) {
      const e = await montarEvidencia(
        'jogo-1',
        r,
        d,
        { calculadoEm: { inicio: g, fim: g } },
        undefined,
        g,
      );
      revisoes.push({ ...e, meta: { ...e.meta, revisao: i + 1 } });
    }
    cache = { entrada: base, revisoes, inicio };
    return structuredClone(cache);
  } finally {
    vi.useRealTimers();
  }
}

/** Mesma entrada com aposta feita e resultado (placar + fechamento) registrados. */
export function comApostaEResultado(
  e: EntradaHistorico,
  o: {
    odd?: number;
    casa?: string;
    oddFechamento?: number;
    fechamentoOutros?: number[];
    placar?: [number, number] | null;
  } = {},
): EntradaHistorico {
  const linha = e.resumo.entrada!;
  return {
    ...e,
    aposta: {
      odd: o.odd ?? linha.odd,
      casa: o.casa ?? linha.casa,
      valor: 50,
      feitaEm: new Date(Date.parse(e.resumo.inicio) - 20 * MIN).toISOString(),
    },
    resultado: {
      ...(o.placar === null
        ? { casa: Number.NaN, fora: Number.NaN }
        : { casa: o.placar?.[0] ?? 2, fora: o.placar?.[1] ?? 1 }),
      oddFechamento: o.oddFechamento,
      fechamentoOutros: o.fechamentoOutros,
      registradoEm: new Date(Date.parse(e.resumo.inicio) + 120 * MIN).toISOString(),
    },
  };
}

async function* paginas(lista: Evidencia[]) {
  for (let i = 0; i < lista.length; i += 2) yield lista.slice(i, i + 2);
}

export async function backupGz(
  historico: unknown[],
  revisoes: Evidencia[],
  extra: Partial<CabecalhoBackupGz> = {},
): Promise<Uint8Array> {
  const cab: CabecalhoBackupGz = {
    formato: FORMATO_BACKUP,
    versao: 3,
    exportadoEm: '2026-11-18T22:00:00Z',
    historico,
    evidenciasNoArquivo: 'todas',
    ...extra,
  };
  const { blob } = await escreverBackupGz(cab, paginas(revisoes));
  return new Uint8Array(await blob.arrayBuffer());
}

const texto = (s: string) => new TextEncoder().encode(s);

/** .json versão 2 pelo exportador do site (NaN do placar vira null, como no aparelho). */
export function backupV2(historico: EntradaHistorico[], evidencias?: unknown[]): Uint8Array {
  return texto(
    exportarJson(historico, evidencias ? { evidencias: evidencias as Evidencia[] } : {}),
  );
}

/** .json antigo: sem "versao", só o histórico. */
export function backupV1(historico: unknown[]): Uint8Array {
  return texto(JSON.stringify({ exportadoEm: '2026-01-10T12:00:00Z', historico }));
}

/** gzip de um texto qualquer (para fabricar arquivos defeituosos que ainda são gzip). */
export async function gzTexto(s: string): Promise<Uint8Array> {
  const st = new Blob([s]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
