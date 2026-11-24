/**
 * Fixtures da reprodução (F1.2a), todas sintéticas e feitas com as funções reais:
 *  - evidência gravada com o relógio parado em calculadoEm.inicio (como o App faz ao calcular);
 *  - provedor de build falso e executor no próprio processo (suíte rápida, sem instalar nada);
 *  - instantâneo do repositório principal para provar o isolamento.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';
import { derivar } from '../../../../apps/web/src/dados';
import type { Rascunho } from '../../../../apps/web/src/estado';
import {
  canonico,
  impressaoDigital,
  montarConteudo,
  montarEvidencia,
  type Evidencia,
} from '../../../../apps/web/src/evidencias';
import { rascunhoExemplo } from '../../../../apps/web/src/exemplo';
import { prepararArea, raizPadrao, raizRepositorio, type Area } from '../../src/reproducao/area';
import type { BuildPreparado, Preparo, ProvedorBuild } from '../../src/reproducao/build';
import type { Executor, SaidaExecucao } from '../../src/reproducao/executor';
import { executarNucleo, type ModulosBuild } from '../../src/reproducao/harness/zz-bancada-nucleo';
import { AGORA } from './geradores';

export const COMMIT_8964 = '8964bf4';

export const shaCompleto = (curto: string) =>
  execFileSync('git', ['-C', raizRepositorio(), 'rev-parse', `${curto}^{commit}`], {
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  }).trim();

export const buildGravado = (
  commit: string,
  extra: Partial<Evidencia['meta']['build']> = {},
): Evidencia['meta']['build'] => ({
  commit,
  commitData: '2026-11-23T00:00:00-03:00',
  construidoEm: '2026-11-23T00:00:00.000Z',
  origem: 'git-local',
  alteracoesLocais: false,
  ...extra,
});

/** Evidência como o App grava: relógio parado em calculadoEm.inicio durante o derivar(). */
export async function evidenciaReproduzivel(
  build: Evidencia['meta']['build'],
  ajustar: (r: Rascunho) => Rascunho = (r) => r,
): Promise<Evidencia> {
  vi.useFakeTimers({ now: AGORA, toFake: ['Date'] });
  try {
    const r = ajustar({ ...rascunhoExemplo(), idHistorico: 'jogo-r' });
    const inicio = new Date().toISOString();
    const d = derivar(r);
    const e = await montarEvidencia(
      'jogo-r',
      r,
      d,
      { calculadoEm: { inicio, fim: inicio } },
      build,
      inicio,
    );
    return { ...e, meta: { ...e.meta, revisao: 1 } };
  } finally {
    vi.useRealTimers();
  }
}

/** Mesma evidência com o conteúdo alterado e o hash RECALCULADO (continua íntegra). */
export async function comConteudo(
  ev: Evidencia,
  f: (c: Evidencia['conteudo']) => void,
): Promise<Evidencia> {
  const x = structuredClone(ev);
  f(x.conteudo);
  return { ...x, meta: { ...x.meta, hash: await impressaoDigital(x.conteudo) } };
}

export const modulosAtuais = async (): Promise<ModulosBuild> => ({
  derivar,
  montarConteudo,
  canonico,
  impressaoDigital,
});

export class ProvedorFalso implements ProvedorBuild {
  chamadas: string[] = [];
  constructor(
    private readonly commits: string[],
    private readonly extra: Partial<BuildPreparado> = {},
  ) {}
  async preparar(commit: string): Promise<Preparo> {
    this.chamadas.push(commit);
    if (!this.commits.includes(commit))
      return {
        ok: false,
        subcausa: 'commit-ausente',
        motivo: `commit ${commit} não existe (provedor falso)`,
      };
    return {
      ok: true,
      build: {
        commit,
        fonte: '(em processo)',
        shaLockfile: 'falso',
        hashDependencias: null,
        npm: null,
        localidadeRelevante: true,
        ...this.extra,
      },
    };
  }
}

/**
 * Executor no próprio processo, com os módulos atuais (idênticos ao build de 8964bf4 em
 * apps/ e packages/). `alterar` simula um build que calcula diferente.
 */
export class ExecutorEmProcesso implements Executor {
  constructor(
    private readonly o: {
      alterar?: (conteudo: Record<string, unknown>) => void;
      carregar?: () => Promise<ModulosBuild>;
    } = {},
  ) {}
  async executar(
    _b: BuildPreparado,
    e: Parameters<Executor['executar']>[1],
  ): Promise<SaidaExecucao> {
    const s = await executarNucleo(e, {
      carregar: this.o.carregar ?? modulosAtuais,
      fixarRelogio: (ms) => vi.useFakeTimers({ now: ms, toFake: ['Date'] }),
      liberarRelogio: () => vi.useRealTimers(),
    });
    if (s.status !== 'ok' || !this.o.alterar) return { tipo: 'saida', saida: s };
    const c = JSON.parse(s.conteudoCanonico) as Record<string, unknown>;
    this.o.alterar(c);
    return {
      tipo: 'saida',
      saida: { ...s, conteudoCanonico: canonico(c), hash: await impressaoDigital(c as never) },
    };
  }
}

/** Área de teste descartável dentro da área isolada (nunca no repositório). */
export function areaDeTeste(): Area {
  const base = join(raizPadrao(), 'testes');
  prepararArea(raizPadrao());
  const raiz = mkdtempSync(join(prepararArea(base).raiz, 't-'));
  return prepararArea(raiz);
}

/** Estado do repositório principal: tudo o que uma escrita indevida mudaria. */
export function instantaneoRepositorio() {
  const repo = raizRepositorio();
  const g = (args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
  return {
    head: g(['rev-parse', 'HEAD']),
    status: g(['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']),
    refs: g(['for-each-ref', '--format=%(refname) %(objectname)']),
    worktrees: g(['worktree', 'list', '--porcelain']),
    stash: g(['stash', 'list']),
  };
}
