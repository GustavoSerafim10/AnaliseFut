/**
 * Apoio da suíte real (F1.2a, correção): a evidência demonstrativa nasce DENTRO do build
 * histórico, e a identidade desse build é conferida contra o commit — sem olhar a árvore de
 * trabalho, que pode ter alterações pendentes no site.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Evidencia } from '../../../apps/web/src/evidencias';
import type { BuildPreparado } from '../src/reproducao/build';
import { FUSO_ESPERADO, LOCALIDADE_ESPERADA } from '../src/reproducao/contrato';
import { ambienteFilho, executarProcesso } from '../src/reproducao/processo';

const GERADOR = fileURLToPath(new URL('./zz-bancada-gerador.ts', import.meta.url));
export const ARQUIVO_GERADOR = 'apps/web/test/zz-bancada-gerador.test.ts';

/** Áreas cujo conteúdo define o cálculo: as mesmas que a guarda antiga comparava. */
export const ESCOPO_IDENTIDADE = ['apps', 'packages', 'package.json', 'package-lock.json'];

const git = (repo: string, args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });

/**
 * Blob de cada arquivo do build calculado PELO PRÓPRIO GIT, como ele faria ao versioná-lo
 * (mesmos filtros e atributos do repositório: com core.autocrlf, o git archive grava CRLF e
 * o git o desfaz aqui). Nada é normalizado à mão. Só leitura: hash-object sem -w.
 */
function blobsDoBuild(repo: string, fonte: string, caminhos: string[]): string[] {
  if (!caminhos.length) return [];
  const saida = execFileSync(
    'git',
    ['--git-dir', join(repo, '.git'), '--work-tree', '.', 'hash-object', '--stdin-paths'],
    {
      cwd: fonte,
      input: `${caminhos.join('\n')}\n`,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    },
  );
  return saida.split('\n').filter(Boolean);
}

export interface Identidade {
  conferidos: number;
  /** arquivo do commit com conteúdo diferente no build */
  divergentes: string[];
  /** arquivo do commit que não está no build */
  ausentes: string[];
  /** arquivo-fonte (src/) no build que não existe no commit */
  intrusos: string[];
}

/**
 * Confere o build isolado contra o commit: todo arquivo rastreado em ESCOPO_IDENTIDADE tem de
 * existir com o mesmo blob, e nenhuma pasta src/ do site ou dos pacotes pode ter arquivo a mais.
 * (O harness e o gerador entram em apps/web/test, fora de src/; node_modules é do npm ci.)
 */
export function conferirIdentidade(repo: string, commit: string, fonte: string): Identidade {
  const linhas = git(repo, ['ls-tree', '-r', commit, '--', ...ESCOPO_IDENTIDADE])
    .split('\n')
    .filter(Boolean);
  const esperado = new Map<string, string>();
  for (const l of linhas) {
    const [info, caminho] = l.split('\t');
    esperado.set(caminho, info.split(' ')[2]);
  }
  const r: Identidade = { conferidos: 0, divergentes: [], ausentes: [], intrusos: [] };
  const presentes: string[] = [];
  for (const caminho of esperado.keys())
    if (existsSync(join(fonte, caminho))) presentes.push(caminho);
    else r.ausentes.push(caminho);
  const blobs = blobsDoBuild(repo, fonte, presentes);
  if (blobs.length !== presentes.length)
    throw new Error(
      `git hash-object devolveu ${blobs.length} blobs para ${presentes.length} arquivos`,
    );
  presentes.forEach((caminho, i) => {
    r.conferidos++;
    if (blobs[i] !== esperado.get(caminho)) r.divergentes.push(caminho);
  });
  const fontes = [join(fonte, 'apps', 'web', 'src')];
  const pacotes = join(fonte, 'packages');
  if (existsSync(pacotes))
    for (const p of readdirSync(pacotes)) fontes.push(join(pacotes, p, 'src'));
  const andar = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) andar(f);
      else {
        const rel = relative(fonte, f).split(sep).join('/');
        if (!esperado.has(rel)) r.intrusos.push(rel);
      }
    }
  };
  fontes.forEach(andar);
  return r;
}

export const shaCompleto = (repo: string, curto: string) =>
  git(repo, ['rev-parse', `${curto}^{commit}`]).trim();

/** Estado do repositório principal: tudo o que uma escrita indevida mudaria. */
export function instantaneoRepositorio(repo: string) {
  return {
    head: git(repo, ['rev-parse', 'HEAD']),
    status: git(repo, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
    refs: git(repo, ['for-each-ref', '--format=%(refname) %(objectname)']),
    worktrees: git(repo, ['worktree', 'list', '--porcelain']),
    stash: git(repo, ['stash', 'list']),
  };
}

/** A árvore de trabalho difere do commit em ESCOPO_IDENTIDADE? (só informativo) */
export function arvoreDifereDo(repo: string, commit: string): boolean {
  try {
    git(repo, ['diff', '--quiet', commit, '--', ...ESCOPO_IDENTIDADE]);
    return false;
  } catch {
    return true;
  }
}

/** build.meta da evidência gerada: o commit exato, sem alterações locais (o código é o do archive). */
export function buildDoCommit(repo: string, commit: string, construidoEm: string) {
  return {
    commit,
    commitData: git(repo, ['log', '-1', '--format=%cI', commit]).trim(),
    construidoEm,
    origem: 'git-local' as const,
    alteracoesLocais: false,
  };
}

/** Roda o gerador no build histórico e devolve a evidência que ele gravou. */
export async function gerarEvidenciaNoBuild(
  b: BuildPreparado,
  pedido: { idJogo: string; relogio: string; build: Evidencia['meta']['build'] },
  pasta: string,
): Promise<{ evidencia: Evidencia; origem: Record<string, string> }> {
  mkdirSync(pasta, { recursive: true });
  const arqPedido = join(pasta, 'pedido.json');
  const saida = join(pasta, 'evidencia.json');
  writeFileSync(arqPedido, JSON.stringify(pedido));
  copyFileSync(GERADOR, join(b.fonte, ARQUIVO_GERADOR));
  const r = await executarProcesso(
    process.execPath,
    [
      join(b.fonte, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      ARQUIVO_GERADOR,
      '--reporter=dot',
    ],
    {
      cwd: b.fonte,
      tempoLimiteMs: 120_000,
      env: ambienteFilho({
        TZ: FUSO_ESPERADO,
        LANG: `${LOCALIDADE_ESPERADA.replace('-', '_')}.UTF-8`,
        LC_ALL: `${LOCALIDADE_ESPERADA.replace('-', '_')}.UTF-8`,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        PE_BANCADA_PEDIDO: arqPedido,
        PE_BANCADA_SAIDA: saida,
      }),
    },
  );
  if (!existsSync(saida))
    throw new Error(
      `o gerador não gravou a evidência (código ${String(r.codigo)}, tempo esgotado: ${r.tempoEsgotado})\n${r.erro.slice(-3000)}`,
    );
  return JSON.parse(readFileSync(saida, 'utf8')) as {
    evidencia: Evidencia;
    origem: Record<string, string>;
  };
}
