/**
 * F1.2b — suíte real, com o build REAL de 8964bf4 como referência SINTÉTICA DE TESTE (D-e).
 * Entradas e evidências nascem dentro do build (código daquele commit); a reprodução e o
 * reprocessamento rodam pelo vitest dele, em processo filho, com relógio, fuso e rede controlados.
 *  12. entrada sem evidência → reprocessamento nas duas pontas do minuto → concorda
 *  13. evidência inelegível / de commit ausente → reprocessamento (concorda); decisão adulterada
 *      → diverge; elegível → original-exata, sem fallback
 *      sem referência oficial → sem-build-referencia (nada executa)
 *  14. identidade do build, procedência e isolamento do repositório principal
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { impressaoDigital, type Evidencia } from '../../../apps/web/src/evidencias';
import type { EntradaHistorico } from '../../../apps/web/src/historico';
import type { Juncao } from '../src/leitura/juntarBackups';
import { prepararArea, raizPadrao, raizRepositorio, type Area } from '../src/reproducao/area';
import { ProvedorGit, type BuildPreparado } from '../src/reproducao/build';
import { ExecutorProcesso } from '../src/reproducao/executor';
import {
  ARQUIVO_HARNESS_REPROCESSAMENTO,
  ExecutorHistoricoProcesso,
} from '../src/reproducao/executorHistorico';
import { reproducaoHistorica, type OpcoesHistoricas } from '../src/reproducao/historica';
import { REFERENCIA_TESTE_SINTETICA } from '../src/reproducao/referencia';
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
let ev: Evidencia;
let demo: EntradaHistorico;
let hist: EntradaHistorico;
let origens: Record<string, string>[] = [];
let opcoes: OpcoesHistoricas;
const temporarios: string[] = [];

const zero = { fisicos: 0, canonicos: 0, duplicatas: 0, substituidos: 0, excluidos: 0 };
const juncao = (entradas: EntradaHistorico[], evidencias: Evidencia[]): Juncao => ({
  fontes: [],
  entradas: entradas.map((e) => ({
    entrada: e,
    fontes: ['real'],
    versoes: 1,
    criterio: 'unica',
    alerta: null,
  })),
  evidencias,
  fontesDaEvidencia: new Map(),
  substituidas: [],
  exclusoes: [],
  conservacao: { historico: zero, evidencias: zero, arquivos: { lidos: 1, recusados: 0 } },
});
/** a mesma evidência noutra situação de build (meta fica fora do hash); gravadoEm distingue a identidade */
const variante = (
  e: Evidencia,
  build: Partial<Evidencia['meta']['build']>,
  s: number,
): Evidencia => ({
  ...e,
  meta: {
    ...e.meta,
    revisao: e.meta.revisao + s,
    gravadoEm: new Date(Date.parse(e.meta.gravadoEm) + s * 1000).toISOString(),
    build: { ...e.meta.build, ...build },
  },
});

beforeAll(async () => {
  area = prepararArea(raizPadrao());
  const provedor = new ProvedorGit(repo, area.builds);
  const p = await provedor.preparar(T);
  if (!p.ok) throw new Error(`build de referência de teste indisponível: ${p.motivo}`);
  build = p.build;
  const id = conferirIdentidade(repo, T, build.fonte);
  if (id.divergentes.length || id.ausentes.length || id.intrusos.length)
    throw new Error(`build isolado não confere com ${T}: ${JSON.stringify(id)}`);
  const pasta = mkdtempSync(join(area.execucoes, 'gerador-f12b-'));
  temporarios.push(pasta);
  const g = await gerarEvidenciaNoBuild(
    build,
    { idJogo: 'jogo-demo', relogio: RELOGIO, build: buildDoCommit(repo, T, RELOGIO) },
    pasta,
  );
  ev = g.evidencia;
  const h = await gerarEntradasNoBuild(
    build,
    { ids: ['jogo-demo', 'jogo-hist'], relogio: RELOGIO },
    pasta,
  );
  [demo, hist] = h.entradas;
  origens = [g.origem, h.origem];
  opcoes = {
    area,
    provedor,
    executor: new ExecutorProcesso(),
    executorHistorico: new ExecutorHistoricoProcesso(),
    repositorio: repo,
    referenciaDeTeste: T,
  };
});

afterAll(() => {
  for (const p of temporarios) rmSync(p, { recursive: true, force: true });
});

