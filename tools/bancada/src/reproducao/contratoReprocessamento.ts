/**
 * Contrato da F1.2b (reprocessamento), num arquivo próprio: o contrato da F1.2a não muda.
 *
 * Reprocessamento responde "o motor de REFERÊNCIA decidiria igual com a mesma entrada?". Nunca
 * vale como reprodução original e nunca se mistura com ela: cada resultado diz a referência
 * usada e se ela é a oficial de produção ou a sintética de teste.
 */
import type {
  Ambiente,
  Classe,
  Diferenca,
  ResultadoReproducao,
  Subcausa,
  ValorComparado,
} from './contrato';

export const VERSAO_CONTRATO_HISTORICA = 2;

/** Proteção 2: só estas tentativas originais caem para o reprocessamento (lista fechada). */
export const SUBCAUSAS_COM_REPROCESSAMENTO: readonly Subcausa[] = [
  'build-nao-elegivel',
  'commit-ausente',
];

export type SubcausaHistorica =
  | Subcausa
  /** não há build de referência oficial registrado (D4: a Fase 0 ainda não foi publicada) */
  | 'sem-build-referencia';

/** D-e: a referência sintética de teste nunca é confundida com a oficial de produção. */
export type TipoReferencia = 'producao' | 'teste-sintetica';

export interface ReferenciaUsada {
  sha: string;
  tipo: TipoReferencia;
}

/** Proteção 4: protocolo-diferente é um valor próprio, fora de concorda/diverge. */
export type Comparacao = 'concorda' | 'diverge' | 'protocolo-diferente';

export interface CampoComparado {
  campo: string;
  estado: 'igual' | 'diferente' | 'nao-comparavel';
  original?: ValorComparado;
  reproduzido?: ValorComparado;
  motivo?: string;
}

/** Uma das duas pontas do minuto do relógio inferido (resultado parcial preservado). */
export interface Ponta {
  instante: string;
  status: 'ok' | SubcausaHistorica;
  motivo: string | null;
  /** SHA-256 do resumo reprocessado nesta ponta */
  shaResumo: string | null;
  ambiente: Ambiente | null;
  registro: string | null;
}

export interface DetalheReprocessamento {
  referencia: ReferenciaUsada;
  hashReproduzido: string | null;
  shaConteudoReproduzido: string | null;
  diferencasTotal: number;
  diferencasDecisao: number;
  /** diferenças fora dos campos de decisão são esperadas entre builds: registradas, não classificam */
  diferencas: Diferenca[];
  ambiente: Ambiente | null;
  falha: { mensagem: string; codigoSaida: number | null; registro: string | null } | null;
}

/** Resultado final de uma revisão de evidência (exatamente um por revisão). */
export interface ResultadoRevisao {
  identidade: string;
  idJogo: string;
  revisao: number;
  marcas: string[];
  classe: Classe;
  subcausa: SubcausaHistorica | null;
  motivo: string;
  comparacao: Comparacao | null;
  referencia: ReferenciaUsada | null;
  /** proteção 5: a tentativa da F1.2a, completa, com todos os motivos */
  tentativaOriginal: ResultadoReproducao;
  /** presente só quando a tentativa original caiu para o reprocessamento */
  reprocessamento: DetalheReprocessamento | null;
  duracaoMs: number;
}

export type DestinoEntrada =
  /** tem revisões de evidência: elas são os itens (sem reprocessar a entrada em dobro) */
  | 'coberta-por-evidencia'
  /** aposta irmã: copia o resumo da raiz; aponta para o resultado dela */
  | 'irma-vinculada'
  | 'reprocessamento'
  | 'nao-reproduzivel';

export type RelogioEntrada =
  | { origem: 'inferido'; salvoEm: string; intervalo: [string, string] }
  | { origem: 'desconhecido'; motivo: string }
  | { origem: 'nao-aplicavel' };

/** Resultado final de uma entrada do histórico (exatamente um por entrada canônica). */
export interface ResultadoEntrada {
  idHistorico: string;
  irmaDe: string | null;
  marcas: string[];
  protocolo: string | null;
  destino: DestinoEntrada;
  subcausa: SubcausaHistorica | null;
  motivo: string;
  comparacao: Comparacao | null;
  referencia: ReferenciaUsada | null;
  relogio: RelogioEntrada;
  /** as duas execuções do minuto, com resultados parciais preservados */
  pontas: Ponta[];
  /** diferenças entre as duas pontas (qualquer uma: relógio ambíguo) */
  diferencasEntrePontas: Diferenca[];
  campos: CampoComparado[];
  /** revisões de evidência que cobrem esta entrada */
  revisoesCobertas: number;
  /** irmãs: o destino da raiz (nunca conta como concorda/diverge da irmã) */
  raiz: {
    id: string;
    presente: boolean;
    destino: DestinoEntrada | null;
    comparacao: Comparacao | null;
  } | null;
  duracaoMs: number;
}

export interface ManifestoHistorico {
  contrato: number;
  execucaoId: string;
  iniciadaEm: string;
  concluidaEm: string;
  /** cuidado 3: a referência deste manifesto inteiro (uma só por execução) */
  referencia: ReferenciaUsada | { tipo: 'ausente'; motivo: string };
  revisoes: {
    total: number;
    porClasse: Record<string, number>;
    porSubcausa: Record<string, number>;
    /** concordância SEPARADA por tipo de referência: nunca somada entre produção e teste */
    reprocessamentoPorTipo: Record<string, Record<string, number>>;
  };
  entradas: {
    total: number;
    porDestino: Record<string, number>;
    porSubcausa: Record<string, number>;
    reprocessamentoPorTipo: Record<string, Record<string, number>>;
  };
  impressaoEntradas: string;
  impressaoResultados: string;
}
