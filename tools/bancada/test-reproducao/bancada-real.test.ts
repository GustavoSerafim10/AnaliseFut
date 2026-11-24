/**
 * F1.2c — suíte real (dados SINTÉTICOS gerados dentro do build isolado de 8964bf4, referência
 * sintética de teste). Ponto de entrada único de arquivos a consolidação, com execução real
 * (git archive, npm ci em cache, vitest do commit em processo filho):
 *  - diagnóstico e execução sobre os mesmos arquivos: toda previsão confirmada
 *  - análise com evidência → reproduzida pela revisão de decisão; sem evidência → reprocessada
 *  - consolidação de produção (sem referência oficial): nada sintético entra
 *  - relatório sem nomes; repositório principal intacto; build idêntico ao commit
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarConjunto, type ArquivoEntrada } from '../src/index';
import { prepararArea, raizPadrao, raizRepositorio, type Area } from '../src/reproducao/area';
import { ProvedorGit, type BuildPreparado } from '../src/reproducao/build';
import { previsaoConfere } from '../src/reproducao/diagnostico';
import { executarBancada, type OpcoesBancada } from '../src/reproducao/executarBancada';
import { ExecutorProcesso } from '../src/reproducao/executor';
import { ExecutorHistoricoProcesso } from '../src/reproducao/executorHistorico';
import { REFERENCIA_TESTE_SINTETICA } from '../src/reproducao/referencia';
import { backupGz, backupV1 } from '../test/fixtures/geradores';
import {
  buildDoCommit,
  conferirIdentidade,
  gerarEvidenciaNoBuild,
  instantaneoRepositorio,
} from './gerador';
import { gerarEntradasNoBuild } from './geradorHistorico';

const T = REFERENCIA_TESTE_SINTETICA;
const RELOGIO = '2026-11-18T15:00:00.000Z';
const repo = raizRepositorio();
const antes = instantaneoRepositorio(repo);
let area: Area;
let build: BuildPreparado;
let provedor: ProvedorGit;
let arquivos: ArquivoEntrada[];
const temporarios: string[] = [];

beforeAll(async () => {
  area = prepararArea(raizPadrao());
  provedor = new ProvedorGit(repo, area.builds);
  const p = await provedor.preparar(T);
  if (!p.ok) throw new Error(`build de teste indisponível: ${p.motivo}`);
  build = p.build;
  const pasta = mkdtempSync(join(area.execucoes, 'gerador-f12c-'));
  temporarios.push(pasta);
  const { evidencia } = await gerarEvidenciaNoBuild(
    build,
    { idJogo: 'jogo-demo', relogio: RELOGIO, build: buildDoCommit(repo, T, RELOGIO) },
    pasta,
  );
  const { entradas } = await gerarEntradasNoBuild(
    build,
    { ids: ['jogo-demo', 'jogo-hist'], relogio: RELOGIO },
    pasta,
  );
  arquivos = [
    { nome: 'sintetico.json.gz', bytes: await backupGz([entradas[0]], [evidencia]) },
    { nome: 'sintetico-v1.json', bytes: backupV1([entradas[1]]) },
  ];
});
afterAll(() => {
  for (const p of temporarios) rmSync(p, { recursive: true, force: true });
});

const execucao = (referenciaDeTeste?: string): OpcoesBancada => ({
  modo: 'execucao',
  area,
  provedor,
  executor: new ExecutorProcesso(),
  executorHistorico: new ExecutorHistoricoProcesso(),
  repositorio: repo,
  referenciaDeTeste,
});

describe('F1.2c com build real', () => {
  it('diagnóstico × execução real: mesma junção, previsões confirmadas, status consolidados', async () => {
    const d = await executarBancada(arquivos, { modo: 'diagnostico', area, referenciaDeTeste: T });
    const x = await executarBancada(arquivos, execucao(T));
    temporarios.push(d.pasta, x.pasta);
    const impressao = (await montarConjunto(arquivos)).impressao;
    expect(d.consolidado.impressaoConjunto).toBe(impressao);
    expect(x.consolidado.impressaoConjunto).toBe(impressao);

    const ef = new Map(x.consolidado.analises.map((a) => [a.idHistorico, a]));
    expect(ef.get('jogo-demo')).toMatchObject({
      status: 'reproduzida',
      fonte: { tipo: 'revisao-de-decisao', revisao: 1 },
    });
    expect(ef.get('jogo-hist')).toMatchObject({
      status: 'reprocessada',
      comparacao: 'concorda',
      referencia: { sha: T, tipo: 'teste-sintetica' },
    });
    for (const a of d.consolidado.analises) {
      expect(a.status).toBe('nao-executado');
      expect(previsaoConfere(a.previsao!, ef.get(a.idHistorico)!), a.idHistorico).toBe(true);
    }
    expect(x.consolidado).toMatchObject({ camada: 'teste-sintetica', modo: 'execucao' });
    expect(x.consolidado.conservacao).toMatchObject({
      entradasCanonicas: 2,
      analisesElegiveis: 2,
      irmas: 0,
      excluidas: 0,
    });
    expect(x.consolidado.impressaoF12).toMatch(/^[0-9a-f]{64}$/);
  });

  it('consolidação de produção sem referência oficial: reprodução original vale; nada sintético entra', async () => {
    const x = await executarBancada(arquivos, execucao());
    temporarios.push(x.pasta);
    expect(x.consolidado.camada).toBe('producao');
    expect(x.consolidado.referencia).toMatchObject({ tipo: 'ausente' });
    const ef = new Map(x.consolidado.analises.map((a) => [a.idHistorico, a]));
    expect(ef.get('jogo-demo')).toMatchObject({ status: 'reproduzida', referencia: null });
    expect(ef.get('jogo-hist')).toMatchObject({
      status: 'nao-reproduzivel',
      subcausa: 'sem-build-referencia',
    });
    expect(JSON.stringify(x.consolidado)).not.toContain('teste-sintetica');
  });

  it('relatório sem nomes; repositório intacto; build ainda idêntico ao commit', async () => {
    const x = await executarBancada(arquivos, { modo: 'diagnostico', area, referenciaDeTeste: T });
    temporarios.push(x.pasta);
    const texto = readFileSync(join(x.pasta, 'relatorio-revisao.json'), 'utf8');
    for (const n of ['Flamengo', 'Atlético', 'Superbet', 'Bet365', 'jogo-demo', 'jogo-hist'])
      expect(texto).not.toContain(n);
    expect(instantaneoRepositorio(repo)).toEqual(antes);
    expect(conferirIdentidade(repo, T, build.fonte)).toMatchObject({
      divergentes: [],
      ausentes: [],
      intrusos: [],
    });
  });
});
