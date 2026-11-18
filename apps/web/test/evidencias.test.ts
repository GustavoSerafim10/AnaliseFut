/**
 * Fase 0 — registro de evidências: montagem completa, impressão digital determinística,
 * valores inválidos preservados, reprodução no mesmo build, revisões e importação.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derivar, type Derivado } from '../src/dados';
import {
  antesDoApito,
  canonico,
  classificarReproducao,
  impressaoDigital,
  LIMITE_REVISOES,
  montarConteudo,
  montarEvidencia,
  pareceEvidencia,
  planejarImportacao,
  planejarRevisao,
  type ContextoCalculo,
  type Evidencia,
} from '../src/evidencias';
import { rascunhoExemplo } from '../src/exemplo';
import type { Rascunho } from '../src/estado';
import type { VersaoBuild } from '../versao-build.mjs';

const AGORA = '2026-11-18T15:00:00.000Z';
const BUILD: VersaoBuild = {
  commit: 'a'.repeat(40),
  commitData: '2026-11-18T12:00:00-03:00',
  construidoEm: '2026-11-18T15:00:00.000Z',
  origem: 'github-actions',
  alteracoesLocais: false,
};
const fx = (n: string) =>
  readFileSync(
    new URL(`../../../packages/parsers/test/fixtures-reais/${n}`, import.meta.url),
    'utf8',
  );

/** Calcula como o App: instantes antes e depois do derivar(). */
function calcular(r: Rascunho): { d: Derivado; ctx: ContextoCalculo } {
  const inicio = new Date().toISOString();
  const d = derivar(r);
  const fim = new Date().toISOString();
  return { d, ctx: { calculadoEm: { inicio, fim } } };
}

/** O exemplo com prints reais do SofaScore e do SuperScore (Remo × Botafogo). */
function comPrintsReais(): Rascunho {
  const r = rascunhoExemplo();
  const p = (arquivo: string) => ({ arquivo, texto: fx(arquivo) });
  return {
    ...r,
    jogo: { ...r.jogo, casa: 'Remo', fora: 'Botafogo' },
    correcoes: {},
    prints: {
      ...r.prints,
      sofascore: [p('sofascore-remo-1.txt'), p('sofascore-remo-2.txt')],
      superscore: [
        p('superscore-remo-1.txt'),
        p('superscore-remo-2.txt'),
        p('superscore-remo-3.txt'),
      ],
    },
  };
}

function congelar<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) congelar(v);
  }
  return o;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(AGORA), toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('montagem', () => {
  it('tem todos os blocos pedidos e volta igual depois de virar JSON', async () => {
    const r = comPrintsReais();
    const { d, ctx } = calcular(r);
    const ev = await montarEvidencia('jogo-1', r, d, ctx, BUILD, AGORA);
    const c = ev.conteudo;
    for (const bloco of [
      'limitacoes',
      'jogo',
      'entrada',
      'parametros',
      'fontes',
      'consolidado',
      'amostra',
      'modelo',
      'mercado',
      'avaliacao',
      'invalidos',
      'omitidos',
    ])
      expect(c, bloco).toHaveProperty(bloco);
    // dados originais das duas fontes, print a print, e a leitura juntada
    const fontes = c.fontes as {
      sofascore: { porPrint: { arquivo: string }[]; juntada: unknown };
      superscore: { porPrint: { arquivo: string }[]; juntada: unknown };
    };
    expect(fontes.sofascore.porPrint.map((x) => x.arquivo)).toEqual([
      'sofascore-remo-1.txt',
      'sofascore-remo-2.txt',
    ]);
    expect(fontes.superscore.porPrint).toHaveLength(3);
    // a fonte de cada estatística consolidada
    const tabela = (c.consolidado as { tabela: Record<string, { casa: { fonte?: string } }> })
      .tabela;
    expect(tabela.xg.casa.fonte).toBe('superscore');
    expect(tabela.partidas.casa.fonte).toBe('sofascore');
    expect(c.amostra).toEqual({
      partidas: { casa: 32, fora: 32 },
      fontesComDados: ['sofascore', 'superscore'],
    });
    // mercados avaliados (inclusive os que não viraram aposta) com as probabilidades
    const v4 = (c.avaliacao as { v4: { avaliadas: { pTrue: number; pModelo: unknown }[] } }).v4;
    expect(v4.avaliadas.length).toBeGreaterThan(0);
    expect(v4.avaliadas.every((a) => typeof a.pTrue === 'number')).toBe(true);
    // odds com casa e horário de coleta; versão e instante do cálculo em meta
    const odds = (c.mercado as { oddsValidas: { casa: string; horarioColeta?: string }[] })
      .oddsValidas;
    expect(odds.every((o) => o.casa && o.horarioColeta)).toBe(true);
    expect(ev.meta.build).toEqual(BUILD);
    expect(ev.meta.calculadoEm).toEqual(ctx.calculadoEm);
    // JSON ida e volta: nada se perde (o que JSON não guarda já virou marcador)
    expect(canonico(JSON.parse(JSON.stringify(ev.conteudo)))).toBe(canonico(ev.conteudo));
    // o liquidador (função) de cada mercado é marcado, não some calado
    expect(c.omitidos.some((o) => o.tipo === 'function' && o.quantidade > 0)).toBe(true);
    expect(c.limitacoes.join(' ')).toMatch(/imagens dos prints não são guardadas/);
  });

  it('só lê: rascunho e resultado congelados não impedem a montagem e não mudam', async () => {
    const r = comPrintsReais();
    const { d, ctx } = calcular(r);
    const antesR = JSON.stringify(r);
    const antesD = canonico(montarConteudo(r, d, ctx).avaliacao);
    congelar(r);
    congelar(d);
    await expect(montarEvidencia('jogo-1', r, d, ctx, BUILD, AGORA)).resolves.toBeTruthy();
    expect(JSON.stringify(r)).toBe(antesR);
    expect(canonico(montarConteudo(r, d, ctx).avaliacao)).toBe(antesD);
  });

  it('não grava depois do apito', () => {
    const r = rascunhoExemplo();
    const inicio = Date.parse(AGORA) + 3 * 3_600_000;
    expect(antesDoApito(r, inicio - 1)).toBe(true);
    expect(antesDoApito(r, inicio + 60_000)).toBe(false);
  });
});

