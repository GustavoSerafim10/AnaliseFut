/**
 * Contrato da F1.2c (consolidação): um status de reprodutibilidade por análise, para a F1.3 e a
 * F1.4 saberem em quais análises confiar e em que camada. Arquivo próprio: os contratos da F1.1,
 * F1.2a e F1.2b não mudam.
 *
 * Universos de conservação (nenhum registro some nem conta duas vezes):
 *  - análises elegíveis da F1.1 (sem irmaDe)        → exatamente um StatusAnalise
 *  - apostas irmãs (análises com irmaDe)            → herdam da raiz ou "vinculo-nao-resolvido"
 *  - entradas excluídas pela F1.1 (jogo-sem-chave)  → registradas com o destino da F1.2
 *  - seleções e apostas                             → herdam o status da análise a que pertencem
 */
import type { Comparacao, ReferenciaUsada, SubcausaHistorica } from './contratoReprocessamento';

export const VERSAO_CONTRATO_CONSOLIDACAO = 1;

export type StatusAnalise =
  /** revisão de decisão original-exata ou original-equivalente */
  | 'reproduzida'
  /** revisão de decisão original-divergente */
  | 'reproducao-divergente'
  /** reprocessada no build de referência (comparacao + tipo de referência) */
  | 'reprocessada'
  /** a F1.2 não obteve resultado (subcausa da F1.2) */
  | 'nao-reproduzivel'
  /** tem evidência, mas nenhuma revisão antes do apito: fato da F1.1, não resultado de reprodução */
  | 'sem-revisao-de-decisao'
  /** modo diagnóstico: nada foi executado; ver `previsao` */
  | 'nao-executado';

export type StatusIrma = 'herdado-da-raiz' | 'vinculo-nao-resolvido';

/** Status de uma seleção ou aposta: o da análise a que pertence. */
export type StatusVinculado = StatusAnalise | 'vinculo-nao-resolvido';

export type Camada = 'producao' | 'teste-sintetica';

/**
 * Previsão do diagnóstico: NUNCA é resultado de reprodução. "determinado" só existe quando o
 * desfecho não depende de execução (D1 reprovada, evidência inconsistente, sem referência...).
 * Tudo o que só a execução revela fica em naoVerificado.
 */
export interface PrevisaoDiagnostico {
  natureza: 'previsao';
  caminho: 'reproducao-original' | 'reprocessamento' | 'nenhum';
  determinado: SubcausaHistorica | null;
  motivo: string;
  /** subcausas possíveis que só a execução confirmaria (inclui o fallback por commit ausente) */
  naoVerificado: SubcausaHistorica[];
  /** além de subcausas: divergência, comparação diferente, relógio ambíguo... */
  observacoes: string[];
  /** protocolo gravado ≠ V4: a comparação seria protocolo-diferente (determinado pelo dado) */
  comparacaoPrevista: Comparacao | null;
}

export type FonteStatus =
  | { tipo: 'revisao-de-decisao'; identidade: string; revisao: number | null }
  | { tipo: 'entrada' }
  | { tipo: 'nenhuma' };

export interface ConsolidacaoAnalise {
  idHistorico: string;
  chaveJogo: string;
  status: StatusAnalise;
  subcausa: SubcausaHistorica | null;
  comparacao: Comparacao | null;
  referencia: ReferenciaUsada | null;
  fonte: FonteStatus;
  previsao: PrevisaoDiagnostico | null;
  motivo: string;
}

export interface ConsolidacaoIrma {
  idHistorico: string;
  irmaDe: string;
  status: StatusIrma;
  /** status herdado (null quando o vínculo não se resolve) */
  statusRaiz: StatusAnalise | null;
  motivo: string;
}

export interface ConsolidacaoExcluida {
  idHistorico: string;
  categoria: 'jogo-sem-chave';
  motivo: string;
  /** o que a F1.2 fez com a entrada (null no diagnóstico) */
  destinoF12: string | null;
  subcausaF12: SubcausaHistorica | null;
  previsao: PrevisaoDiagnostico | null;
}

export interface VinculoRegistro {
  idHistorico: string;
  /** chave da seleção (seleções) ou null (apostas) */
  chave: string | null;
  status: StatusVinculado;
}

export interface Consolidado {
  contrato: number;
  modo: 'diagnostico' | 'execucao';
  camada: Camada;
  referencia:
    | ReferenciaUsada
    | { tipo: 'ausente'; motivo: string }
    | { tipo: 'prevista'; sha: string | null; camada: Camada; verificada: false };
  /** impressão do conjunto da F1.1 (a mesma de montarConjunto para os mesmos arquivos) */
  impressaoConjunto: string;
  /** impressão dos resultados da F1.2 (null no diagnóstico) */
  impressaoF12: string | null;
  analises: ConsolidacaoAnalise[];
  irmas: ConsolidacaoIrma[];
  excluidas: ConsolidacaoExcluida[];
  selecoes: VinculoRegistro[];
  apostas: VinculoRegistro[];
  /** exclusões da F1.1 por categoria (rastreio: registros que nem viraram entrada canônica) */
  exclusoesF11: Record<string, number>;
  /**
   * Universo das revisões de evidência (F1.2a/F1.2b), separado do das análises: TODAS as
   * revisões da junção, inclusive as de depois do apito. A consolidação só LÊ a de decisão;
   * nenhuma é apagada. porClasse é null no diagnóstico (nada foi executado).
   */
  revisoesF12: { total: number; porClasse: Record<string, number> | null };
  conservacao: {
    entradasCanonicas: number;
    analisesElegiveis: number;
    irmas: number;
    excluidas: number;
    selecoes: number;
    apostas: number;
  };
}

/** Relatório para revisão: só contagens e impressões — nenhum nome de time, casa ou id. */
export interface RelatorioRevisao {
  contrato: number;
  modo: Consolidado['modo'];
  camada: Camada;
  referencia: { tipo: string };
  analises: Record<string, number>;
  analisesPorSubcausa: Record<string, number>;
  analisesPorComparacao: Record<string, number>;
  previsoes: Record<string, number>;
  irmas: Record<string, number>;
  excluidas: number;
  selecoes: Record<string, number>;
  apostas: Record<string, number>;
  exclusoesF11: Record<string, number>;
  revisoesF12: Consolidado['revisoesF12'];
  conservacao: Consolidado['conservacao'];
  impressaoConjunto: string;
  impressaoF12: string | null;
}
