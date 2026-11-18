/**
 * Versão do build, lida de fontes reais no momento do build (nunca de um selo da tela):
 * - GitHub Actions: GITHUB_SHA (o commit que o deploy publica) e a data desse commit pelo git;
 * - máquina local: `git rev-parse HEAD`, avisando se havia alteração sem commit;
 * - sem nenhuma das duas: versão desconhecida (commit null), dito com todas as letras.
 */
import { execSync } from 'node:child_process';
import process from 'node:process';

const git = (args) => {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

export function versaoBuild() {
  const construidoEm = new Date().toISOString();
  const doActions = process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_SHA;
  const commit = doActions ? process.env.GITHUB_SHA : git('rev-parse HEAD');
  if (!commit || !/^[0-9a-f]{40}$/.test(commit))
    return {
      commit: null,
      commitData: null,
      construidoEm,
      origem: 'desconhecida',
      alteracoesLocais: null,
    };
  const status = doActions ? '' : git('status --porcelain');
  return {
    commit,
    commitData: git(`log -1 --format=%cI ${commit}`),
    construidoEm,
    origem: doActions ? 'github-actions' : 'git-local',
    // build local com arquivos alterados não é exatamente o commit: fica registrado
    alteracoesLocais: doActions ? false : status === null ? null : status.length > 0,
  };
}