describe('impressão digital', () => {
  it('determinística e cega aos metadados (horário, revisão, build, instante do cálculo)', async () => {
    const r = comPrintsReais();
    const { d, ctx } = calcular(r);
    const a = await montarEvidencia('jogo-1', r, d, ctx, BUILD, AGORA);
    const b = await montarEvidencia(
      'outro-id',
      r,
      d,
      { calculadoEm: { inicio: 'x', fim: 'y' } },
      { ...BUILD, commit: 'b'.repeat(40) },
      '2030-01-01T00:00:00.000Z',
    );
    expect(a.meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.meta.hash).toBe(a.meta.hash);
    // ordem das chaves não muda o hash
    const invertido = Object.fromEntries(Object.entries(a.conteudo).reverse());
    expect(await impressaoDigital(invertido as typeof a.conteudo)).toBe(a.meta.hash);
  });

  it('muda quando a análise muda (uma odd)', async () => {
    const r = comPrintsReais();
    const { d, ctx } = calcular(r);
    const a = await montarEvidencia('j', r, d, ctx, BUILD, AGORA);
    const r2: Rascunho = {
      ...r,
      odds: r.odds.map((o, i) => (i === 0 ? { ...o, odd: o.odd + 0.05 } : o)),
    };
    const c2 = calcular(r2);
    const b = await montarEvidencia('j', r2, c2.d, c2.ctx, BUILD, AGORA);
    expect(b.meta.hash).not.toBe(a.meta.hash);
  });
});

describe('valores inválidos', () => {
  it('NaN e Infinity ficam marcados no lugar e listados com campo e motivo', async () => {
    const r = comPrintsReais();
    const { d, ctx } = calcular(r);
    const v4 = d.v4!;
    const estragado: Derivado = {
      ...d,
      v4: {
        ...v4,
        avaliadas: v4.avaliadas.map((a, i) =>
          i === 0 ? { ...a, ev: Number.NaN, oddJusta: Number.POSITIVE_INFINITY } : a,
        ),
      },
    };
    const c = montarConteudo(r, estragado, ctx);
    expect(c.invalidos).toEqual(
      expect.arrayContaining([
        {
          campo: 'avaliacao.v4.avaliadas[0].ev',
          valor: 'NaN',
          motivo: 'número não finito (NaN) no resultado',
        },
        {
          campo: 'avaliacao.v4.avaliadas[0].oddJusta',
          valor: 'Infinity',
          motivo: 'número não finito (Infinity) no resultado',
        },
      ]),
    );
    const a0 = (c.avaliacao as { v4: { avaliadas: Record<string, unknown>[] } }).v4.avaliadas[0];
    expect(a0.ev).toEqual({ $invalido: 'NaN' });
    expect(a0.oddJusta).toEqual({ $invalido: 'Infinity' });
  });
});

