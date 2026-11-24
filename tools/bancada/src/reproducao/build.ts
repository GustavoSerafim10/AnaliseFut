/**
 * Build original de cada revisão: elegibilidade pelo meta.build gravado, código pelo
 * `git archive` (só leitura do repositório: nenhuma ref, worktree ou fetch) e dependências por
 * `npm ci --ignore-scripts` com o lockfile DAQUELE commit (D2). Tudo na área isolada, com cache
 * por commit; o build.json só é gravado quando a preparação termina inteira.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BuildPedido, BuildUsado, Subcausa } from './contrato';
import { ambienteFilho, executarProcesso } from './processo';

export const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

export function elegibilidade(b: BuildPedido): { ok: true } | { ok: false; motivo: string } {
  if (typeof b.commit !== 'string' || !/^[0-9a-f]{40}$/.test(b.commit))
    return { ok: false, motivo: 'build sem commit identificável (origem desconhecida)' };
  if (b.origem === 'github-actions') return { ok: true };
  if (b.origem === 'git-local' && b.alteracoesLocais === false) return { ok: true };
  if (b.origem === 'git-local')
    return {
      ok: false,
      motivo: `build local com alterações não commitadas (alteracoesLocais: ${String(b.alteracoesLocais)}): o código não é exatamente o do commit`,
    };
  return { ok: false, motivo: `origem de build não reconhecida: ${String(b.origem)}` };
}

export interface BuildPreparado extends BuildUsado {
  /** pasta com o código do commit e as dependências */
  fonte: string;
  /** os arquivos do motor/site usam localeCompare/Intl sem localidade explícita */
  localidadeRelevante: boolean;
}

export type Preparo =
  { ok: true; build: BuildPreparado } | { ok: false; subcausa: Subcausa; motivo: string };

export interface ProvedorBuild {
  preparar(commit: string): Promise<Preparo>;
}

const git = (repo: string, args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });

const npmCli = () => join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');

export class ProvedorGit implements ProvedorBuild {
  constructor(
    private readonly repositorio: string,
    private readonly pastaBuilds: string,
    private readonly o: { tempoInstalacaoMs?: number } = {},
  ) {}

  async preparar(commit: string): Promise<Preparo> {
    try {
      git(this.repositorio, ['cat-file', '-e', `${commit}^{commit}`]);
    } catch {
      return {
        ok: false,
        subcausa: 'commit-ausente',
        motivo: `commit ${commit} não existe no repositório local (clone da origem não habilitado na F1.2a)`,
      };
    }
    const dir = join(this.pastaBuilds, commit);
    const fonte = join(dir, 'fonte');
    const registro = join(dir, 'build.json');
    if (existsSync(registro) && existsSync(fonte))
      return JSON.parse(readFileSync(registro, 'utf8')) as Preparo;

    // tentativa anterior incompleta: recomeça do zero
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(fonte, { recursive: true });
    git(this.repositorio, ['archive', '--format=tar', '-o', join(dir, 'fonte.tar'), commit]);
    // caminho relativo: o tar do Git Bash leria "C:" como host remoto
    execFileSync('tar', ['-xf', '../fonte.tar'], { cwd: fonte, stdio: 'ignore' });
    rmSync(join(dir, 'fonte.tar'), { force: true });

    const fim = (p: Preparo) => {
      writeFileSync(registro, JSON.stringify(p, null, 1));
      return p;
    };
    const api = verificarApi(fonte);
    if (api) return fim({ ok: false, subcausa: 'api-ausente', motivo: api });

    const lock = join(fonte, 'package-lock.json');
    if (!existsSync(lock))
      return fim({
        ok: false,
        subcausa: 'dependencias-indisponiveis',
        motivo: 'commit sem package-lock.json',
      });
    const env = { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' };
    const inst = await executarProcesso(
      process.execPath,
      [npmCli(), 'ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'],
      { cwd: fonte, env, tempoLimiteMs: this.o.tempoInstalacaoMs ?? 15 * 60_000 },
    );
    if (inst.codigo !== 0) {
      // sem build.json: a próxima tentativa refaz; o motivo vai no resultado
      writeFileSync(join(dir, 'instalacao.log'), `${inst.saida}\n${inst.erro}`);
      return {
        ok: false,
        subcausa: 'dependencias-indisponiveis',
        motivo: inst.tempoEsgotado
          ? 'npm ci passou do tempo limite'
          : `npm ci --ignore-scripts falhou (código ${inst.codigo}); ver builds/${commit}/instalacao.log. Política: sem scripts de instalação até avaliação`,
      };
    }
    const npm = execFileSync(process.execPath, [npmCli(), '--version'], {
      encoding: 'utf8',
    }).trim();
    const ls = await executarProcesso(process.execPath, [npmCli(), 'ls', '--all', '--json'], {
      cwd: fonte,
      env: ambienteFilho({}),
      tempoLimiteMs: 120_000,
    });
    return fim({
      ok: true,
      build: {
        commit,
        fonte,
        shaLockfile: sha256(readFileSync(lock)),
        hashDependencias: ls.saida ? sha256(ls.saida) : null,
        npm,
        localidadeRelevante: usaLocalidadeNoCodigo(fonte),
      },
    });
  }
}

/** Antes de instalar: o build tem as funções que o harness usa? (commits anteriores à Fase 0 não) */
export function verificarApi(fonte: string): string | null {
  const ev = join(fonte, 'apps', 'web', 'src', 'evidencias.ts');
  const dados = join(fonte, 'apps', 'web', 'src', 'dados.ts');
  if (!existsSync(ev)) return 'o build não tem apps/web/src/evidencias.ts (anterior à Fase 0)';
  if (!existsSync(dados)) return 'o build não tem apps/web/src/dados.ts';
  const t = readFileSync(ev, 'utf8');
  const faltam = ['montarConteudo', 'canonico', 'impressaoDigital'].filter(
    (f) => !new RegExp(`export (async )?function ${f}\\b`).test(t),
  );
  if (!/export function derivar\b/.test(readFileSync(dados, 'utf8'))) faltam.push('derivar');
  return faltam.length ? `o build não exporta: ${faltam.join(', ')}` : null;
}

/** O código do site/motor usa localidade padrão (localeCompare/Intl/toLocale sem 'pt-BR')? */
export function usaLocalidadeNoCodigo(fonte: string): boolean {
  const saida = (() => {
    try {
      return execFileSync(
        'git',
        [
          'grep',
          '--no-index',
          '-l',
          '-E',
          'localeCompare\\([^,)]*\\)|toLocale[A-Za-z]*\\(\\)|new Intl\\.[A-Za-z]+\\(\\)',
          '--',
          'apps/web/src',
          'packages',
        ],
        { cwd: fonte, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch {
      return '';
    }
  })();
  return saida.trim().length > 0;
}
