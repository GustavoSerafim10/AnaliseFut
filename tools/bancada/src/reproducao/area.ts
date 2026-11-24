/**
 * Área isolada da reprodução (D5): %LOCALAPPDATA%\pe-bancada\ — nunca dentro do repositório.
 * builds/<commit>/   código do commit (git archive) + dependências instaladas (cache)
 * execucoes/<id>/    entradas, saídas, conteúdos reproduzidos, resultados e manifesto
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do repositório principal (só leitura: nunca escrevemos nele). */
export function raizRepositorio(): string {
  const aqui = fileURLToPath(new URL('.', import.meta.url));
  return resolve(
    execFileSync('git', ['-C', aqui, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    }).trim(),
  );
}

export function raizPadrao(): string {
  const base = process.env.LOCALAPPDATA;
  if (!base) throw new Error('LOCALAPPDATA não definido: informe a área isolada explicitamente');
  return join(base, 'pe-bancada');
}

/** Garante que o caminho está FORA do repositório; devolve o caminho absoluto. */
export function garantirForaDoRepositorio(
  caminho: string,
  repositorio = raizRepositorio(),
): string {
  const abs = resolve(caminho);
  const rel = relative(repositorio, abs);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    throw new Error(`área isolada dentro do repositório (${abs}): recusado`);
  return abs;
}

export interface Area {
  raiz: string;
  builds: string;
  execucoes: string;
}

export function prepararArea(raiz = raizPadrao(), repositorio = raizRepositorio()): Area {
  const r = garantirForaDoRepositorio(raiz, repositorio);
  const a = { raiz: r, builds: join(r, 'builds'), execucoes: join(r, 'execucoes') };
  mkdirSync(a.builds, { recursive: true });
  mkdirSync(a.execucoes, { recursive: true });
  return a;
}
