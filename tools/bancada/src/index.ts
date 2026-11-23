/**
 * Bancada F1.1: lê backups da Fase 0, junta, normaliza e entrega o conjunto de registros.
 * Só leitura e só normalização: nenhuma reprodução histórica, métrica ou conclusão aqui.
 */
import { canonico } from '../../../apps/web/src/evidencias';
import type { Evidencia } from '../../../apps/web/src/evidencias';
import { VERSAO_CONTRATO, type Exclusao, type FonteLida } from './contrato';
import { juntarBackups, type Juncao, type VersaoSubstituida } from './leitura/juntarBackups';
import { lerBackup } from './leitura/lerBackup';
import { montarAposta, type Aposta } from './normalizar/apostas';
import { FAIXAS, type IdFaixa } from './normalizar/faixas';
import { montarJogos, type Jogo } from './normalizar/jogos';
import type { TipoAposta } from './normalizar/mercados';
import {
  DERIVACAO_PENDENTE,
  montarAnalise,
  montarSelecoes,
  type Analise,
  type Selecao,
} from './normalizar/selecoes';

export { VERSAO_CONTRATO } from './contrato';
export { DELTA_CLV, DELTA_CLV_LOG, clvPadronizado } from './normalizar/clv';
export { FAIXAS, faixaDe, ehPreferencial } from './normalizar/faixas';
export { classificarMercado } from './normalizar/mercados';
export { chaveJogo } from './normalizar/jogos';
export { lerBackup } from './leitura/lerBackup';
export { juntarBackups } from './leitura/juntarBackups';

export interface ArquivoEntrada {
  nome: string;
  bytes: Uint8Array;
}

/** Conservação depois da normalização: entrada canônica → análise ou exclusão rastreada. */
export interface ConservacaoNormalizacao {
  entradasCanonicas: number;
  analises: number;
  semChaveDeJogo: number;
  evidenciasCanonicas: number;
  /** revisões ligadas a uma análise normalizada */
  evidenciasEmAnalises: number;
  /** revisões cuja entrada do histórico ficou fora por falta de chave de jogo */
  evidenciasDeAnaliseExcluida: number;
}

export interface Conjunto {
  contrato: number;
  fontes: FonteLida[];
  jogos: Jogo[];
  analises: Analise[];
  selecoes: Selecao[];
  apostas: Aposta[];
  substituidas: VersaoSubstituida[];
  exclusoes: Exclusao[];
  conservacao: Juncao['conservacao'] & { normalizacao: ConservacaoNormalizacao };
  derivacaoPendente: readonly string[];
  /** SHA-256 da forma canônica do conjunto (sem esta impressão): mesma entrada, mesma impressão */
  impressao: string;
}

const sha256Hex = async (texto: string) => {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export function normalizar(j: Juncao): Omit<Conjunto, 'impressao'> {
  const { jogos, chavePorId, exclusoes: semChave } = montarJogos(j.entradas);
  const evsPorId = new Map<string, Evidencia[]>();
  for (const ev of j.evidencias)
    evsPorId.set(ev.meta.idJogo, [...(evsPorId.get(ev.meta.idJogo) ?? []), ev]);

  const analises: Analise[] = [];
  const selecoes: Selecao[] = [];
  const apostas: Aposta[] = [];
  let evidenciasEmAnalises = 0;
  let evidenciasDeAnaliseExcluida = 0;
  for (const { entrada } of j.entradas) {
    const evs = evsPorId.get(entrada.id) ?? [];
    const chave = chavePorId.get(entrada.id);
    if (!chave) {
      evidenciasDeAnaliseExcluida += evs.length;
      continue;
    }
    evidenciasEmAnalises += evs.length;
    const { analise, decisao } = montarAnalise(entrada, chave, evs);
    analises.push(analise);
    if (decisao) selecoes.push(...montarSelecoes(entrada, chave, decisao));
    const a = montarAposta(entrada, chave);
    if (a) apostas.push(a);
  }
  const normalizacao: ConservacaoNormalizacao = {
    entradasCanonicas: j.entradas.length,
    analises: analises.length,
    semChaveDeJogo: semChave.length,
    evidenciasCanonicas: j.evidencias.length,
    evidenciasEmAnalises,
    evidenciasDeAnaliseExcluida,
  };
  if (normalizacao.analises + normalizacao.semChaveDeJogo !== normalizacao.entradasCanonicas)
    throw new Error('conservação violada na normalização: entradas canônicas sem destino');
  if (evidenciasEmAnalises + evidenciasDeAnaliseExcluida !== j.evidencias.length)
    throw new Error('conservação violada na normalização: revisões sem destino');

  return {
    contrato: VERSAO_CONTRATO,
    fontes: j.fontes,
    jogos,
    analises: analises.sort((a, b) => a.idHistorico.localeCompare(b.idHistorico)),
    selecoes: selecoes.sort(
      (a, b) => a.idHistorico.localeCompare(b.idHistorico) || a.chave.localeCompare(b.chave),
    ),
    apostas: apostas.sort((a, b) => a.idHistorico.localeCompare(b.idHistorico)),
    substituidas: j.substituidas,
    exclusoes: [...j.exclusoes, ...semChave].sort(
      (a, b) =>
        a.categoria.localeCompare(b.categoria) ||
        a.fonte.localeCompare(b.fonte) ||
        (a.id ?? '').localeCompare(b.id ?? ''),
    ),
    conservacao: { ...j.conservacao, normalizacao },
    derivacaoPendente: DERIVACAO_PENDENTE,
  };
}

/** Lê os arquivos, junta, normaliza e carimba a impressão. A ordem dos arquivos não importa. */
export async function montarConjunto(arquivos: ArquivoEntrada[]): Promise<Conjunto> {
  const leituras = await Promise.all(arquivos.map((a) => lerBackup(a.nome, a.bytes)));
  const base = normalizar(juntarBackups(leituras));
  return { ...base, impressao: await sha256Hex(canonico(base)) };
}

/* ---------- recorte (Q7): só filtra registros; não calcula taxa nem média ---------- */

export type Camada = 'betV4' | 'noBetPapel' | 'lista';

export interface FiltroRecorte {
  faixas?: IdFaixa[];
  grupo?: 'principal' | 'nicho';
  tiposAposta?: TipoAposta[];
  camada?: Camada;
}

/** Recorte da faixa preferencial (1,40–2,00): as três faixas marcadas como preferenciais. */
export const FAIXAS_PREFERENCIAIS: IdFaixa[] = FAIXAS.filter((f) => f.preferencial).map(
  (f) => f.id,
);

/** Seleções que atendem ao filtro, devolvidas como chaves (idHistorico + chave da seleção). */
export function recortarSelecoes(c: Pick<Conjunto, 'selecoes'>, f: FiltroRecorte): string[] {
  return c.selecoes
    .filter(
      (s) =>
        (!f.faixas || (s.faixaDecisao !== null && f.faixas.includes(s.faixaDecisao))) &&
        (!f.grupo || s.grupo === f.grupo) &&
        (!f.tiposAposta || f.tiposAposta.includes(s.tipoAposta)) &&
        (!f.camada || s.camadas[f.camada]),
    )
    .map((s) => `${s.idHistorico}#${s.chave}`);
}