describe('reprodução', () => {
  it('mesmo build + mesmo relógio: o recálculo dá exatamente o mesmo conteúdo', async () => {
    const r = comPrintsReais();
    const { d, ctx } = calcular(r);
    const original = await montarEvidencia('j', r, d, ctx, BUILD, AGORA);
    // horas depois, com outro relógio, a partir SÓ do que está na evidência
    vi.setSystemTime(new Date('2026-11-18T23:00:00.000Z'));
    vi.setSystemTime(new Date(original.meta.calculadoEm.inicio));
    const ent = original.conteudo.entrada as { rascunho: Rascunho };
    const de = calcular(JSON.parse(JSON.stringify(ent.rascunho)) as Rascunho);
    const hash = await impressaoDigital(montarConteudo(ent.rascunho, de.d, {}));
    expect(classificarReproducao(original, hash, BUILD)).toEqual({
      tipo: 'reproducao-original',
      mesmoConteudo: true,
    });
  });

  it('não afirma reprodução sem a versão original nem com outra versão', () => {
    const ev = { meta: { hash: 'h', build: BUILD } } as Evidencia;
    expect(classificarReproducao(ev, 'h', { ...BUILD, commit: 'c'.repeat(40) }).tipo).toBe(
      'reprocessamento-outra-versao',
    );
    expect(
      classificarReproducao(ev, 'h', { ...BUILD, commit: null, origem: 'desconhecida' }).tipo,
    ).toBe('versao-desconhecida');
    expect(classificarReproducao(ev, 'h', { ...BUILD, alteracoesLocais: true }).tipo).toBe(
      'versao-desconhecida',
    );
    expect(classificarReproducao(ev, 'outro', BUILD).tipo).toBe('divergiu-no-mesmo-build');
  });
});

describe('revisões', () => {
  const rev = (n: number, hash = `h${n}`) => ({ revisao: n, hash });

  it('mesmo conteúdo da última revisão: não grava', () => {
    expect(planejarRevisao([rev(1), rev(2)], 'h2')).toEqual({ acao: 'igual', revisao: 2 });
  });
  it('conteúdo novo: próxima revisão; voltar a um conteúdo antigo também é revisão', () => {
    expect(planejarRevisao([], 'x')).toEqual({ acao: 'gravar', revisao: 1, apagar: [] });
    expect(planejarRevisao([rev(1), rev(2)], 'h1')).toEqual({
      acao: 'gravar',
      revisao: 3,
      apagar: [],
    });
  });
  it(`passou de ${LIMITE_REVISOES}: fica a primeira e as 49 mais recentes`, () => {
    const cinquenta = Array.from({ length: 50 }, (_, i) => rev(i + 1));
    const p = planejarRevisao(cinquenta, 'nova');
    expect(p).toEqual({ acao: 'gravar', revisao: 51, apagar: [2] });
    // depois da poda a numeração continua subindo (nunca reaproveita número)
    const podadas = [rev(1), ...Array.from({ length: 49 }, (_, i) => rev(i + 3))];
    expect(planejarRevisao(podadas, 'outra')).toEqual({ acao: 'gravar', revisao: 52, apagar: [3] });
  });
});

describe('importação', () => {
  const ev = (revisao: number, hash: string): Evidencia =>
    ({ esquema: 'evidencia-v1', meta: { idJogo: 'j', revisao, hash }, conteudo: {} }) as Evidencia;

  it('mesmo conteúdo não duplica; número livre se mantém', () => {
    const p = planejarImportacao([{ revisao: 1, hash: 'A' }], [ev(1, 'A'), ev(2, 'B')], AGORA);
    expect(p[0]).toEqual({ acao: 'ja-existe', revisao: 1 });
    expect(p[1]).toMatchObject({ acao: 'gravar', evidencia: { meta: { revisao: 2, hash: 'B' } } });
  });
  it('número ocupado por outro conteúdo: guarda os dois, com número novo e a origem', () => {
    const p = planejarImportacao(
      [
        { revisao: 1, hash: 'A' },
        { revisao: 2, hash: 'B' },
      ],
      [ev(2, 'C'), ev(3, 'D')],
      AGORA,
    );
    expect(p[0]).toMatchObject({
      acao: 'gravar',
      evidencia: {
        meta: { revisao: 3, hash: 'C', importacao: { revisaoOriginal: 2, importadoEm: AGORA } },
      },
    });
    // a 3 do backup também colide (com a C recém-numerada): vira 4
    expect(p[1]).toMatchObject({
      acao: 'gravar',
      evidencia: { meta: { revisao: 4, hash: 'D', importacao: { revisaoOriginal: 3 } } },
    });
  });
  it('forma mínima: rejeita o que não parece evidência', () => {
    expect(pareceEvidencia(ev(1, 'A'))).toBe(true);
    expect(pareceEvidencia({ esquema: 'x', meta: { idJogo: 'j', revisao: 0, hash: 'h' } })).toBe(
      false,
    );
    expect(pareceEvidencia(null)).toBe(false);
  });
});
