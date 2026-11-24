/**
 * F1.2b — suíte rápida (build falso, executores no próprio processo): relógio D1 corrigido,
 * referência (nunca HEAD, teste ≠ produção), comparação reduzida, fallback restrito, pontas do
 * minuto, falhas parciais, irmãs, conservação, determinismo, isolamento e F1.2a intacta.
 */
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntradaHistorico } from '../../../apps/web/src/historico';
import type { Area } from '../src/reproducao/area';
import { raizRepositorio } from '../src/reproducao/area';
import { compararResumo, type ResumoComparavel } from '../src/reproducao/compararResumo';
import {
  reproducaoHistorica,
  semVariaveisHistorica,
  type OpcoesHistoricas,
} from '../src/reproducao/historica';
import {
  REFERENCIA_TESTE_SINTETICA,
  registroOficial,
  resolverReferencia,
} from '../src/reproducao/referencia';
import { inferirRelogio } from '../src/reproducao/relogio';
import { reproduzir } from '../src/reproducao/reproduzir';
import { ExecutorHistoricoEmProcesso, juncao } from './fixtures/historica';
import { cenario } from './fixtures/geradores';
import {
  areaDeTeste,
  buildGravado,
  comConteudo,
  evidenciaReproduzivel,
  ExecutorEmProcesso,
  instantaneoRepositorio,
  modulosAtuais,
  ProvedorFalso,
} from './fixtures/reproducao';

const C = 'a'.repeat(40);
const AUSENTE = 'b'.repeat(40);
const T = REFERENCIA_TESTE_SINTETICA;
const repo = raizRepositorio();
const antes = instantaneoRepositorio();
let area: Area;
let base: EntradaHistorico;

beforeAll(async () => {
  area = areaDeTeste();
  base = (await cenario()).entrada;
});
afterAll(() => {
  rmSync(area.raiz, { recursive: true, force: true });
});

const entrada = (id: string, f: (e: EntradaHistorico) => void = () => undefined) => {
  const e = { ...structuredClone(base), id };
  f(e);
  return e;
};
const opcoes = (o: Partial<OpcoesHistoricas> = {}): OpcoesHistoricas => ({
  area,
  provedor: new ProvedorFalso([C, T]),
  executor: new ExecutorEmProcesso(),
  executorHistorico: new ExecutorHistoricoEmProcesso(),
  repositorio: repo,
  referenciaDeTeste: T,
  ...o,
});

describe('D1 corrigida: relógio inferido', () => {
  const ok = { data: '2026-11-18', hora: '15:00', inicio: '2026-11-18T15:00:00-03:00', marcas: [] };
  it('antes do apito por um minuto inteiro: duas pontas do minuto', () => {
    expect(inferirRelogio({ ...ok, salvoEm: '2026-11-18T12:00:00-03:00' })).toEqual({
      ok: true,
      salvoEm: '2026-11-18T12:00:00-03:00',
      pontas: ['2026-11-18T15:00:00.000Z', '2026-11-18T15:00:59.999Z'],
    });
  });
  it('limite: salvoEm + 60 s == início aceita; o minuto do apito e depois, não', () => {
    expect(inferirRelogio({ ...ok, salvoEm: '2026-11-18T14:59:00-03:00' }).ok).toBe(true);
    for (const s of ['2026-11-18T15:00:00-03:00', '2026-11-18T15:01:00-03:00'])
      expect(inferirRelogio({ ...ok, salvoEm: s })).toMatchObject({ ok: false });
  });
  it.each([
    ['segundos ≠ 00', { salvoEm: '2026-11-18T12:00:30-03:00' }, /formato do site/],
    ['UTC (Z)', { salvoEm: '2026-11-18T15:00:00.000Z' }, /formato do site/],
    ['outro deslocamento', { salvoEm: '2026-11-18T12:00:00-02:00' }, /formato do site/],
    ['data impossível', { salvoEm: '2026-02-30T12:00:00-03:00' }, /formato do site/],
    [
      'hora vazia (00:00 fabricado)',
      { salvoEm: '2026-11-18T12:00:00-03:00', hora: '' },
      /horário fabricado/,
    ],
    [
      'início ≠ inicioIso',
      { salvoEm: '2026-11-18T12:00:00-03:00', inicio: '2026-11-18T18:00:00Z' },
      /não confere/,
    ],
    [
      'cronologia não comprovada (D-b)',
      { salvoEm: '2026-11-18T12:00:00-03:00', marcas: ['cronologiaNaoComprovada'] },
      /D-b/,
    ],
  ])('%s → relógio desconhecido', (_n, x, motivo) => {
    const r = inferirRelogio({ ...ok, ...x });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(motivo);
  });
});

