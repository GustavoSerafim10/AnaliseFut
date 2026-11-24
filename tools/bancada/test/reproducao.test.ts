/**
 * F1.2a — suíte rápida (sem instalar build): comparação, restauração da entrada, ambiente,
 * elegibilidade, área isolada, classificação, falhas de processo, determinismo e isolamento.
 * Os testes com build real ficam em test-reproducao/ (npm run test:reproducao).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { garantirForaDoRepositorio, raizRepositorio, type Area } from '../src/reproducao/area';
import { elegibilidade, type BuildPreparado } from '../src/reproducao/build';
import {
  compararConteudos,
  dentroDaTolerancia,
  ehCampoDecisao,
  tipoDe,
} from '../src/reproducao/comparar';
import { ExecutorProcesso } from '../src/reproducao/executor';
import {
  medirAmbiente,
  restaurarEntrada,
  validarAmbiente,
} from '../src/reproducao/harness/zz-bancada-nucleo';
import { reproduzir, semVariaveis, type OpcoesReproducao } from '../src/reproducao/reproduzir';
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
let area: Area;
const antes = instantaneoRepositorio();
const amb = medirAmbiente();

beforeAll(() => {
  area = areaDeTeste();
});
afterAll(() => {
  rmSync(area.raiz, { recursive: true, force: true });
});

const opcoes = (o: Partial<OpcoesReproducao> = {}): OpcoesReproducao => ({
  area,
  provedor: new ProvedorFalso([C]),
  executor: new ExecutorEmProcesso(),
  // a localidade desta máquina é a medida; o teste de ambiente-invalido força uma errada
  localidade: amb.localidade,
  ...o,
});

describe('comparação (ajuste 3: tipos nunca se confundem)', () => {
  it('ausente, null, NaN, ±Infinity e {$invalido} são tipos distintos', () => {
    expect(
      [
        undefined,
        null,
        Number.NaN,
        Infinity,
        -Infinity,
        { $invalido: 'NaN' },
        { $invalido: 'Infinity' },
        0,
      ].map(tipoDe),
    ).toEqual([
      'ausente',
      'null',
      'NaN',
      'Infinity',
      '-Infinity',
      'invalido:NaN',
      'invalido:Infinity',
      'numero',
    ]);
    const d = compararConteudos(
      { a: null, b: { $invalido: 'NaN' }, c: 1, e: Number.NaN },
      { b: Number.NaN, c: null, d: null, e: { $invalido: 'NaN' } },
    );
    expect(d.map((x) => [x.caminho, x.tipo, x.original.tipo, x.reproduzido.tipo])).toEqual([
      ['a', 'tipo', 'null', 'ausente'],
      ['b', 'tipo', 'invalido:NaN', 'NaN'],
      ['c', 'tipo', 'numero', 'null'],
      ['d', 'tipo', 'ausente', 'null'],
      ['e', 'tipo', 'NaN', 'invalido:NaN'],
    ]);
    expect(
      compararConteudos({ x: { $invalido: '-Infinity' } }, { x: { $invalido: '-Infinity' } }),
    ).toEqual([]);
  });

  it('tolerância D3: |a−b| ≤ max(1e-12, 1e-12·max(|a|,|b|))', () => {
    expect(dentroDaTolerancia(0, 1e-12)).toBe(true);
    expect(dentroDaTolerancia(0, 1.0001e-12)).toBe(false);
    expect(dentroDaTolerancia(1e6, 1e6 + 9e-7)).toBe(true);
    expect(dentroDaTolerancia(1e6, 1e6 + 1.1e-6)).toBe(false);
    const umUlp = 0.5324892117167118 + Number.EPSILON / 2;
    expect(compararConteudos({ p: 0.5324892117167118 }, { p: umUlp })[0].tipo).toBe(
      'numero-na-tolerancia',
    );
  });

  it('campos de decisão: o próprio, dentro dele, o pai e itens da lista', () => {
    for (const c of [
      'avaliacao.v4.decisao',
      'avaliacao.v4.melhor.stake.fracaoBanca',
      'avaliacao.v4.melhor',
      'avaliacao.v4',
      'avaliacao.entradas.entradas[3].chave',
      'avaliacao.entradas.entradas[3]',
      'modelo.dq.dq',
    ])
      expect(ehCampoDecisao(c), c).toBe(true);
    for (const c of [
      'avaliacao.v4.melhor.pModelo',
      'avaliacao.entradas.entradas[0].odd',
      'modelo.lambda',
    ])
      expect(ehCampoDecisao(c), c).toBe(false);
  });
});

describe('restauração da entrada ({$invalido})', () => {
  const inv = [
    { campo: 'entrada.rascunho.x', valor: 'NaN', motivo: 'número não finito (NaN) no resultado' },
  ];
  it('marcador listado volta ao número original', () => {
    const r = restaurarEntrada({ rascunho: { x: { $invalido: 'NaN' }, y: 1 } }, inv);
    expect(r.ok && Number.isNaN((r.valor as { rascunho: { x: number } }).rascunho.x)).toBe(true);
  });
  it('marcador fora da lista, valor diferente, referência circular ou {$omitido}: irrecuperável', () => {
    expect(restaurarEntrada({ rascunho: { z: { $invalido: 'NaN' } } }, inv).ok).toBe(false);
    expect(restaurarEntrada({ rascunho: { x: { $invalido: 'Infinity' } } }, inv).ok).toBe(false);
    const circ = [{ campo: 'entrada.rascunho.x', valor: 'NaN', motivo: 'referência circular' }];
    expect(restaurarEntrada({ rascunho: { x: { $invalido: 'NaN' } } }, circ).ok).toBe(false);
    const om = restaurarEntrada({ rascunho: { f: { $omitido: 'function' } } }, []);
    expect(om.ok === false && om.motivo).toContain('$omitido');
  });
});

describe('ambiente (ajuste 1: fuso e localidade efetivos)', () => {
  it('fuso efetivo deste processo é o esperado, medido pelo deslocamento', () => {
    expect(amb.fuso).toBe('America/Sao_Paulo');
    expect(amb.deslocamentoMin).toBe(180);
    expect(
      validarAmbiente(amb, {
        fuso: 'America/Sao_Paulo',
        localidade: amb.localidade,
        localidadeRelevante: true,
      }),
    ).toBeNull();
  });
  it('fuso ou localidade diferentes são recusados; localidade só pesa quando relevante', () => {
    expect(
      validarAmbiente(amb, {
        fuso: 'Europe/Lisbon',
        localidade: amb.localidade,
        localidadeRelevante: true,
      }),
    ).toMatch(/fuso efetivo/);
    expect(
      validarAmbiente(
        { ...amb, deslocamentoMin: 0 },
        { fuso: amb.fuso, localidade: amb.localidade, localidadeRelevante: false },
      ),
    ).toMatch(/deslocamento/);
    expect(
      validarAmbiente(amb, { fuso: amb.fuso, localidade: 'xx-XX', localidadeRelevante: true }),
    ).toMatch(/localidade efetiva/);
    expect(
      validarAmbiente(amb, { fuso: amb.fuso, localidade: 'xx-XX', localidadeRelevante: false }),
    ).toBeNull();
  });
});

describe('elegibilidade e área isolada', () => {
  it('só build com commit e sem alterações locais é original', () => {
    expect(elegibilidade({ commit: C, origem: 'github-actions', alteracoesLocais: false }).ok).toBe(
      true,
    );
    expect(elegibilidade({ commit: C, origem: 'git-local', alteracoesLocais: false }).ok).toBe(
      true,
    );
    expect(elegibilidade({ commit: C, origem: 'git-local', alteracoesLocais: true }).ok).toBe(
      false,
    );
    expect(elegibilidade({ commit: C, origem: 'git-local', alteracoesLocais: null }).ok).toBe(
      false,
    );
    expect(elegibilidade({ commit: null, origem: 'desconhecida', alteracoesLocais: null }).ok).toBe(
      false,
    );
    expect(
      elegibilidade({ commit: 'abc', origem: 'github-actions', alteracoesLocais: false }).ok,
    ).toBe(false);
  });
  it('área dentro do repositório é recusada', () => {
    const repo = raizRepositorio();
    expect(() => garantirForaDoRepositorio(repo)).toThrow(/dentro do repositório/);
    expect(() => garantirForaDoRepositorio(join(repo, 'tools', 'x'))).toThrow(
      /dentro do repositório/,
    );
    expect(garantirForaDoRepositorio(area.raiz)).toBe(area.raiz);
  });
});

describe('classificação (build falso, executor no processo)', () => {
  it('teste 1 (rápido): mesma conta, mesmo relógio → original-exata', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const { resultados, manifesto } = await reproduzir([{ evidencia: ev }], opcoes());
    expect(resultados[0]).toMatchObject({
      classe: 'original-exata',
      subcausa: null,
      hashReproduzido: ev.meta.hash,
      relogio: { valor: ev.meta.calculadoEm.inicio, origem: 'calculadoEm' },
      diferencas: [],
    });
    expect(resultados[0].ambiente).toMatchObject({
      fuso: 'America/Sao_Paulo',
      deslocamentoMin: 180,
    });
    expect(manifesto.porClasse).toEqual({ 'original-exata': 1 });
  });

  it('teste 2 (rápido): relógio depois do apito muda a decisão → original-divergente', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const depois = new Date(Date.parse(ev.conteudo.jogo.inicio) + 60_000).toISOString();
    const { resultados } = await reproduzir(
      [{ evidencia: ev }],
      opcoes({ substituirRelogioEmTeste: depois }),
    );
    const r = resultados[0];
    expect(r.classe).toBe('original-divergente');
    expect(r.relogio.origem).toBe('substituido-em-teste');
    expect(r.diferencas.find((d) => d.caminho === 'avaliacao.v4.decisao')).toMatchObject({
      decisao: true,
    });
  });

  it('teste 3: 1 ULP fora da decisão → equivalente; na decisão → divergente; decisão trocada → divergente', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const ulp = (x: number) => x + Math.abs(x) * Number.EPSILON;
    type V4 = { v4: { melhor: { pModelo: number; ev: number }; decisao: string } };
    const em = (f: (a: V4) => void) =>
      new ExecutorEmProcesso({ alterar: (c) => f(c.avaliacao as V4) });
    const [eq] = (
      await reproduzir(
        [{ evidencia: ev }],
        opcoes({ executor: em((a) => (a.v4.melhor.pModelo = ulp(a.v4.melhor.pModelo))) }),
      )
    ).resultados;
    expect(eq).toMatchObject({
      classe: 'original-equivalente',
      diferencasTotal: 1,
      diferencasDecisao: 0,
    });
    expect(eq.diferencas[0]).toMatchObject({
      caminho: 'avaliacao.v4.melhor.pModelo',
      tipo: 'numero-na-tolerancia',
    });
    const [dv] = (
      await reproduzir(
        [{ evidencia: ev }],
        opcoes({ executor: em((a) => (a.v4.melhor.ev = ulp(a.v4.melhor.ev))) }),
      )
    ).resultados;
    expect(dv).toMatchObject({ classe: 'original-divergente', diferencasDecisao: 1 });
    expect(dv.diferencas[0]).toMatchObject({
      caminho: 'avaliacao.v4.melhor.ev',
      tipo: 'numero-na-tolerancia',
      decisao: true,
    });
    const [dc] = (
      await reproduzir(
        [{ evidencia: ev }],
        opcoes({ executor: em((a) => (a.v4.decisao = 'NO_BET')) }),
      )
    ).resultados;
    expect(dc).toMatchObject({ classe: 'original-divergente' });
    expect(dc.diferencas[0]).toMatchObject({
      caminho: 'avaliacao.v4.decisao',
      tipo: 'valor',
      decisao: true,
    });
  });

  it('teste 4: alterações locais / sem commit → build-nao-elegivel; commit desconhecido → commit-ausente', async () => {
    const itens = [
      { evidencia: await evidenciaReproduzivel(buildGravado(C, { alteracoesLocais: true })) },
      {
        evidencia: await evidenciaReproduzivel(
          buildGravado(null as never, { origem: 'desconhecida', alteracoesLocais: null }),
        ),
      },
      { evidencia: await evidenciaReproduzivel(buildGravado('b'.repeat(40))) },
    ];
    const prov = new ProvedorFalso([C]);
    const { resultados, manifesto } = await reproduzir(itens, opcoes({ provedor: prov }));
    expect(resultados.map((r) => [r.classe, r.subcausa])).toEqual([
      ['nao-reproduzivel', 'build-nao-elegivel'],
      ['nao-reproduzivel', 'build-nao-elegivel'],
      ['nao-reproduzivel', 'commit-ausente'],
    ]);
    expect(resultados[0].motivo).toContain('F1.2b');
    expect(prov.chamadas).toEqual(['b'.repeat(40)]); // não elegível nem chega a preparar build
    expect(manifesto.porSubcausa).toEqual({ 'build-nao-elegivel': 2, 'commit-ausente': 1 });
  });

  it('teste 5 (rápido): build sem a API → api-ausente', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const semMontar = async () => ({ ...(await modulosAtuais()), montarConteudo: undefined });
    const falha = async () => {
      throw new Error('Cannot find module ../src/evidencias');
    };
    const a = await reproduzir(
      [{ evidencia: ev }],
      opcoes({ executor: new ExecutorEmProcesso({ carregar: semMontar }) }),
    );
    expect(a.resultados[0]).toMatchObject({
      subcausa: 'api-ausente',
      motivo: 'o build não exporta: montarConteudo',
    });
    const b = await reproduzir(
      [{ evidencia: ev }],
      opcoes({ executor: new ExecutorEmProcesso({ carregar: falha }) }),
    );
    expect(b.resultados[0].subcausa).toBe('api-ausente');
  });

  it('teste 6: NaN na entrada volta pelo registro e reproduz; marcador sem registro → entrada-irrecuperavel', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C), (r) => ({
      ...r,
      odds: r.odds.map((l, i) => (i === 0 ? { ...l, odd: Number.NaN } : l)),
    }));
    expect(ev.conteudo.invalidos.map((i) => i.campo)).toContain('entrada.rascunho.odds[0].odd');
    expect((await reproduzir([{ evidencia: ev }], opcoes())).resultados[0].classe).toBe(
      'original-exata',
    );
    const semRegistro = await comConteudo(ev, (c) => {
      c.invalidos = c.invalidos.filter((i) => !i.campo.startsWith('entrada.'));
    });
    const [r] = (await reproduzir([{ evidencia: semRegistro }], opcoes())).resultados;
    expect(r).toMatchObject({ classe: 'nao-reproduzivel', subcausa: 'entrada-irrecuperavel' });
    expect(r.motivo).toContain('entrada.rascunho.odds[0].odd');
  });

  it('evidência adulterada, relógio ilegível e ambiente errado: cada um com a sua subcausa', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const adulterada = { ...ev, meta: { ...ev.meta, hash: '0'.repeat(64) } };
    const semRelogio = { ...ev, meta: { ...ev.meta, calculadoEm: { inicio: 'x', fim: 'x' } } };
    const { resultados } = await reproduzir(
      [{ evidencia: adulterada }, { evidencia: semRelogio }],
      opcoes(),
    );
    expect(resultados.map((r) => r.subcausa)).toEqual([
      'evidencia-inconsistente',
      'relogio-desconhecido',
    ]);
    const [amb2] = (await reproduzir([{ evidencia: ev }], opcoes({ localidade: 'xx-XX' })))
      .resultados;
    expect(amb2).toMatchObject({ subcausa: 'ambiente-invalido', localidadeRelevante: true });
  });

  it('marcas da F1.1 (cronologiaNaoComprovada) seguem no resultado', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const [r] = (
      await reproduzir([{ evidencia: ev, marcas: ['cronologiaNaoComprovada'] }], opcoes())
    ).resultados;
    expect(r.marcas).toEqual(['cronologiaNaoComprovada']);
  });
});

describe('teste 7: falhas do processo (executor real, vitest falso)', () => {
  /** "build" falso: node_modules/vitest/vitest.mjs é um script que faz o que o caso pedir */
  function buildFalso(script: string): BuildPreparado {
    const fonte = join(area.builds, `falso-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(join(fonte, 'node_modules', 'vitest'), { recursive: true });
    const arq = join(fonte, 'node_modules', 'vitest', 'vitest.mjs');
    writeFileSync(arq, script);
    chmodSync(arq, 0o755);
    return {
      commit: C,
      fonte,
      shaLockfile: null,
      hashDependencias: null,
      npm: null,
      localidadeRelevante: false,
    };
  }
  const provedorCom = (b: BuildPreparado) => ({
    preparar: async () => ({ ok: true as const, build: b }),
  });

  it('travou → tempo-esgotado com a árvore encerrada; erro → erro-execucao; o caso seguinte não é afetado', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const pidArq = join(area.raiz, 'pid-travado.txt');
    const travado = buildFalso(
      `import { writeFileSync } from 'node:fs'; import { spawn } from 'node:child_process';
       const neto = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true }); neto.unref();
       writeFileSync(${JSON.stringify(pidArq)}, String(neto.pid)); setInterval(() => {}, 1000);`,
    );
    const quebrado = buildFalso(`console.error('falha proposital'); process.exit(3);`);
    const bom = buildFalso(
      `import { readFileSync, writeFileSync } from 'node:fs';
       writeFileSync(process.env.PE_BANCADA_SAIDA, JSON.stringify({ status: 'erro-execucao', motivo: 'harness respondeu: ' + process.env.TZ, ambiente: null }));`,
    );
    const ex = new ExecutorProcesso();
    const rodar = (b: BuildPreparado) =>
      reproduzir(
        [{ evidencia: ev }],
        opcoes({ provedor: provedorCom(b), executor: ex, tempoLimiteMs: 2_000 }),
      );

    const t = await rodar(travado);
    expect(t.resultados[0]).toMatchObject({
      classe: 'nao-reproduzivel',
      subcausa: 'tempo-esgotado',
    });
    expect(existsSync(join(t.pasta, t.resultados[0].falha!.registro!))).toBe(true);
    const neto = Number(readFileSync(pidArq, 'utf8'));
    // neto fora do job do pai (detached): só o encerramento da árvore (/T) o alcança
    try {
      expect(() => process.kill(neto, 0)).toThrow();
    } finally {
      try {
        process.kill(neto);
      } catch {
        /* já encerrado */
      }
    }

    const q = await rodar(quebrado);
    expect(q.resultados[0]).toMatchObject({ subcausa: 'erro-execucao', falha: { codigoSaida: 3 } });
    expect(readFileSync(join(q.pasta, q.resultados[0].falha!.registro!), 'utf8')).toContain(
      'falha proposital',
    );

    const b = await rodar(bom);
    expect(b.resultados[0]).toMatchObject({
      subcausa: 'erro-execucao',
      motivo: 'harness respondeu: America/Sao_Paulo',
    });
  });
});

describe('teste 11 (rápido): determinismo', () => {
  it('duas execuções iguais: classificação, motivos, diferenças e conteúdo reproduzido idênticos', async () => {
    const ev = await evidenciaReproduzivel(buildGravado(C));
    const itens = [
      { evidencia: ev },
      { evidencia: { ...ev, meta: { ...ev.meta, hash: '1'.repeat(64) } } },
    ];
    const ex = new ExecutorEmProcesso({
      alterar: (c) =>
        ((c.avaliacao as { v4: { melhor: { pModelo: number } } }).v4.melhor.pModelo += 1e-16),
    });
    const a = await reproduzir(itens, opcoes({ executor: ex }));
    const b = await reproduzir(itens, opcoes({ executor: ex }));
    expect(a.pasta).not.toBe(b.pasta);
    expect(b.resultados.map(semVariaveis)).toEqual(a.resultados.map(semVariaveis));
    expect(b.manifesto.impressaoResultados).toBe(a.manifesto.impressaoResultados);
    const sha = a.resultados[0].shaConteudoReproduzido!;
    expect(readFileSync(join(b.pasta, 'conteudos', `${sha}.json`), 'utf8')).toBe(
      readFileSync(join(a.pasta, 'conteudos', `${sha}.json`), 'utf8'),
    );
    expect(Object.values(a.manifesto.porClasse).reduce((s, n) => s + n, 0)).toBe(itens.length);
  });
});

describe('teste 10 (rápido): isolamento', () => {
  it('o repositório principal não mudou (status, refs, worktrees, stash, HEAD)', () => {
    expect(instantaneoRepositorio()).toEqual(antes);
  });
  it('nada foi escrito no repositório: os harnesses só existem na área isolada', () => {
    const repo = raizRepositorio();
    expect(existsSync(join(repo, 'apps', 'web', 'test', 'zz-bancada-harness.test.ts'))).toBe(false);
    expect(existsSync(join(repo, 'apps', 'web', 'test', 'zz-bancada-nucleo.ts'))).toBe(false);
  });
});
