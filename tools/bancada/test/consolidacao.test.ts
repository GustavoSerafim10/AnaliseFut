/**
 * F1.2c — suíte rápida: ponto de entrada único (mesma junção), diagnóstico (só previsões,
 * conferidas contra a execução), consolidação (revisão de decisão, irmãs, excluídas,
 * conservação), camadas de referência, relatório sem nomes e isolamento.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { montarConjunto, type ArquivoEntrada } from '../src/index';
import { raizRepositorio, type Area } from '../src/reproducao/area';
import { consolidar, relatorioDeRevisao } from '../src/reproducao/consolidar';
import type { Consolidado, PrevisaoDiagnostico } from '../src/reproducao/contratoConsolidacao';
import { previsaoConfere } from '../src/reproducao/diagnostico';
import { executarBancada, type OpcoesBancada } from '../src/reproducao/executarBancada';
import { REFERENCIA_TESTE_SINTETICA } from '../src/reproducao/referencia';
import { arquivosBancada, COMMIT_ORIGINAL, NOMES_PROIBIDOS } from './fixtures/bancada';
import { ExecutorHistoricoEmProcesso } from './fixtures/historica';
import {
  areaDeTeste,
  ExecutorEmProcesso,
  instantaneoRepositorio,
  ProvedorFalso,
} from './fixtures/reproducao';

const T = REFERENCIA_TESTE_SINTETICA;
const antes = instantaneoRepositorio();
let area: Area;
let arquivos: ArquivoEntrada[];

beforeAll(async () => {
  area = areaDeTeste();
  arquivos = await arquivosBancada();
});
afterAll(() => {
  rmSync(area.raiz, { recursive: true, force: true });
});

const execucao = (o: Partial<OpcoesBancada> = {}): OpcoesBancada =>
  ({
    modo: 'execucao',
    area,
    provedor: new ProvedorFalso([COMMIT_ORIGINAL, T]),
    executor: new ExecutorEmProcesso(),
    executorHistorico: new ExecutorHistoricoEmProcesso(),
    repositorio: raizRepositorio(),
    referenciaDeTeste: T,
    ...o,
  }) as OpcoesBancada;
const porId = <T extends { idHistorico: string }>(xs: T[]) =>
  new Map(xs.map((x) => [x.idHistorico, x]));

describe('ponto de entrada único', () => {
  it('a junção usada é a mesma de montarConjunto (mesma impressão) e as entradas são as da F1.1', async () => {
    const r = await executarBancada(arquivos, { modo: 'diagnostico', area, referenciaDeTeste: T });
    expect(r.consolidado.impressaoConjunto).toBe((await montarConjunto(arquivos)).impressao);
    expect(r.consolidado.conservacao.entradasCanonicas).toBe(r.juncao.entradas.length);
    expect(existsSync(join(r.pasta, 'consolidado.json'))).toBe(true);
    expect(existsSync(join(r.pasta, 'relatorio-revisao.json'))).toBe(true);
  });
});

describe('consolidação (execução)', () => {
  let c: Consolidado;
  beforeAll(async () => {
    c = (await executarBancada(arquivos, execucao())).consolidado;
  });

  it('A: a revisão de decisão da F1.1 representa a análise; a revisão pós-apito não a substitui', () => {
    const a = porId(c.analises).get('jogo-r')!;
    expect(a).toMatchObject({
      status: 'reproduzida',
      fonte: { tipo: 'revisao-de-decisao', revisao: 1 },
    });
  });

  it('A: só revisões depois do apito → sem-revisao-de-decisao (não nao-reproduzivel)', () => {
    expect(porId(c.analises).get('so-pos')).toMatchObject({
      status: 'sem-revisao-de-decisao',
      subcausa: null,
      fonte: { tipo: 'nenhuma' },
    });
  });

  it('análise sem evidência → reprocessada, com a referência sintética identificada', () => {
    expect(porId(c.analises).get('h1')).toMatchObject({
      status: 'reprocessada',
      comparacao: 'concorda',
      referencia: { sha: T, tipo: 'teste-sintetica' },
      fonte: { tipo: 'entrada' },
    });
  });

  it('B: irmãs herdam da raiz; raiz ausente ou excluída → vínculo não resolvido, sem inventar', () => {
    const i = porId(c.irmas);
    expect(i.get('h1-irma')).toMatchObject({
      status: 'herdado-da-raiz',
      statusRaiz: 'reprocessada',
    });
    expect(i.get('orfa-irma')).toMatchObject({
      status: 'vinculo-nao-resolvido',
      statusRaiz: null,
      motivo: 'a raiz não está no conjunto',
    });
    expect(i.get('x-irma')).toMatchObject({
      status: 'vinculo-nao-resolvido',
      motivo: expect.stringContaining('excluída pela F1.1'),
    });
    expect(c.analises.map((a) => a.idHistorico)).not.toContain('h1-irma');
  });

  it('D: excluídas da F1.1 registradas com o destino da F1.2', () => {
    expect(c.excluidas).toEqual([
      expect.objectContaining({
        idHistorico: 'semchave',
        categoria: 'jogo-sem-chave',
        destinoF12: 'nao-reproduzivel',
        subcausaF12: 'relogio-desconhecido',
      }),
    ]);
  });

  it('D: conservação em universos separados; seleções e apostas herdam o status', () => {
    expect(c.conservacao).toEqual({
      entradasCanonicas: 7,
      analisesElegiveis: 3,
      irmas: 3,
      excluidas: 1,
      selecoes: 7,
      apostas: 3,
    });
    expect(new Set(c.selecoes.map((s) => s.status))).toEqual(new Set(['reproduzida']));
    expect(c.apostas.map((a) => [a.idHistorico, a.status]).sort()).toEqual([
      ['h1-irma', 'reprocessada'],
      ['jogo-r', 'reproduzida'],
      ['orfa-irma', 'vinculo-nao-resolvido'],
    ]);
    const ids = [...c.analises, ...c.irmas, ...c.excluidas].map((x) => x.idHistorico);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('relatório de revisão: as contagens batem com o consolidado (os nomes são conferidos abaixo)', () => {
    const r = relatorioDeRevisao(c);
    expect(r.analises).toEqual({ reprocessada: 1, reproduzida: 1, 'sem-revisao-de-decisao': 1 });
    expect(r.irmas).toEqual({ 'herdado-da-raiz': 1, 'vinculo-nao-resolvido': 2 });
    expect(r.excluidas).toBe(1);
    expect(r.referencia).toEqual({ tipo: 'teste-sintetica' });
    expect(r.analisesPorComparacao).toEqual({ concorda: 1 });
  });
});

describe('universo das revisões (separado do das análises)', () => {
  it('todas as revisões seguem contadas e classificadas, inclusive as de depois do apito', async () => {
    const x = await executarBancada(arquivos, execucao());
    // r1 (decisão de jogo-r), r2 (jogo-r, depois do apito) e so-pos (depois do apito)
    expect(x.consolidado.revisoesF12.total).toBe(3);
    expect(x.f12!.revisoes).toHaveLength(3);
    const soma = Object.values(x.consolidado.revisoesF12.porClasse!).reduce((s, n) => s + n, 0);
    expect(soma).toBe(3);
    const apito = Date.parse(x.juncao.entradas[0].entrada.resumo.inicio);
    const posApito = x.juncao.evidencias.filter((ev) => Date.parse(ev.meta.gravadoEm) >= apito);
    expect(posApito).toHaveLength(2);
    const classificadas = new Set(x.f12!.revisoes.map((r) => r.identidade));
    for (const ev of posApito)
      expect(
        classificadas.has(JSON.stringify([ev.meta.idJogo, ev.meta.hash, ev.meta.gravadoEm])),
      ).toBe(true);
    // só 1 análise usa revisão (jogo-r, pela de decisão); o universo de revisões não encolhe por isso
    expect(
      x.consolidado.analises.filter((a) => a.fonte.tipo === 'revisao-de-decisao'),
    ).toHaveLength(1);
    expect(x.relatorio.revisoesF12).toEqual(x.consolidado.revisoesF12);
    const d = await executarBancada(arquivos, { modo: 'diagnostico', area, referenciaDeTeste: T });
    expect(d.consolidado.revisoesF12).toEqual({ total: 3, porClasse: null });
    expect(d.f12).toBeNull();
  });
});

describe('referência de teste inválida', () => {
  it('é recusada no ponto de entrada (a camada nunca fica "teste-sintetica" sem ela)', async () => {
    for (const modo of ['diagnostico', 'execucao'] as const)
      await expect(
        executarBancada(
          arquivos,
          modo === 'diagnostico'
            ? { modo, area, referenciaDeTeste: COMMIT_ORIGINAL }
            : execucao({ referenciaDeTeste: COMMIT_ORIGINAL }),
        ),
      ).rejects.toThrow(/referência de teste recusada/);
  });
});

describe('diagnóstico (C)', () => {
  it('só previsões, marcadas como tal, e todas confirmadas pela execução', async () => {
    const d = await executarBancada(arquivos, { modo: 'diagnostico', area, referenciaDeTeste: T });
    const x = await executarBancada(arquivos, execucao());
    const efetivo = porId(x.consolidado.analises);
    for (const a of d.consolidado.analises) {
      if (a.status === 'sem-revisao-de-decisao') {
        expect(efetivo.get(a.idHistorico)!.status).toBe('sem-revisao-de-decisao');
        continue;
      }
      expect(a.status).toBe('nao-executado');
      expect(a.previsao?.natureza).toBe('previsao');
      expect(previsaoConfere(a.previsao!, efetivo.get(a.idHistorico)!), a.idHistorico).toBe(true);
    }
    expect(d.consolidado.impressaoF12).toBeNull();
    expect(d.consolidado.referencia).toMatchObject({
      tipo: 'prevista',
      camada: 'teste-sintetica',
      verificada: false,
    });
    const jr = porId(d.consolidado.analises).get('jogo-r')!.previsao!;
    expect(jr).toMatchObject({ caminho: 'reproducao-original', determinado: null });
    expect(jr.naoVerificado).toEqual(
      expect.arrayContaining(['commit-ausente', 'tempo-esgotado', 'ambiente-invalido']),
    );
  });

  it('sem referência oficial: o diagnóstico determina sem-build-referencia e a execução confirma', async () => {
    const d = await executarBancada(arquivos, {
      modo: 'diagnostico',
      area,
      registroReferencia: {
        sha: null,
        registradoEm: null,
        motivo: 'teste: sem referência oficial',
      },
    });
    const x = await executarBancada(
      arquivos,
      execucao({
        referenciaDeTeste: undefined,
        registroReferencia: {
          sha: null,
          registradoEm: null,
          motivo: 'teste: sem referência oficial',
        },
      }),
    );
    expect(d.consolidado.camada).toBe('producao');
    expect(porId(d.consolidado.analises).get('h1')!.previsao).toMatchObject({
      determinado: 'sem-build-referencia',
    });
    expect(porId(x.consolidado.analises).get('h1')).toMatchObject({
      status: 'nao-reproduzivel',
      subcausa: 'sem-build-referencia',
    });
    for (const a of d.consolidado.analises.filter((y) => y.previsao))
      expect(previsaoConfere(a.previsao!, porId(x.consolidado.analises).get(a.idHistorico)!)).toBe(
        true,
      );
  });

  it('previsaoConfere recusa resultados que a previsão não admitia', () => {
    const p = (o: Partial<PrevisaoDiagnostico>): PrevisaoDiagnostico => ({
      natureza: 'previsao',
      caminho: 'reprocessamento',
      determinado: null,
      motivo: '',
      naoVerificado: ['tempo-esgotado'],
      observacoes: [],
      comparacaoPrevista: null,
      ...o,
    });
    const ef = (status: string, subcausa: string | null = null, comparacao: string | null = null) =>
      ({ status, subcausa, comparacao }) as never;
    expect(previsaoConfere(p({}), ef('reproduzida'))).toBe(false);
    expect(previsaoConfere(p({}), ef('nao-reproduzivel', 'api-ausente'))).toBe(false);
    expect(previsaoConfere(p({}), ef('nao-reproduzivel', 'tempo-esgotado'))).toBe(true);
    expect(
      previsaoConfere(
        p({ determinado: 'relogio-desconhecido', caminho: 'nenhum' }),
        ef('reprocessada'),
      ),
    ).toBe(false);
    expect(
      previsaoConfere(
        p({ comparacaoPrevista: 'protocolo-diferente' }),
        ef('reprocessada', null, 'concorda'),
      ),
    ).toBe(false);
    expect(
      previsaoConfere(p({ caminho: 'reproducao-original', naoVerificado: [] }), ef('reprocessada')),
    ).toBe(false);
  });
});

describe('camadas de referência (E)', () => {
  it('resultado sintético nunca entra numa consolidação de produção', async () => {
    const x = await executarBancada(arquivos, execucao());
    const { reproducaoHistorica } = await import('../src/reproducao/historica');
    const f12 = await reproducaoHistorica(x.juncao, {
      area,
      provedor: new ProvedorFalso([COMMIT_ORIGINAL, T]),
      executor: new ExecutorEmProcesso(),
      executorHistorico: new ExecutorHistoricoEmProcesso(),
      repositorio: raizRepositorio(),
      referenciaDeTeste: T,
    });
    await expect(
      consolidar({
        modo: 'execucao',
        conjunto: x.conjunto,
        impressaoConjunto: 'x',
        juncao: x.juncao,
        camada: 'producao',
        f12,
      }),
    ).rejects.toThrow(/camada misturada/);
    expect(x.consolidado.camada).toBe('teste-sintetica');
  });
});

describe('dados e isolamento (F)', () => {
  it('relatório de revisão sem nomes de times, casas ou ids; detalhe só na área isolada', async () => {
    for (const modo of ['diagnostico', 'execucao'] as const) {
      const r = await executarBancada(
        arquivos,
        modo === 'diagnostico' ? { modo, area, referenciaDeTeste: T } : execucao(),
      );
      const texto = readFileSync(join(r.pasta, 'relatorio-revisao.json'), 'utf8');
      for (const n of NOMES_PROIBIDOS) expect(texto, `${modo}: ${n}`).not.toContain(n);
      expect(JSON.parse(texto).conservacao.entradasCanonicas).toBe(7);
      expect(r.pasta.startsWith(area.raiz)).toBe(true);
    }
  });

  it('o repositório principal não mudou', () => {
    expect(instantaneoRepositorio()).toEqual(antes);
  });
});
