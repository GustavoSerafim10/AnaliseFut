/**
 * Contrato da bancada (Fase 1, F1.1): o que ela lê, o que entrega e como registra o que fica de
 * fora. Só leitura: nada aqui grava no site, no motor, no Ledger nem nos dados da Fase 0.
 */

/** Versão deste contrato; vai em toda saída. Mudou a forma da saída, sobe a versão. */
export const VERSAO_CONTRATO = 1;

/** Formatos de backup reconhecidos. */
export type FormatoBackup =
  /** .json.gz versão 3 (Fase 0): histórico + revisões de evidência, SHA-256 por revisão */
  | 'v3-gz'
  /** .json versão 2: histórico + evidências opcionais */
  | 'v2-json'
  /** .json antigo, sem "versao": só histórico — formato anterior à estrutura de evidências */
  | 'v1-json';

/** Um arquivo lido (ou recusado). */
export interface FonteLida {
  nome: string;
  /** SHA-256 dos bytes do arquivo, para rastrear de onde veio cada registro */
  sha256: string;
  formato: FormatoBackup | null;
  exportadoEm: string | null;
  /**
   * false no v1: o formato é anterior à estrutura de evidências — ausência de evidência é do
   * formato, NÃO evidência perdida
   */
  suportaEvidencias: boolean;
  /** v3 com cabeçalho "indisponiveis": o aparelho exportou sem evidências (banco não abriu) */
  evidenciasIndisponiveisNaOrigem: boolean;
  recusada: boolean;
  motivosRecusa: string[];
}

/** Por que um registro não virou registro canônico. Nada some sem uma destas. */
export type CategoriaExclusao =
  /** o arquivo inteiro foi recusado (formato, JSON, gzip, SHA, rodapé...) */
  | 'fonte-recusada'
  /** item de "historico" sem a forma mínima de uma análise */
  | 'entrada-malformada'
  /** item de "evidencias" (v2) sem a forma de uma revisão */
  | 'evidencia-malformada'
  /** revisão de evidência sem entrada do histórico com o mesmo id */
  | 'evidencia-orfa'
  /** revisão com esquema diferente do conhecido */
  | 'esquema-desconhecido'
  /** análise sem times ou sem horário de início: não dá para formar o jogo */
  | 'jogo-sem-chave';

export interface Exclusao {
  categoria: CategoriaExclusao;
  /** nome do arquivo de origem */
  fonte: string;
  /** identidade do registro (id do histórico, identidade da revisão...), quando houver */
  id: string | null;
  motivo: string;
}

/**
 * Conservação: cada registro físico (como veio em cada arquivo) termina em exatamente uma destas
 * categorias. físicos = canônicos + duplicatas + substituídos + excluídos.
 */
export interface Conservacao {
  fisicos: number;
  canonicos: number;
  /** a mesma identidade já vista em outro arquivo (ou no mesmo): conta uma vez */
  duplicatas: number;
  /** versão mais antiga de uma entrada do histórico que mudou entre backups (rastreada) */
  substituidos: number;
  excluidos: number;
}
