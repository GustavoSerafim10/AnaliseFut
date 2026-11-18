/**
 * Tipos e contratos do Ledger append-only (L1: núcleo puro, sem armazenamento nem interface).
 *
 * Um REGISTRO nunca é editado. Uma correção é um registro NOVO que aponta para o anterior
 * (`corrige`), e uma exclusão é um registro `exclusao`. Cada registro leva o hash do anterior da
 * sua cadeia (encadeamento), então alterar, remover ou reordenar o passado quebra a verificação.
 */
import type { Json } from './json';

/**
 * Versão do FORMATO (campos, serialização canônica e cálculo do hash) dos registros que esta versão
 * ESCREVE. Muda se qualquer um mudar. O esquema de cada tipo está em `ESQUEMA_DO_TIPO`.
 */
export const VERSAO_ESQUEMA_LEDGER = 1;

/**
 * Esquemas que esta versão do código sabe verificar (LER). Os demais ficam "incompatíveis", nunca
 * "ok" e nunca "adulterados", qualquer que seja o tipo do registro.
 */
export const ESQUEMAS_SUPORTADOS: readonly number[] = [1, 2];

/** Os cinco tipos do esquema 1: os únicos que esta versão sabe ESCREVER. */
export type TipoRegistro = 'decisao' | 'aposta_registrada' | 'resultado' | 'correcao' | 'exclusao';

/** Tipos que esta versão só sabe LER e verificar (a escrita ainda não está habilitada). */
export type TipoSomenteLeitura = 'fechamento';

/** Qualquer tipo que o verificador conhece. */
export type TipoDeRegistroLido = TipoRegistro | TipoSomenteLeitura;

/** Os tipos que esta versão ESCREVE (esquema 1). */
export const TIPOS_DE_REGISTRO: readonly TipoRegistro[] = [
  'decisao',
  'aposta_registrada',
  'resultado',
  'correcao',
  'exclusao',
];

/** Os tipos que esta versão só LÊ. */
export const TIPOS_SOMENTE_LEITURA: readonly TipoSomenteLeitura[] = ['fechamento'];

/**
 * O esquema a que cada tipo pertence. Igualdade ESTRITA: um tipo só é válido no seu esquema (um
 * `resultado` com esquema 2, ou um `fechamento` com esquema 1, é registro incoerente). Os cinco tipos
 * do esquema 1 mantêm o esquema 1 e, portanto, o prefixo e os hashes de sempre.
 */
export const ESQUEMA_DO_TIPO: Readonly<Record<TipoDeRegistroLido, number>> = {
  decisao: 1,
  aposta_registrada: 1,
  resultado: 1,
  correcao: 1,
  exclusao: 1,
  fechamento: 2,
};

/** Os tipos válidos de cada esquema conhecido (derivado de `ESQUEMA_DO_TIPO`). */
export const TIPOS_DO_ESQUEMA: Readonly<Record<number, readonly TipoDeRegistroLido[]>> = {
  1: [...TIPOS_DE_REGISTRO],
  2: [...TIPOS_SOMENTE_LEITURA],
};

/** Aponta para um registro da mesma cadeia pelo número e pelo hash (o hash impede apontar para outro). */
export interface RefRegistro {
  seq: number;
  hash: string;
}

export interface CabecalhoLedger {
  /** versão do formato deste registro */
  esquema: number;
  tipo: TipoDeRegistroLido;
  /** identidade da cadeia (um aparelho ou uma origem importada); nunca é fundida com outra */
  cadeia: string;
  /** 1, 2, 3... dentro da cadeia, sem lacunas */
  seq: number;
  /** hash do registro anterior da cadeia; null SÓ no primeiro (gênese) */
  prevHash: string | null;
  /** relógio do aparelho, ISO 8601 com deslocamento (sem carimbo de tempo externo) */
  criadoEm: string;
  /** versão da lógica de decisão no momento (ver versao.ts) */
  versaoMotor: string;
  /** hash da serialização canônica de `politicas` (detecta mudança de limite mesmo sem trocar a versão) */
  impressaoPoliticas: string;
  /** limites, gates e pesos vigentes: auditável sem o código antigo */
  politicas: Json;
  analiseId?: string;
  /** identidade estável do jogo (data + times); ver parsers/evento.ts */
  eventoId?: string;
  /** só em `correcao`: o registro que esta correção contesta, sem apagá-lo */
  corrige?: RefRegistro;
}

/** O que o motor recebeu e o que os dados eram: base da reconstrução. */
export interface SnapshotDados {
  /** as linhas de odds como lidas (casa original, mercado, odd, horário de coleta) */
  odds: Json;
  /** estatísticas consolidadas e apoio do modelo usados */
  estatisticas: Json;
  /** configuração do jogo (liga principal, escalação, desfalques...) */
  contexto: Json;
  /** texto BRUTO de cada print, por nome → hash do blob (o texto fica no armazém de blobs, uma vez só) */
  prints: Record<string, string>;
}

export interface CorpoDecisao {
  /** exatamente o que as funções do motor receberam (inclui `agora`) */
  entradaMotor: { v4: Json | null; lista: Json | null };
  /** resumo comparável da saída (ver reproducao.ts: resumirSaidaDoMotor) */
  saida: Json;
  snapshot: SnapshotDados;
  /** impressão digital da decisão, para não gravar duas vezes a mesma */
  impressao: string;
}

