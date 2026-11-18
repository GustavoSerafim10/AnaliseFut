export interface VersaoBuild {
  /** commit completo (40 hex) ou null quando não havia como saber */
  commit: string | null;
  /** data do commit (ISO), pelo git */
  commitData: string | null;
  /** quando o build rodou (ISO) */
  construidoEm: string;
  origem: 'github-actions' | 'git-local' | 'desconhecida';
  /** build local com arquivos alterados sem commit: o código não é exatamente o do commit */
  alteracoesLocais: boolean | null;
}

export function versaoBuild(): VersaoBuild;