describe('referência (D4, D-e, proteção 3)', () => {
  it('a oficial está sem SHA: sem-build-referencia, sem cair para nada', () => {
    expect(registroOficial().sha).toBeNull();
    expect(resolverReferencia({ repositorio: repo })).toMatchObject({ ok: false });
  });
  it.each(['HEAD', 'main', 'origin/main', 'v1.0', '8964bf4', 'B'.repeat(40)])(
    'nome simbólico ou SHA incompleto como oficial (%s) é recusado',
    (sha) => {
      const r = resolverReferencia({
        repositorio: repo,
        registro: { sha, registradoEm: null, motivo: '' },
      });
      expect(r.ok).toBe(false);
    },
  );
  it('8964bf4 nunca vale como oficial (D-e); SHA inexistente também não', () => {
    for (const sha of [T, AUSENTE])
      expect(
        resolverReferencia({ repositorio: repo, registro: { sha, registradoEm: null, motivo: '' } })
          .ok,
      ).toBe(false);
  });
  it('referência de teste: só 8964bf4, sempre marcada como teste-sintetica', () => {
    expect(resolverReferencia({ repositorio: repo, referenciaDeTeste: T })).toEqual({
      ok: true,
      sha: T,
      tipo: 'teste-sintetica',
    });
    expect(resolverReferencia({ repositorio: repo, referenciaDeTeste: C }).ok).toBe(false);
  });
});

describe('comparação reduzida do resumo', () => {
  const r = (): ResumoComparavel => structuredClone(base.resumo) as unknown as ResumoComparavel;
  it('igual → concorda; stake e lista sempre nao-comparavel (D-d)', () => {
    const b = r();
    (b.entrada as { stake: number }).stake = 0.999; // não pesa
    b.confianca = [];
    const c = compararResumo(r(), b, { entradaSubstituidaPelaAposta: false });
    expect(c.comparacao).toBe('concorda');
    expect(c.campos.filter((x) => x.estado === 'nao-comparavel').map((x) => x.campo)).toEqual([
      'entrada.stake',
      'confianca',
    ]);
  });
  it('decisão, odd ou seleção diferentes → diverge', () => {
    for (const f of [
      (x: ResumoComparavel) => (x.decisao = 'NO_BET'),
      (x: ResumoComparavel) => ((x.entrada as { odd: number }).odd += 0.01),
      (x: ResumoComparavel) => ((x.entrada as { linha: { lado: string } }).linha.lado = 'under'),
      (x: ResumoComparavel) => ((x.entrada as { ev: number }).ev += Number.EPSILON), // sem tolerância
    ]) {
      const b = r();
      f(b);
      expect(compararResumo(r(), b, { entradaSubstituidaPelaAposta: false }).comparacao).toBe(
        'diverge',
      );
    }
  });
  it('protocolo V3.3 ou ausente → protocolo-diferente, mesmo com diferenças (D-c)', () => {
    for (const p of ['V3.3', undefined]) {
      const a = { ...r(), protocolo: p };
      const b = { ...r(), decisao: 'NO_BET' };
      expect(compararResumo(a, b, { entradaSubstituidaPelaAposta: false }).comparacao).toBe(
        'protocolo-diferente',
      );
    }
  });
  it('entrada trocada pela aposta da lista → seleção nao-comparavel; decisão e DQ ainda pesam', () => {
    const b = r();
    (b.entrada as { odd: number }).odd = 9;
    const c = compararResumo(r(), b, { entradaSubstituidaPelaAposta: true });
    expect(c.comparacao).toBe('concorda');
    expect(c.campos.find((x) => x.campo === 'entrada')?.estado).toBe('nao-comparavel');
  });
});

