/**
 * F1.2a — suíte lenta, com builds REAIS na área isolada (%LOCALAPPDATA%\pe-bancada\):
 *  0. identidade do build: cada arquivo de apps/, packages/ e do lockfile no build isolado tem
 *     o mesmo blob do commit, e nenhuma pasta src/ tem arquivo a mais (e isso detecta adulteração)
 *  1. evidência GERADA DENTRO do build de 8964bf4 (código e vitest daquele commit) e reproduzida
 *     por ele → original-exata
 *  2. o mesmo com relógio depois do apito → divergente (prova de que o relógio é respeitado)
 *  4. commit inexistente → commit-ausente
 *  5. commit anterior à Fase 0 (7e2f57e) → api-ausente, sem instalar nada
 * 10. isolamento: o repositório principal fica intacto
 * 11. determinismo: duas execuções reais iguais
 *
 * Nada aqui depende da árvore de trabalho ser igual a 8964bf4: ela pode ter alterações
 * pendentes no site. A evidência e a reprodução usam só o build isolado.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Evidencia } from '../../../apps/web/src/evidencias';
import { prepararArea, raizPadrao, raizRepositorio, type Area } from '../src/reproducao/area';
import { ProvedorGit, type BuildPreparado } from '../src/reproducao/build';
import { ARQUIVO_HARNESS, ExecutorProcesso } from '../src/reproducao/executor';
import { reproduzir, semVariaveis, type OpcoesReproducao } from '../src/reproducao/reproduzir';
import {
  ARQUIVO_GERADOR,
  arvoreDifereDo,
  buildDoCommit,
  conferirIdentidade,
  gerarEvidenciaNoBuild,
  instantaneoRepositorio,
  shaCompleto,
  type Identidade,
} from './gerador';

const repo = raizRepositorio();
const antes = instantaneoRepositorio(repo);
/** relógio da evidência demonstrativa: o jogo de exemplo começa 3 h depois */
const RELOGIO = '2026-11-18T15:00:00.000Z';
let area: Area;
let opcoes: OpcoesReproducao;
let c8964: string;
let build: BuildPreparado;
let identidade: Identidade;
let ev: Evidencia;
let origem: Record<string, string>;
const temporarios: string[] = [];

/** a mesma evidência apontando para outro build (meta.build fica fora do hash do conteúdo) */
const comCommit = (commit: string): Evidencia => ({
  ...ev,
  meta: { ...ev.meta, build: { ...ev.meta.build, commit } },
});

beforeAll(async () => {
  c8964 = shaCompleto(repo, '8964bf4');
  area = prepararArea(raizPadrao());
  const provedor = new ProvedorGit(repo, area.builds);
  const p = await provedor.preparar(c8964);
  if (!p.ok) throw new Error(`build de 8964bf4 indisponível: ${p.motivo}`);
  build = p.build;
  // a guarda: o build isolado É o commit (substitui a antiga comparação com a árvore de trabalho)
  identidade = conferirIdentidade(repo, c8964, build.fonte);
  if (identidade.divergentes.length || identidade.ausentes.length || identidade.intrusos.length)
    throw new Error(`build isolado não confere com ${c8964}: ${JSON.stringify(identidade)}`);
  const pasta = mkdtempSync(join(area.execucoes, 'gerador-'));
  temporarios.push(pasta);
  ({ evidencia: ev, origem } = await gerarEvidenciaNoBuild(
    build,
    { idJogo: 'jogo-demo', relogio: RELOGIO, build: buildDoCommit(repo, c8964, RELOGIO) },
    pasta,
  ));
  opcoes = { area, provedor, executor: new ExecutorProcesso() };
});

afterAll(() => {
  for (const p of temporarios) rmSync(p, { recursive: true, force: true });
});

