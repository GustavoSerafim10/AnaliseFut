/**
 * Contrato da reprodução histórica (F1.2a): reproduzir cada revisão de evidência no build que a
 * gerou e dizer, com motivo, se a decisão histórica se reproduz. Valida a CAPACIDADE de
 * reproduzir; não altera nem "melhora" probabilidade alguma do motor.
 */

export const VERSAO_CONTRATO_REPRODUCAO = 1;

/** D3: |a − b| ≤ max(1e-12, 1e-12 × max(|a|, |b|)). Nunca aplicada a campo de decisão. */
export const TOLERANCIA = 1e-12;

/** Fuso de execução: o site grava horários com sufixo fixo −03:00 (isoLocal). */
export const FUSO_ESPERADO = 'America/Sao_Paulo';
/** Localidade presumida do aparelho original: o motor usa localeCompare sem localidade. */
export const LOCALIDADE_ESPERADA = 'pt-BR';

export const TEMPO_LIMITE_PADRAO_MS = 60_000;
export const LIMITE_DIFERENCAS = 200;

/**
 * Campos de decisão (proposta aprovada): qualquer diferença aqui é divergência, sem tolerância.
 * `[*]` vale qualquer índice; um campo-pai ausente também conta (ex.: `melhor` virou null).
 */
export const CAMPOS_DECISAO = [
  'avaliacao.v4.decisao',
  'avaliacao.v4.melhor.chave',
  'avaliacao.v4.melhor.stake',
  'avaliacao.v4.melhor.ev',
  'avaliacao.v4.melhor.evMinimo',
  'avaliacao.v4.referencia.nivel',
  'modelo.dq.dq',
  'avaliacao.entradas.entradas[*].chave',
] as const;

export type Classe =
  | 'original-exata'
  | 'original-equivalente'
  | 'original-divergente'
  /** F1.2b: ainda não produzida nesta etapa */
  | 'reprocessamento'
  | 'nao-reproduzivel';

export type Subcausa =
  | 'commit-ausente'
  | 'build-nao-elegivel'
  | 'dependencias-indisponiveis'
  | 'api-ausente'
  | 'entrada-irrecuperavel'
  | 'relogio-desconhecido'
  | 'erro-execucao'
  | 'tempo-esgotado'
  /** acréscimo da F1.2a: fuso ou localidade efetivos diferentes do esperado */
  | 'ambiente-invalido'
  /** acréscimo da F1.2a: o conteúdo gravado não bate com o próprio hash */
  | 'evidencia-inconsistente';

export interface BuildPedido {
  commit: string | null;
  origem: string | null;
  alteracoesLocais: boolean | null;
}

export interface BuildUsado {
  commit: string;
  shaLockfile: string | null;
  hashDependencias: string | null;
  npm: string | null;
}

export interface Ambiente {
  node: string;
  v8: string;
  icu: string | null;
  plataforma: string;
  arquitetura: string;
  fuso: string;
  /** minutos de deslocamento medidos num instante fixo (São Paulo sem horário de verão: 180) */
  deslocamentoMin: number;
  localidade: string;
  localidadeColacao: string;
}

export type TipoValor =
  | 'ausente'
  | 'null'
  | 'numero'
  | 'NaN'
  | 'Infinity'
  | '-Infinity'
  | 'invalido:NaN'
  | 'invalido:Infinity'
  | 'invalido:-Infinity'
  | 'omitido'
  | 'texto'
  | 'booleano'
  | 'lista'
  | 'objeto';

export interface ValorComparado {
  tipo: TipoValor;
  /** só para número finito, texto e booleano; listas dão o tamanho */
  valor?: number | string | boolean;
  tamanho?: number;
}

export interface Diferenca {
  caminho: string;
  tipo: 'tipo' | 'valor' | 'numero-na-tolerancia' | 'numero-fora-da-tolerancia';
  original: ValorComparado;
  reproduzido: ValorComparado;
  /** o caminho é (ou contém) um campo de decisão */
  decisao: boolean;
}

export interface ResultadoReproducao {
  identidade: string;
  idJogo: string;
  revisao: number;
  /** marcas herdadas da F1.1 (ex.: cronologiaNaoComprovada) */
  marcas: string[];
  buildPedido: BuildPedido;
  buildUsado: BuildUsado | null;
  ambiente: Ambiente | null;
  localidadeRelevante: boolean | null;
  relogio: { valor: string | null; origem: 'calculadoEm' | 'substituido-em-teste' };
  shaEntrada: string | null;
  hashOriginal: string;
  hashReproduzido: string | null;
  /** SHA-256 do conteúdo reproduzido (canônico), gravado em conteudos/<sha>.json */
  shaConteudoReproduzido: string | null;
  classe: Classe;
  subcausa: Subcausa | null;
  motivo: string;
  diferencasTotal: number;
  diferencasDecisao: number;
  diferencas: Diferenca[];
  /** quando passa de LIMITE_DIFERENCAS: contagem por prefixo (dois níveis) */
  diferencasPorPrefixo: Record<string, number>;
  falha: { mensagem: string; codigoSaida: number | null; registro: string | null } | null;
  /** naturalmente variável: fora da comparação de determinismo */
  duracaoMs: number;
}

export interface Manifesto {
  contrato: number;
  execucaoId: string;
  iniciadaEm: string;
  concluidaEm: string;
  entradas: number;
  porClasse: Record<string, number>;
  porSubcausa: Record<string, number>;
  /** SHA-256 das identidades de entrada (ordenadas) */
  impressaoEntradas: string;
  /** SHA-256 dos resultados canônicos sem os campos variáveis (duracaoMs) */
  impressaoResultados: string;
}
