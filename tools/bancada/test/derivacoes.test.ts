/**
 * F1.3 — derivações: régua do desfecho (idêntica ao probEfetiva do motor), estados do desfecho
 * (com o cuidado do conflito-manual só com placar apurável), P do modelo bruto/ajustado, peso w e
 * mistura conferidos contra a evidência (R1, R3 e lista), divergência marcada, v1/v2 só com
 * desfecho (E4), conservação, camadas, relatório sem nomes, determinismo e isolamento.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  blend,
  criarLiquidador,
  criarModelo,
  distribuicaoModelo,
  matrizPlacares,
  probEfetiva,
  type LinhaOdd,
} from '@pe/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArquivoEntrada } from '../src/index';
import type { Derivacoes } from '../src/derivacoes/contratoDerivacoes';
import { apurarDesfecho, regua } from '../src/derivacoes/desfecho';
import { wDe, type InsumosModelo } from '../src/derivacoes/modelo';
import { raizRepositorio, type Area } from '../src/reproducao/area';
import { executarBancada } from '../src/reproducao/executarBancada';
import { REFERENCIA_TESTE_SINTETICA } from '../src/reproducao/referencia';
import { arquivosDerivacoes, C } from './fixtures/derivacoes';
import { ExecutorHistoricoEmProcesso } from './fixtures/historica';
import {
  areaDeTeste,
  ExecutorEmProcesso,
  instantaneoRepositorio,
  ProvedorFalso,
} from './fixtures/reproducao';

const T = REFERENCIA_TESTE_SINTETICA;
const antes = instantaneoRepositorio();
const L = (o: Partial<LinhaOdd>): LinhaOdd =>
  ({
    casa: 'X',
    mercado: 'total',
    lado: 'over',
    linha: 2.5,
    odd: 1.9,
    periodo: 'FT',
    ...o,
  }) as LinhaOdd;
const jogo = (casa: number, fora: number, extra: object = {}) => ({
  placar: { casa, fora, intervalo: null, escanteios: null, cartoes: null, ...extra },
  conflitoPlacar: false,
});

let area: Area;
let arquivos: ArquivoEntrada[];
let d: Derivacoes;
beforeAll(async () => {
  area = areaDeTeste();
  arquivos = await arquivosDerivacoes();
  d = (
    await executarBancada(arquivos, {
      modo: 'execucao',
      area,
      provedor: new ProvedorFalso([C, T]),
      executor: new ExecutorEmProcesso(),
      executorHistorico: new ExecutorHistoricoEmProcesso(),
      repositorio: raizRepositorio(),
      referenciaDeTeste: T,
      derivar: true,
    })
  ).derivacoes!;
});
afterAll(() => {
  rmSync(area.raiz, { recursive: true, force: true });
});

describe('régua do desfecho (a do motor)', () => {
  it('ganho 1/1 · meio ganho 1/½ · devolvida fora · meia perda 0/½ · perda 0/1 — nunca 0,75 nem 0,5', () => {
    expect([1, 0.5, 0, -0.5, -1].map((r) => regua(r as 1))).toEqual([
      { y: 1, peso: 1 },
      { y: 1, peso: 0.5 },
      { y: null, peso: 0 },
      { y: 0, peso: 0.5 },
      { y: 0, peso: 1 },
    ]);
  });

  it('linhas de quarto e inteiras pelo apurarAposta do motor', () => {
    // Dortmund (fora) +1,75 perdendo por exatamente 2: meia perda
    expect(
      apurarDesfecho(L({ mercado: 'AH', lado: 'fora', linha: 1.75 }), jogo(2, 0)),
    ).toMatchObject({ estado: 'apurado', resultado: -0.5, y: 0, peso: 0.5 });
    expect(
      apurarDesfecho(L({ mercado: 'AH', lado: 'fora', linha: 1.75 }), jogo(1, 0)),
    ).toMatchObject({ resultado: 1, y: 1, peso: 1 });
    expect(apurarDesfecho(L({ linha: 2.75 }), jogo(2, 1))).toMatchObject({
      resultado: 0.5,
      y: 1,
      peso: 0.5,
    });
    expect(apurarDesfecho(L({ linha: 2.25 }), jogo(1, 1))).toMatchObject({
      resultado: -0.5,
      y: 0,
      peso: 0.5,
    });
    expect(apurarDesfecho(L({ linha: 3 }), jogo(2, 1))).toMatchObject({
      resultado: 0,
      y: null,
      peso: 0,
    });
    expect(apurarDesfecho(L({}), jogo(1, 0))).toMatchObject({ resultado: -1, y: 0, peso: 1 });
  });

  it('coerência exata: a média ponderada de y sobre a matriz de placares = probEfetiva do motor', () => {
    const lc = 1.62;
    const lf = 1.08;
    const m = matrizPlacares(lc, lf);
    const modelo = criarModelo({ casa: lc, fora: lf });
    for (const l of [
      L({}),
      L({ linha: 2.25 }),
      L({ linha: 2.75 }),
      L({ lado: 'under', linha: 3 }),
      L({ mercado: 'AH', lado: 'fora', linha: 1.75 }),
      L({ mercado: 'AH', lado: 'casa', linha: -0.25 }),
      L({ mercado: '1X2', lado: '1', linha: undefined }),
    ]) {
      let num = 0;
      let den = 0;
      m.forEach((linha, i) =>
        linha.forEach((p, j) => {
          const dz = apurarDesfecho(l, jogo(i, j));
          num += p * dz.peso * (dz.y ?? 0);
          den += p * dz.peso;
        }),
      );
      const r = criarLiquidador(l);
      if (!r.ok) throw new Error(r.motivo);
      expect(num / den, `${l.mercado} ${l.lado} ${l.linha}`).toBeCloseTo(
        probEfetiva(distribuicaoModelo(r.liq, modelo)),
        12,
      );
    }
  });
});

describe('peso w (como a V4 e a lista)', () => {
  const ins = (o: Partial<InsumosModelo>): InsumosModelo => ({
    lambdasBruto: null,
    lambdasAjustado: null,
    contagens: {},
    dq: 'A',
    mercadoMuitoLiquido: false,
    escalacaoIncerta: false,
    ...o,
  });
  it('DQ A 0,50 · B 0,40 · C 0,30 · D 0,20 · E sem modelo; nicho com teto 0,30', () => {
    expect([
      wDe(ins({}), 1),
      wDe(ins({ dq: 'B' }), 1),
      wDe(ins({ dq: 'C' }), 1),
      wDe(ins({ dq: 'D' }), 1),
    ]).toEqual([0.5, 0.4, 0.3, 0.2]);
    expect(wDe(ins({ dq: 'E' }), 1)).toBeNull();
    expect(wDe(ins({}), 3)).toBe(0.3);
    expect(wDe(ins({ dq: 'B' }), 3)).toBe(0.3);
  });
  it('mercado muito líquido ou escalação incerta tiram 0,10', () => {
    expect(wDe(ins({ mercadoMuitoLiquido: true }), 1)).toBe(0.4);
    expect(wDe(ins({ escalacaoIncerta: true }), 1)).toBe(0.4);
  });
});

describe('estados do desfecho', () => {
  it('sem placar, placar em conflito, dado insuficiente e mercado desconhecido', () => {
    expect(apurarDesfecho(L({}), { placar: null, conflitoPlacar: false }).estado).toBe(
      'sem-placar',
    );
    expect(apurarDesfecho(L({}), { placar: null, conflitoPlacar: true }).estado).toBe(
      'placar-em-conflito',
    );
    expect(apurarDesfecho(L({ periodo: '1T', linha: 0.5 }), jogo(2, 1)).estado).toBe(
      'dado-insuficiente',
    );
    expect(apurarDesfecho(L({ mercado: 'outro' as LinhaOdd['mercado'] }), jogo(2, 1)).estado).toBe(
      'mercado-desconhecido',
    );
  });

  it('E3: manual divergente com placar apurável → conflito-manual; sem placar → sem-placar; concordante → apurado', () => {
    expect(apurarDesfecho(L({}), jogo(2, 1), 'red')).toMatchObject({
      estado: 'conflito-manual',
      y: null,
      peso: 0,
      resultado: 1,
    });
    expect(apurarDesfecho(L({}), { placar: null, conflitoPlacar: false }, 'red').estado).toBe(
      'sem-placar',
    );
    expect(apurarDesfecho(L({ periodo: '1T', linha: 0.5 }), jogo(2, 1), 'red').estado).toBe(
      'dado-insuficiente',
    );
    expect(apurarDesfecho(L({}), jogo(2, 1), 'green')).toMatchObject({
      estado: 'apurado',
      y: 1,
      manual: 'green',
    });
  });
});

describe('derivações das seleções (conferidas contra a evidência)', () => {
  const de = (id: string) => d.selecoes.filter((s) => s.idHistorico === id);

  it('R1 (exemplo): P do modelo recalculado = gravado; mistura com o P_true da referência', () => {
    const ss = de('jogo-r');
    expect(ss.length).toBeGreaterThan(0);
    for (const s of ss) {
      expect(s.estado, s.chave).toBe('derivado');
      expect(s.conferencias.length).toBeGreaterThan(0);
      expect(s.conferencias.every((c) => c.confere)).toBe(true);
      expect(s.pMistura).toBeCloseTo(blend(s.pModeloAjustado!, s.pMercadoBase!, s.wMistura!), 12);
      expect(s.status).toBe('reproduzida');
    }
  });

  it('R3 (uma casa): w e P_true gravados conferem; a parte "mercado" é o P_consenso', () => {
    const r3 = de('r3').filter((s) => s.nivelReferencia === 'R3');
    expect(r3.length).toBeGreaterThan(0);
    for (const s of r3) {
      const campos = s.conferencias.map((c) => c.campo);
      expect(campos).toEqual(
        expect.arrayContaining(['pModelo (V4)', 'wModelo (V4, R3)', 'pTrue = mistura (V4, R3)']),
      );
      expect(
        s.conferencias.every((c) => c.confere),
        JSON.stringify(s.conferencias),
      ).toBe(true);
      expect(s.estado).toBe('derivado');
    }
  });

  it('lista "Melhores entradas": a chance gravada confere com a mistura recalculada', () => {
    const s = de('jogo-lista').find((x) =>
      x.conferencias.some((c) => c.campo === 'chance (lista)'),
    )!;
    expect(s).toBeDefined();
    expect(s.conferencias.every((c) => c.confere)).toBe(true);
  });

  it('E1: guarda as duas misturas (ajustada = a da V4; bruta para a F1.4)', () => {
    for (const s of d.selecoes.filter((x) => x.estado === 'derivado')) {
      expect(s.pMistura).not.toBeNull();
      expect(s.pMisturaBruta).toBeCloseTo(blend(s.pModeloBruto!, s.pMercadoBase!, s.wMistura!), 12);
    }
  });

  it('desfecho das seleções pelo placar 2×1 (over 2,5 ganha, under perde)', () => {
    const over = de('jogo-r').find((s) => s.chave === 'total|FT|-|2.5|over')!;
    const under = de('jogo-r').find((s) => s.chave === 'total|FT|-|2.5|under')!;
    expect(over.desfecho).toMatchObject({ estado: 'apurado', y: 1, peso: 1 });
    expect(under.desfecho).toMatchObject({ estado: 'apurado', y: 0, peso: 1 });
  });

  it('λ adulterado → derivacao-divergente, nunca corrigido', async () => {
    const a2 = areaDeTeste();
    try {
      const x = await executarBancada(await arquivosDerivacoes({ adulterarLambda: true }), {
        modo: 'diagnostico',
        area: a2,
        referenciaDeTeste: T,
        derivar: true,
      });
      const ss = x.derivacoes!.selecoes.filter((s) => s.idHistorico === 'jogo-r');
      expect(ss.some((s) => s.estado === 'derivacao-divergente')).toBe(true);
      const dv = ss.find((s) => s.estado === 'derivacao-divergente')!;
      expect(dv.motivo).toContain('pModelo (V4)');
      expect(dv.conferencias.find((c) => c.campo === 'pModelo (V4)')!.confere).toBe(false);
    } finally {
      rmSync(a2.raiz, { recursive: true, force: true });
    }
  });
});

describe('entradas das análises e apostas', () => {
  const ent = (id: string) => d.entradas.find((e) => e.idHistorico === id)!;
  it('E4: v1 sem evidência → só desfecho, modelo indisponível', () => {
    expect(ent('v1')).toMatchObject({
      modelo: 'indisponivel-sem-evidencia',
      desfecho: { estado: 'apurado' },
    });
    expect(ent('jogo-r').modelo).toBe('via-selecao');
    expect(d.selecoes.some((s) => s.idHistorico === 'v1')).toBe(false);
  });

  it('E3 nas entradas: placar apurável + manual divergente → conflito; sem placar → sem-placar', () => {
    expect(ent('man').desfecho).toMatchObject({ estado: 'conflito-manual', manual: 'red' });
    expect(ent('man2').desfecho).toMatchObject({ estado: 'sem-placar', manual: 'red' });
  });

  it('apostas feitas apuradas', () => {
    expect(d.apostas.find((a) => a.idHistorico === 'jogo-r')!.desfecho).toMatchObject({
      estado: 'apurado',
    });
  });
});

describe('conservação, relatório, determinismo e isolamento', () => {
  it('um registro por seleção, por análise elegível e por aposta', async () => {
    const x = await executarBancada(arquivos, {
      modo: 'diagnostico',
      area,
      referenciaDeTeste: T,
      derivar: true,
    });
    expect(x.derivacoes!.conservacao).toEqual({
      selecoes: x.conjunto.selecoes.length,
      entradas: x.conjunto.analises.filter((a) => !a.irmaDe).length,
      apostas: x.conjunto.apostas.length,
    });
    const texto = readFileSync(join(x.pasta, 'relatorio-derivacoes.json'), 'utf8');
    for (const n of ['Flamengo', 'Remo', 'Superbet', 'Pinnacle', 'jogo-r', 'man2'])
      expect(texto).not.toContain(n);
    expect(JSON.parse(texto).selecoes.conferencias.divergentes).toBe(0);
  });

  it('determinístico', async () => {
    const a = await executarBancada(arquivos, {
      modo: 'diagnostico',
      area,
      referenciaDeTeste: T,
      derivar: true,
    });
    const b = await executarBancada(arquivos, {
      modo: 'diagnostico',
      area,
      referenciaDeTeste: T,
      derivar: true,
    });
    expect(JSON.stringify(b.derivacoes)).toBe(JSON.stringify(a.derivacoes));
  });

  it('o repositório principal não mudou', () => {
    expect(instantaneoRepositorio()).toEqual(antes);
  });
});