describe('F1.2b com build real (referência sintética de teste)', () => {
  it('teste 14a: identidade do build e procedência — tudo nasceu dentro do build', () => {
    const dentro = (p: string) =>
      resolve(p)
        .toLowerCase()
        .startsWith(resolve(build.fonte).toLowerCase() + sep);
    for (const o of origens)
      for (const [m, p] of Object.entries(o)) expect(dentro(p), `${m}: ${p}`).toBe(true);
    expect(hist.salvoEm).toBe('2026-11-18T12:00:00-03:00');
    expect(hist.resumo.inicio).toBe('2026-11-18T15:00:00-03:00');
  });

  it('teste 12: entrada sem evidência reprocessada nas duas pontas → concorda; evidência elegível → original-exata', async () => {
    const x = await reproducaoHistorica(juncao([demo, hist], [ev]), opcoes);
    temporarios.push(x.pasta);
    expect(x.revisoes[0]).toMatchObject({ classe: 'original-exata', reprocessamento: null });
    const [cob, h] = x.entradas;
    expect(cob).toMatchObject({ idHistorico: 'jogo-demo', destino: 'coberta-por-evidencia' });
    expect(h).toMatchObject({
      idHistorico: 'jogo-hist',
      destino: 'reprocessamento',
      comparacao: 'concorda',
      referencia: { sha: T, tipo: 'teste-sintetica' },
      relogio: {
        origem: 'inferido',
        salvoEm: '2026-11-18T12:00:00-03:00',
        intervalo: ['2026-11-18T15:00:00.000Z', '2026-11-18T15:00:59.999Z'],
      },
    });
    expect(h.pontas.map((p) => p.status)).toEqual(['ok', 'ok']);
    expect(h.pontas[0].shaResumo).toBe(h.pontas[1].shaResumo);
    expect(h.pontas[0].ambiente).toMatchObject({ fuso: 'America/Sao_Paulo', deslocamentoMin: 180 });
    expect(x.manifesto.referencia).toEqual({ sha: T, tipo: 'teste-sintetica' });
    expect(existsSync(join(build.fonte, ARQUIVO_HARNESS_REPROCESSAMENTO))).toBe(true);
    expect(existsSync(join(repo, ARQUIVO_HARNESS_REPROCESSAMENTO))).toBe(false);
  });

  it('teste 13: inelegível e commit ausente → reprocessamento concorda; decisão adulterada → diverge', async () => {
    const adulterado = structuredClone(ev);
    (adulterado.conteudo.avaliacao as { v4: { decisao: string } }).v4.decisao = 'NO_BET';
    adulterado.meta.hash = await impressaoDigital(adulterado.conteudo);
    const itens = [
      variante(ev, { alteracoesLocais: true }, 1),
      variante(ev, { commit: 'f'.repeat(40) }, 2),
      variante(adulterado, { alteracoesLocais: true }, 3),
    ];
    const x = await reproducaoHistorica(juncao([demo], itens), opcoes);
    temporarios.push(x.pasta);
    expect(x.revisoes.map((r) => [r.classe, r.comparacao, r.tentativaOriginal.subcausa])).toEqual([
      ['reprocessamento', 'concorda', 'build-nao-elegivel'],
      ['reprocessamento', 'concorda', 'commit-ausente'],
      ['reprocessamento', 'diverge', 'build-nao-elegivel'],
    ]);
    expect(
      x.revisoes[2].reprocessamento?.diferencas.some((d) => d.caminho === 'avaliacao.v4.decisao'),
    ).toBe(true);
    for (const r of x.revisoes) expect(r.referencia).toEqual({ sha: T, tipo: 'teste-sintetica' });
    expect(x.manifesto.revisoes.reprocessamentoPorTipo).toEqual({
      'teste-sintetica': { concorda: 2, diverge: 1 },
    });
  });

  it('sem referência oficial: sem-build-referencia em tudo que precisaria dela', async () => {
    const x = await reproducaoHistorica(
      juncao([hist, demo], [variante(ev, { alteracoesLocais: true }, 1)]),
      {
        ...opcoes,
        referenciaDeTeste: undefined,
      },
    );
    temporarios.push(x.pasta);
    expect(x.revisoes[0]).toMatchObject({
      subcausa: 'sem-build-referencia',
      reprocessamento: null,
    });
    expect(x.entradas.find((e) => e.idHistorico === 'jogo-hist')).toMatchObject({
      subcausa: 'sem-build-referencia',
    });
    expect(x.manifesto.referencia).toMatchObject({ tipo: 'ausente' });
  });

  it('teste 14b: repositório principal intacto e build ainda idêntico ao commit', () => {
    expect(instantaneoRepositorio(repo)).toEqual(antes);
    expect(conferirIdentidade(repo, T, build.fonte)).toMatchObject({
      divergentes: [],
      ausentes: [],
      intrusos: [],
    });
  });
});