describe('build real', () => {
  it('teste 0: o build isolado confere arquivo a arquivo com o commit', () => {
    expect(identidade.conferidos).toBeGreaterThan(200);
    expect(identidade).toMatchObject({ divergentes: [], ausentes: [], intrusos: [] });
  });

  it('teste 0b: a conferência detecta arquivo alterado, removido e intruso', () => {
    const copia = mkdtempSync(join(area.execucoes, 'identidade-'));
    temporarios.push(copia);
    const semDependencias = (s: string) => !/[\\/]node_modules([\\/]|$)/.test(s);
    for (const x of ['apps', 'packages', 'package.json', 'package-lock.json'])
      cpSync(join(build.fonte, x), join(copia, x), { recursive: true, filter: semDependencias });
    expect(conferirIdentidade(repo, c8964, copia)).toMatchObject({
      divergentes: [],
      ausentes: [],
      intrusos: [],
    });
    const v4 = join(copia, 'packages', 'engine', 'src', 'v4.ts');
    writeFileSync(v4, `${readFileSync(v4, 'utf8')}\n// adulterado\n`);
    rmSync(join(copia, 'apps', 'web', 'src', 'exemplo.ts'));
    writeFileSync(join(copia, 'packages', 'engine', 'src', 'intruso.ts'), 'export const x = 1;\n');
    expect(conferirIdentidade(repo, c8964, copia)).toMatchObject({
      divergentes: ['packages/engine/src/v4.ts'],
      ausentes: ['apps/web/src/exemplo.ts'],
      intrusos: ['packages/engine/src/intruso.ts'],
    });
  });

  it('a evidência nasceu no build histórico, não na árvore de trabalho', () => {
    expect(ev.meta.build).toMatchObject({
      commit: c8964,
      origem: 'git-local',
      alteracoesLocais: false,
    });
    expect(ev.meta.calculadoEm.inicio).toBe(RELOGIO);
    // procedência: os três módulos usados pelo gerador resolvem dentro do build isolado
    const dentro = (p: string) =>
      resolve(p)
        .toLowerCase()
        .startsWith(resolve(build.fonte).toLowerCase() + sep);
    expect(Object.keys(origem).sort()).toEqual(['dados', 'evidencias', 'exemplo']);
    for (const [m, p] of Object.entries(origem)) expect(dentro(p), `${m}: ${p}`).toBe(true);
    expect(existsSync(join(build.fonte, ARQUIVO_GERADOR))).toBe(true);
    expect(existsSync(join(repo, ARQUIVO_GERADOR))).toBe(false);
    // informativo: a suíte roda igual com ou sem diferença entre a árvore e 8964bf4
    console.info(`[F1.2a] árvore de trabalho difere de 8964bf4: ${arvoreDifereDo(repo, c8964)}`);
  });

  it('teste 1: 8964bf4 reproduz a própria evidência → original-exata, com ambiente registrado', async () => {
    const { resultados, pasta } = await reproduzir([{ evidencia: ev }], opcoes);
    temporarios.push(pasta);
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
    expect(existsSync(join(build.fonte, ARQUIVO_HARNESS))).toBe(true);
    expect(existsSync(join(repo, ARQUIVO_HARNESS))).toBe(false);
  });

  it('teste 2: relógio depois do apito → original-divergente na decisão', async () => {
    const depois = new Date(Date.parse(ev.conteudo.jogo.inicio) + 60_000).toISOString();
    const { resultados, pasta } = await reproduzir([{ evidencia: ev }], {
      ...opcoes,
      substituirRelogioEmTeste: depois,
    });
    temporarios.push(pasta);
    expect(resultados[0].classe).toBe('original-divergente');
    expect(
      resultados[0].diferencas.some((d) => d.caminho === 'avaliacao.v4.decisao' && d.decisao),
    ).toBe(true);
  });

  it('teste 4: commit inexistente → commit-ausente', async () => {
    const { resultados, pasta } = await reproduzir(
      [{ evidencia: comCommit('f'.repeat(40)) }],
      opcoes,
    );
    temporarios.push(pasta);
    expect(resultados[0]).toMatchObject({ classe: 'nao-reproduzivel', subcausa: 'commit-ausente' });
  });

  it('teste 5: commit anterior à Fase 0 → api-ausente, sem instalar dependências', async () => {
    const c7e2 = shaCompleto(repo, '7e2f57e');
    const { resultados, pasta } = await reproduzir([{ evidencia: comCommit(c7e2) }], opcoes);
    temporarios.push(pasta);
    expect(resultados[0]).toMatchObject({ subcausa: 'api-ausente' });
    expect(resultados[0].motivo).toContain('evidencias.ts');
    expect(existsSync(join(area.builds, c7e2, 'fonte', 'node_modules'))).toBe(false);
  });

  it('teste 11: duas execuções reais iguais (fora a duração)', async () => {
    const a = await reproduzir([{ evidencia: ev }], opcoes);
    const b = await reproduzir([{ evidencia: ev }], opcoes);
    temporarios.push(a.pasta, b.pasta);
    expect(b.resultados.map(semVariaveis)).toEqual(a.resultados.map(semVariaveis));
    expect(b.manifesto.impressaoResultados).toBe(a.manifesto.impressaoResultados);
    const sha = a.resultados[0].shaConteudoReproduzido!;
    expect(readFileSync(join(b.pasta, 'conteudos', `${sha}.json`), 'utf8')).toBe(
      readFileSync(join(a.pasta, 'conteudos', `${sha}.json`), 'utf8'),
    );
  });

  it('teste 10: repositório principal intacto depois de tudo', () => {
    expect(instantaneoRepositorio(repo)).toEqual(antes);
  });
});
