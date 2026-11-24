/**
 * F1.2a — suíte lenta, com builds REAIS na área isolada (%LOCALAPPDATA%\pe-bancada\):
 *  1. evidência de 8964bf4 reproduzida pelo código e ferramental de 8964bf4 → original-exata
 *  2. o mesmo com relógio depois do apito → divergente (prova de que o relógio é respeitado)
 *  4. commit inexistente → commit-ausente
 *  5. commit anterior à Fase 0 (7e2f57e) → api-ausente, sem instalar nada
 * 10. isolamento: o repositório principal fica intacto
 * 11. determinismo: duas execuções reais iguais
 *
 * A evidência é gerada com o código da árvore atual, que é IDÊNTICO ao de 8964bf4 em apps/,
 * packages/ e no lockfile (conferido no beforeAll).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prepararArea, raizPadrao, raizRepositorio, type Area } from '../src/reproducao/area';
import { ProvedorGit } from '../src/reproducao/build';
import { ARQUIVO_HARNESS, ExecutorProcesso } from '../src/reproducao/executor';
import { reproduzir, semVariaveis, type OpcoesReproducao } from '../src/reproducao/reproduzir';
import type { Evidencia } from '../../../apps/web/src/evidencias';
import {
  buildGravado,
  evidenciaReproduzivel,
  instantaneoRepositorio,
  shaCompleto,
} from '../test/fixtures/reproducao';

const antes = instantaneoRepositorio();
const repo = raizRepositorio();
let area: Area;
let opcoes: OpcoesReproducao;
let c8964: string;
let ev: Evidencia;

beforeAll(async () => {
  c8964 = shaCompleto('8964bf4');
  // a evidência sintética só vale como "gravada em 8964bf4" se o código for o mesmo
  execFileSync(
    'git',
    [
      '-C',
      repo,
      'diff',
      '--quiet',
      c8964,
      '--',
      'apps',
      'packages',
      'package.json',
      'package-lock.json',
    ],
    { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
  );
  area = prepararArea(raizPadrao());
  opcoes = {
    area,
    provedor: new ProvedorGit(repo, area.builds),
    executor: new ExecutorProcesso(),
  };
  ev = await evidenciaReproduzivel(buildGravado(c8964));
});

const execucoes: string[] = [];
afterAll(() => {
  for (const p of execucoes) rmSync(p, { recursive: true, force: true });
});

describe('build real', () => {
  it('teste 1: 8964bf4 reproduz a própria evidência → original-exata, com ambiente registrado', async () => {
    const { resultados, pasta } = await reproduzir([{ evidencia: ev }], opcoes);
    execucoes.push(pasta);
    const r = resultados[0];
    expect(r.falha).toBeNull();
    expect(r).toMatchObject({
      classe: 'original-exata',
      subcausa: null,
      hashReproduzido: ev.meta.hash,
    });
    expect(r.buildUsado).toMatchObject({ commit: c8964 });
    expect(r.buildUsado?.shaLockfile).toMatch(/^[0-9a-f]{64}$/);
    expect(r.buildUsado?.hashDependencias).toMatch(/^[0-9a-f]{64}$/);
    expect(r.buildUsado?.npm).toMatch(/^\d+\.\d+\.\d+/);
    expect(r.ambiente).toMatchObject({
      fuso: 'America/Sao_Paulo',
      deslocamentoMin: 180,
      plataforma: process.platform,
      arquitetura: process.arch,
    });
    expect(r.ambiente?.node).toBe(process.versions.node);
    expect(r.localidadeRelevante).toBe(true);
    // o harness só existe dentro do build isolado
    const fonte = join(area.builds, c8964, 'fonte');
    expect(existsSync(join(fonte, ARQUIVO_HARNESS))).toBe(true);
    expect(existsSync(join(repo, ARQUIVO_HARNESS))).toBe(false);
    console.info(
      '[F1.2a] ambiente',
      JSON.stringify(r.ambiente),
      'build',
      JSON.stringify(r.buildUsado),
      `${r.duracaoMs} ms`,
    );
  });

  it('teste 2: relógio depois do apito → original-divergente na decisão', async () => {
    const depois = new Date(Date.parse(ev.conteudo.jogo.inicio) + 60_000).toISOString();
    const { resultados, pasta } = await reproduzir([{ evidencia: ev }], {
      ...opcoes,
      substituirRelogioEmTeste: depois,
    });
    execucoes.push(pasta);
    expect(resultados[0].classe).toBe('original-divergente');
    expect(
      resultados[0].diferencas.some((d) => d.caminho === 'avaliacao.v4.decisao' && d.decisao),
    ).toBe(true);
  });

  it('teste 4: commit inexistente → commit-ausente', async () => {
    const fantasma = await evidenciaReproduzivel(buildGravado('f'.repeat(40)));
    const { resultados, pasta } = await reproduzir([{ evidencia: fantasma }], opcoes);
    execucoes.push(pasta);
    expect(resultados[0]).toMatchObject({ classe: 'nao-reproduzivel', subcausa: 'commit-ausente' });
  });

  it('teste 5: commit anterior à Fase 0 → api-ausente, sem instalar dependências', async () => {
    const c7e2 = shaCompleto('7e2f57e');
    const antiga = await evidenciaReproduzivel(buildGravado(c7e2));
    const { resultados, pasta } = await reproduzir([{ evidencia: antiga }], opcoes);
    execucoes.push(pasta);
    expect(resultados[0]).toMatchObject({ subcausa: 'api-ausente' });
    expect(resultados[0].motivo).toContain('evidencias.ts');
    expect(existsSync(join(area.builds, c7e2, 'fonte', 'node_modules'))).toBe(false);
  });

  it('teste 11: duas execuções reais iguais (fora a duração)', async () => {
    const a = await reproduzir([{ evidencia: ev }], opcoes);
    const b = await reproduzir([{ evidencia: ev }], opcoes);
    execucoes.push(a.pasta, b.pasta);
    expect(b.resultados.map(semVariaveis)).toEqual(a.resultados.map(semVariaveis));
    expect(b.manifesto.impressaoResultados).toBe(a.manifesto.impressaoResultados);
    const sha = a.resultados[0].shaConteudoReproduzido!;
    expect(readFileSync(join(b.pasta, 'conteudos', `${sha}.json`), 'utf8')).toBe(
      readFileSync(join(a.pasta, 'conteudos', `${sha}.json`), 'utf8'),
    );
  });

  it('teste 10: repositório principal intacto depois de tudo', () => {
    expect(instantaneoRepositorio()).toEqual(antes);
  });
});