describe('reprodução histórica combinada', () => {
  it('cobre, reprocessa, vincula irmã; referência de teste marcada em tudo (cuidado 3)', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const exHist = new ExecutorHistoricoEmProcesso();
    const x = await reproducaoHistorica(
      juncao(
        [
          { e: entrada('jogo-r') },
          { e: entrada('h1') },
          { e: entrada('h1-irma', (e) => (e.irmaDe = 'h1')) },
        ],
        [ev],
      ),
      opcoes({ executorHistorico: exHist }),
    );
    expect(x.revisoes).toHaveLength(1);
    expect(x.revisoes[0]).toMatchObject({
      classe: 'original-exata',
      reprocessamento: null,
      referencia: null,
    });
    expect(x.revisoes[0].tentativaOriginal.classe).toBe('original-exata');
    const [cob, h1, irma] = x.entradas;
    expect(cob).toMatchObject({
      idHistorico: 'jogo-r',
      destino: 'coberta-por-evidencia',
      revisoesCobertas: 1,
    });
    expect(h1).toMatchObject({
      destino: 'reprocessamento',
      comparacao: 'concorda',
      referencia: { sha: T, tipo: 'teste-sintetica' },
      relogio: { origem: 'inferido', salvoEm: base.salvoEm },
    });
    expect(h1.pontas.map((p) => p.status)).toEqual(['ok', 'ok']);
    expect(h1.pontas[0].shaResumo).toBe(h1.pontas[1].shaResumo);
    expect(exHist.chamadas).toHaveLength(2); // só a entrada sem evidência, duas pontas
    expect(irma).toMatchObject({
      destino: 'irma-vinculada',
      comparacao: null,
      raiz: { id: 'h1', presente: true, destino: 'reprocessamento', comparacao: 'concorda' },
    });
    expect(x.manifesto.referencia).toEqual({ sha: T, tipo: 'teste-sintetica' });
    expect(x.manifesto.entradas.porDestino).toEqual({
      'coberta-por-evidencia': 1,
      'irma-vinculada': 1,
      reprocessamento: 1,
    });
    expect(x.manifesto.entradas.reprocessamentoPorTipo).toEqual({
      'teste-sintetica': { concorda: 1 },
    });
    expect(JSON.stringify(x.manifesto)).not.toContain('producao');
  });

  it('sem referência oficial: sem-build-referencia, nunca outra referência', async () => {
    const prov = new ProvedorFalso([C, T]);
    const x = await reproducaoHistorica(
      juncao([{ e: entrada('h1') }]),
      opcoes({ referenciaDeTeste: undefined, provedor: prov }),
    );
    expect(x.entradas[0]).toMatchObject({
      destino: 'nao-reproduzivel',
      subcausa: 'sem-build-referencia',
      referencia: null,
    });
    expect(x.entradas[0].relogio.origem).toBe('inferido');
    expect(x.manifesto.referencia).toMatchObject({ tipo: 'ausente' });
    expect(prov.chamadas).toEqual([]);
  });

  it('fallback só para build-nao-elegivel e commit-ausente, com a tentativa original inteira', async () => {
    const inelegivel = await evidenciaReproduzivel(buildGravado(C, { alteracoesLocais: true }));
    const ausente = await evidenciaReproduzivel(buildGravado(AUSENTE));
    const x = await reproducaoHistorica(
      juncao(
        [{ e: entrada('jogo-r') }],
        [
          inelegivel,
          {
            ...ausente,
            meta: { ...ausente.meta, revisao: 2, gravadoEm: '2026-11-18T15:00:01.000Z' },
          },
        ],
      ),
      opcoes(),
    );
    expect(x.revisoes.map((r) => [r.classe, r.comparacao, r.tentativaOriginal.subcausa])).toEqual([
      ['reprocessamento', 'concorda', 'build-nao-elegivel'],
      ['reprocessamento', 'concorda', 'commit-ausente'],
    ]);
    for (const r of x.revisoes) {
      expect(r.referencia).toEqual({ sha: T, tipo: 'teste-sintetica' });
      expect(r.reprocessamento?.referencia.tipo).toBe('teste-sintetica');
      expect(r.tentativaOriginal.motivo.length).toBeGreaterThan(0);
      expect(r.motivo).toContain(`tentativa original: ${r.tentativaOriginal.subcausa}`);
    }
    // sem referência: a tentativa continua registrada no motivo e no campo
    const y = await reproducaoHistorica(
      juncao([{ e: entrada('jogo-r') }], [inelegivel]),
      opcoes({ referenciaDeTeste: undefined }),
    );
    expect(y.revisoes[0]).toMatchObject({
      classe: 'nao-reproduzivel',
      subcausa: 'sem-build-referencia',
    });
    expect(y.revisoes[0].tentativaOriginal.subcausa).toBe('build-nao-elegivel');
  });

  it('original-divergente, api-ausente, ambiente-invalido e evidência inconsistente NÃO caem para o reprocessamento', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const casos: [Partial<OpcoesHistoricas>, unknown, string][] = [
      [
        {
          executor: new ExecutorEmProcesso({
            alterar: (c) => ((c.avaliacao as { v4: { decisao: string } }).v4.decisao = 'NO_BET'),
          }),
        },
        ev,
        'original-divergente',
      ],
      [
        {
          executor: new ExecutorEmProcesso({
            carregar: async () => ({ ...(await modulosAtuais()), derivar: undefined }),
          }),
        },
        ev,
        'api-ausente',
      ],
      [{ localidade: 'xx-XX' }, ev, 'ambiente-invalido'],
      [{}, { ...ev, meta: { ...ev.meta, hash: '0'.repeat(64) } }, 'evidencia-inconsistente'],
    ];
    for (const [o, e, esperado] of casos) {
      const prov = new ProvedorFalso([C, T]);
      const x = await reproducaoHistorica(
        juncao([{ e: entrada('jogo-r') }], [e as never]),
        opcoes({ ...o, provedor: prov }),
      );
      const r = x.revisoes[0];
      expect(
        ([r.classe, r.subcausa] as string[]).includes(esperado),
        `${esperado}: ${r.classe}/${r.subcausa}`,
      ).toBe(true);
      expect(r.reprocessamento).toBeNull();
      expect(prov.chamadas).not.toContain(T); // a referência nem foi preparada
    }
  });

  it('reprocessamento da evidência com decisão diferente → diverge', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C, { alteracoesLocais: true }));
    const ex = new ExecutorEmProcesso({
      alterar: (c) => ((c.avaliacao as { v4: { decisao: string } }).v4.decisao = 'NO_BET'),
    });
    const [r] = (
      await reproducaoHistorica(juncao([{ e: entrada('jogo-r') }], [ev]), opcoes({ executor: ex }))
    ).revisoes;
    expect(r).toMatchObject({ classe: 'reprocessamento', comparacao: 'diverge' });
    expect(r.reprocessamento?.diferencasDecisao).toBeGreaterThan(0);
  });

  it('cuidado 1: qualquer campo diferente entre as pontas → relógio desconhecido, sem escolher ponta', async () => {
    for (const campo of ['decisao', 'rotulo']) {
      const ex = new ExecutorHistoricoEmProcesso({
        alterar: (r, p) => p === 1 && (r[campo] = `${String(r[campo])}*`),
      });
      const [e] = (
        await reproducaoHistorica(juncao([{ e: entrada('h1') }]), opcoes({ executorHistorico: ex }))
      ).entradas;
      expect(e).toMatchObject({
        destino: 'nao-reproduzivel',
        subcausa: 'relogio-desconhecido',
        comparacao: null,
      });
      expect(e.relogio).toMatchObject({ origem: 'desconhecido' });
      expect(e.diferencasEntrePontas.map((d) => d.caminho)).toEqual([campo]);
      expect(e.pontas.map((p) => p.status)).toEqual(['ok', 'ok']);
    }
  });

  it('cuidado 2: falha de uma ponta nunca vira divergência; o parcial fica preservado', async () => {
    const casos: [ExecutorHistoricoEmProcesso, string][] = [
      [
        new ExecutorHistoricoEmProcesso({ falhar: (p) => (p === 1 ? 'tempo-esgotado' : null) }),
        'tempo-esgotado',
      ],
      [
        new ExecutorHistoricoEmProcesso({ falhar: (p) => (p === 0 ? 'erro-execucao' : null) }),
        'erro-execucao',
      ],
      [
        new ExecutorHistoricoEmProcesso({ status: (p) => (p === 1 ? 'ambiente-invalido' : null) }),
        'ambiente-invalido',
      ],
    ];
    for (const [ex, sub] of casos) {
      const [e] = (
        await reproducaoHistorica(juncao([{ e: entrada('h1') }]), opcoes({ executorHistorico: ex }))
      ).entradas;
      expect(e).toMatchObject({ destino: 'nao-reproduzivel', subcausa: sub, comparacao: null });
      expect(e.pontas).toHaveLength(2);
      const okp = e.pontas.find((p) => p.status === 'ok')!;
      expect(okp.shaResumo).toMatch(/^[0-9a-f]{64}$/); // resultado parcial guardado
      expect(e.motivo).toContain('reprocessamento incompleto');
    }
  });

  it('resumo diferente nas duas pontas igualmente → diverge; V3.3 → protocolo-diferente fora da contagem', async () => {
    const diverge = new ExecutorHistoricoEmProcesso({ alterar: (r) => (r.decisao = 'NO_BET') });
    const v33 = entrada('v33', (e) => (e.resumo.protocolo = 'V3.3'));
    const x = await reproducaoHistorica(
      juncao([{ e: entrada('h1') }, { e: v33 }]),
      opcoes({ executorHistorico: diverge }),
    );
    expect(x.entradas.map((e) => [e.idHistorico, e.comparacao])).toEqual([
      ['h1', 'diverge'],
      ['v33', 'protocolo-diferente'],
    ]);
    expect(x.manifesto.entradas.reprocessamentoPorTipo).toEqual({
      'teste-sintetica': { diverge: 1, 'protocolo-diferente': 1 },
    });
  });

  it('D-b: entrada com cronologia não comprovada → relógio desconhecido, sem executar', async () => {
    const ex = new ExecutorHistoricoEmProcesso();
    const [e] = (
      await reproducaoHistorica(
        juncao([{ e: entrada('h1'), criterio: 'desempate-por-conteudo' }]),
        opcoes({ executorHistorico: ex }),
      )
    ).entradas;
    expect(e).toMatchObject({
      subcausa: 'relogio-desconhecido',
      marcas: ['cronologiaNaoComprovada'],
    });
    expect(ex.chamadas).toEqual([]);
  });

  it('aposta escolhida na lista: seleção nao-comparavel; entrada salva depois do apito: relógio desconhecido', async () => {
    const lista = entrada(
      'h1',
      (e) =>
        (e.aposta = { odd: 1.9, casa: 'Superbet', feitaEm: e.salvoEm, entrada: e.resumo.entrada! }),
    );
    const tarde = entrada('h2', (e) => (e.salvoEm = '2026-11-18T15:30:00-03:00'));
    const x = await reproducaoHistorica(juncao([{ e: lista }, { e: tarde }]), opcoes());
    expect(x.entradas[0].campos.find((c) => c.campo === 'entrada')?.estado).toBe('nao-comparavel');
    expect(x.entradas[1]).toMatchObject({ subcausa: 'relogio-desconhecido' });
  });

  it('conservação, determinismo e F1.2a intacta', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const inel = await evidenciaReproduzivel(buildGravado(C, { alteracoesLocais: true }));
    const j = juncao(
      [
        { e: entrada('jogo-r') },
        { e: entrada('h1') },
        { e: entrada('h1-irma', (e) => (e.irmaDe = 'h1')) },
        { e: entrada('h2', (e) => (e.salvoEm = 'x')) },
      ],
      [ev, { ...inel, meta: { ...inel.meta, revisao: 2, gravadoEm: '2026-11-18T15:00:01.000Z' } }],
    );
    const a = await reproducaoHistorica(j, opcoes());
    const b = await reproducaoHistorica(j, opcoes());
    expect(a.pasta).not.toBe(b.pasta);
    expect(semVariaveisHistorica(b)).toEqual(semVariaveisHistorica(a));
    expect(b.manifesto.impressaoResultados).toBe(a.manifesto.impressaoResultados);
    const soma = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0);
    expect(soma(a.manifesto.revisoes.porClasse)).toBe(2);
    expect(soma(a.manifesto.entradas.porDestino)).toBe(4);
    // reproduzir() da F1.2a, sozinho, continua igual: build-nao-elegivel, sem reprocessar
    const sozinho = await reproduzir([{ evidencia: inel }], {
      area,
      provedor: new ProvedorFalso([C]),
      executor: new ExecutorEmProcesso(),
      localidade: 'pt-BR',
    });
    expect(sozinho.resultados[0]).toMatchObject({
      classe: 'nao-reproduzivel',
      subcausa: 'build-nao-elegivel',
    });
    expect(sozinho.manifesto.contrato).toBe(1);
  });

  it('isolamento: o repositório principal não mudou', async () => {
    await comConteudo(await evidenciaReproduzivel(buildGravado(C)), () => undefined);
    expect(instantaneoRepositorio()).toEqual(antes);
  });
});