export interface CorpoAposta {
  decisao: RefRegistro | null;
  /** a aposta como o usuário registrou (odd e casa pegas, valor, horário) */
  aposta: Json;
  /** a stake que o motor autorizava naquele momento, com os limites que a cortaram */
  stakeAutorizada: Json;
  /** as travas usadas (saldo do dia e do jogo) */
  travas: Json;
}

export interface CorpoResultado {
  decisao: RefRegistro | null;
  resultado: Json;
}

export interface CorpoCorrecao {
  motivo: string;
  /** o conteúdo correto; o registro corrigido permanece intacto na cadeia */
  novo: Json;
}

export interface CorpoExclusao {
  motivo: string | null;
}

/**
 * ESQUEMA 2, SOMENTE LEITURA. O fechamento das odds de UMA aposta registrada, para o CLV. Vários
 * fechamentos da mesma aposta são permitidos (vale o de maior `seq`); uma correção usa `correcao`.
 * Esta versão verifica registros deste tipo, mas ainda NÃO os escreve.
 */
export interface CorpoFechamento {
  /** a aposta (registro `aposta_registrada` anterior, desta cadeia) a que este fechamento se refere */
  aposta: RefRegistro;
  /** odd de fechamento da referência no lado apostado: finita e maior que 1 */
  oddFechamento: number;
  /** odds de fechamento dos outros lados do mesmo mercado (vazia: CLV cru, sem tirar a margem) */
  fechamentoOutros: number[];
  /** quando o fechamento foi registrado (ISO 8601 com deslocamento) */
  registradoEm: string;
  /** de onde veio a odd de fechamento (texto livre); opcional */
  fonte?: string;
}

export type CorpoLedger =
  CorpoDecisao | CorpoAposta | CorpoResultado | CorpoCorrecao | CorpoExclusao | CorpoFechamento;

export interface RegistroLedger<C extends CorpoLedger = CorpoLedger> {
  cabecalho: CabecalhoLedger;
  corpo: C;
  /** SHA-256 de (prefixo de domínio + serialização canônica de { cabecalho, corpo }) */
  hash: string;
}

/** Blob de conteúdo endereçado pelo hash: texto bruto, sem nenhuma normalização. */
export interface BlobLedger {
  /** SHA-256 hexadecimal dos bytes UTF-8 do texto (verificável com `sha256sum`) */
  hash: string;
  texto: string;
  /** tamanho em bytes UTF-8 */
  bytes: number;
}

// ─────────────── verificação

/** Estado da INTEGRIDADE de uma cadeia (independe da origem e de reprodução). */
export type EstadoCadeia = 'integra' | 'incompleta' | 'adulterada' | 'incompativel';

/** De onde a cadeia veio: a do próprio aparelho ou uma importada (nunca fundidas). */
export type OrigemCadeia = 'local' | 'importada' | 'indeterminada';

export type CodigoProblema =
  | 'esquema_incompativel'
  | 'registro_malformado'
  | 'data_invalida'
  | 'corpo_incompativel'
  | 'correcao_hash_diverge'
  | 'correcao_referencia_ausente'
  | 'decisao_referencia_ausente'
  | 'decisao_hash_diverge'
  | 'decisao_tipo_incorreto'
  | 'decisao_nao_anterior'
  | 'referencia_outra_cadeia'
  | 'fechamento_referencia_ausente'
  | 'fechamento_hash_diverge'
  | 'fechamento_tipo_incorreto'
  | 'fechamento_nao_anterior'
  | 'hash_invalido'
  | 'prevhash_nao_confere'
  | 'genese_com_prevhash'
  | 'seq_duplicada'
  | 'sem_genese'
  | 'lacuna_de_seq'
  | 'continuidade_artificial'
  | 'ancora_ausente'
  | 'ancora_diverge';

export interface Problema {
  codigo: CodigoProblema;
  seq?: number;
  detalhe: string;
}

export interface RelatorioCadeia {
  cadeia: string;
  estado: EstadoCadeia;
  origem: OrigemCadeia;
  total: number;
  primeiroSeq: number | null;
  ultimoSeq: number | null;
  /** hash do último registro presente: é o que se guarda fora do aparelho como âncora */
  hashPonta: string | null;
  problemas: Problema[];
}

export interface RelatorioLedger {
  cadeias: RelatorioCadeia[];
}

/** Um hash da ponta guardado fora do aparelho: prova que o passado até ali não foi refeito. */
export interface AncoraExterna {
  cadeia: string;
  seq: number;
  hash: string;
}

// ─────────────── reprodução

/** Situação da reprodução: NUNCA altera o registro; só relata. */
export type SituacaoReproducao = 'reproduzida' | 'divergente' | 'nao_reproduzivel';

export type CausaReproducao =
  | 'versao_do_motor_diferente'
  | 'politicas_diferentes'
  | 'mesma_versao_e_politicas'
  | 'esquema_incompativel'
  | 'tipo_sem_reproducao'
  | 'registro_sem_entrada'
  | 'erro_ao_executar';

export interface Diferenca {
  caminho: string;
  gravado: Json | undefined;
  recalculado: Json | undefined;
}

export interface ResultadoReproducao {
  situacao: SituacaoReproducao;
  causa?: CausaReproducao;
  versaoGravada: string;
  versaoAtual: string;
  politicasMudaram: boolean;
  /** hash da saída gravada e da recalculada (iguais quando reproduzida) */
  hashSaidaGravada: string | null;
  hashSaidaRecalculada: string | null;
  diferencas: Diferenca[];
  detalhe?: string;
}
