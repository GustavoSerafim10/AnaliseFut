/**
 * Segunda rodada de endurecimento da L1: contrato de tipos e domínios dos corpos, `corrige` exato e
 * íntegro, e limites de data/deslocamento. Os registros inválidos são FORJADOS com o hash
 * recalculado: o hash confere, então só a regra nova os detecta, em `criarRegistro`,
 * `conferirRegistro`/`aceitarAnexo` e `verificarCadeia`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TravasBanca } from '../../src/banca';
import type { StakeAutorizada } from '../../src/kelly';
import {
  aceitarAnexo,
  conferirRegistro,
  criarRegistro,
  ehDataIsoComDeslocamento,
  hashDoRegistro,
  verificarCadeia,
  type CorpoLedger,
  type RegistroLedger,
  type TipoRegistro,
} from '../../src/ledger';

const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
const HASH = 'a'.repeat(64);
type Obj = Record<string, unknown>;
const clonar = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
const codigos = (r: { problemas: { codigo: string }[] }) => r.problemas.map((p) => p.codigo);

const STAKE_OK = {
  autorizada: true,
  kellyCheio: 0.2,
  fracaoKelly: 0.25,
  fracaoBanca: 0.02,
  limites: ['teto'],
  teto: 0.02,
  valor: 20,
};
const TRAVAS_OK = {
  bancaInicial: 1000,
  bancaAtual: 1000,
  pico: 1000,
  drawdown: 0,
  fatorKelly: 1,
  pausadoAte: null,
  perdasHoje: 0,
  diaEncerrado: false,
  expostoHoje: 0,
  motivos: [],
};

const CORPOS: Record<TipoRegistro, CorpoLedger> = {
  decisao: {
    entradaMotor: { v4: null, lista: null },
    saida: { v4: null, lista: null },
    snapshot: { odds: [], estatisticas: {}, contexto: {}, prints: { 'print-1': HASH } },
    impressao: 'abc',
  },
  aposta_registrada: {
    decisao: { seq: 1, hash: HASH },
    aposta: { odd: 2, casa: '1win', valor: 10, feitaEm: T(2) },
    stakeAutorizada: STAKE_OK,
    travas: TRAVAS_OK,
  },
  resultado: {
    decisao: null,
    resultado: { casa: 1, fora: 0, registradoEm: T(3), placar: [1, 0] },
  },
  correcao: { motivo: 'placar digitado errado', novo: { casa: 2, fora: 1 } },
  exclusao: { motivo: null },
};

type Pedido = Parameters<typeof criarRegistro>[0];
const pedido = (tipo: TipoRegistro, n: number, extra: Partial<Pedido> = {}): Pedido => ({
  tipo,
  cadeia: 'A',
  criadoEm: T(n),
  corpo: CORPOS[tipo],
  versaoMotor: 'teste',
  politicas: { x: 1 },
  ...extra,
});

const ORDEM: TipoRegistro[] = ['decisao', 'aposta_registrada', 'resultado', 'correcao', 'exclusao'];
const IDX = { decisao: 0, aposta: 1, resultado: 2, correcao: 3, exclusao: 4 };

/** Cadeia íntegra com os cinco tipos; a correção (seq 4) corrige o resultado (seq 3). */
async function cadeia(): Promise<RegistroLedger[]> {
  const lista: RegistroLedger[] = [];
  for (const [i, tipo] of ORDEM.entries()) {
    const extra: Partial<Pedido> =
      tipo === 'correcao' ? { corrige: { seq: 3, hash: lista[2].hash } } : {};
    lista.push(await criarRegistro(pedido(tipo, i + 1, extra), lista.at(-1) ?? null));
  }
  return lista;
}

/** Copia o registro, aplica a alteração e RECALCULA o hash. */
async function forjar(r: RegistroLedger, alterar: (c: RegistroLedger) => void) {
  const f = clonar(r);
  alterar(f);
  f.hash = await hashDoRegistro(f.cabecalho, f.corpo);
  return f;
}

const REMOVER = Symbol('remover');
/** Define (ou remove) um campo do corpo por caminho: 'aposta.odd', 'snapshot.odds'… */
const definir = (caminho: string, valor: unknown) => (c: RegistroLedger) => {
  const partes = caminho.split('.');
  let o = c.corpo as unknown as Obj;
  for (const p of partes.slice(0, -1)) o = o[p] as Obj;
  const campo = partes[partes.length - 1];
  if (valor === REMOVER) delete o[campo];
  else o[campo] = valor;
};

/** O corpo forjado (hash coerente) é recusado em TODAS as portas. */
async function recusa(idx: number, alterar: (c: RegistroLedger) => void, esperado: RegExp) {
  const lista = await cadeia();
  const forjado = await forjar(lista[idx], alterar);
  await expect(conferirRegistro(forjado)).rejects.toThrow(esperado);
  await expect(aceitarAnexo(lista[idx - 1] ?? null, forjado)).rejects.toThrow(esperado);
  const rel = await verificarCadeia([...lista.slice(0, idx), forjado]);
  expect(rel.estado).toBe('adulterada');
  expect(codigos(rel)).toContain('corpo_incompativel');
  const refeito = await criarRegistro(
    {
      ...pedido(forjado.cabecalho.tipo, idx + 1),
      corpo: forjado.corpo,
      ...(forjado.cabecalho.corrige ? { corrige: forjado.cabecalho.corrige } : {}),
    },
    lista[idx - 1] ?? null,
  ).catch((e: unknown) => e);
  expect(refeito).toBeInstanceOf(Error);
  expect((refeito as Error).message).toMatch(esperado);
}

/** O corpo alterado continua válido: aceito, e a cadeia até ele é íntegra. */
async function aceita(idx: number, alterar: (c: RegistroLedger) => void) {
  const lista = await cadeia();
  const forjado = await forjar(lista[idx], alterar);
  await expect(conferirRegistro(forjado)).resolves.toBeUndefined();
  await expect(aceitarAnexo(lista[idx - 1] ?? null, forjado)).resolves.toBeUndefined();
  const rel = await verificarCadeia([...lista.slice(0, idx), forjado]);
  expect(rel.problemas).toEqual([]);
  expect(rel.estado).toBe('integra');
}

// ───────────────────────── 1. corpos

describe('decisao: saida, odds, estatisticas e contexto', () => {
  const invalidos: [string, unknown, RegExp][] = [
    ['saida', 5, /saida/],
    ['saida', 'x', /saida/],
    ['saida', null, /saida/],
    ['saida', [], /saida/],
    ['snapshot.odds', 'texto', /odds/],
    ['snapshot.odds', null, /odds/],
    ['snapshot.odds', {}, /odds/],
    ['snapshot.estatisticas', [], /estatisticas/],
    ['snapshot.estatisticas', 7, /estatisticas/],
    ['snapshot.estatisticas', null, /estatisticas/],
    ['snapshot.contexto', false, /contexto/],
    ['snapshot.contexto', [], /contexto/],
  ];
  for (const [caminho, valor, re] of invalidos)
    it(`recusa ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await recusa(IDX.decisao, definir(caminho, valor), re);
    });

  const validos: [string, unknown][] = [
    ['saida', {}],
    ['saida', { v4: { decisao: 'NO_BET' } }],
    ['saida', { v4: null, lista: null }],
    ['snapshot.odds', []],
    ['snapshot.odds', [{ casa: 'x' }, { casa: 'y' }]],
    ['snapshot.estatisticas', {}],
    ['snapshot.estatisticas', { modeloCasa: { stats: null, declaracoes: [], faltando: [] } }],
    ['snapshot.contexto', {}],
  ];
  for (const [caminho, valor] of validos)
    it(`aceita ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await aceita(IDX.decisao, definir(caminho, valor));
    });
});

describe('aposta_registrada.aposta', () => {
  const invalidos: [string, unknown, RegExp][] = [
    ['aposta', 7, /aposta/],
    ['aposta', [], /aposta/],
    ['aposta', null, /aposta/],
    ['aposta.odd', 1, /odd/],
    ['aposta.odd', 0.5, /odd/],
    ['aposta.odd', '2', /odd/],
    ['aposta.odd', Number.POSITIVE_INFINITY, /odd/],
    ['aposta.odd', null, /odd/],
    ['aposta.odd', REMOVER, /odd/],
    ['aposta.casa', '', /casa/],
    ['aposta.casa', '   ', /casa/],
    ['aposta.casa', 5, /casa/],
    ['aposta.casa', REMOVER, /casa/],
    ['aposta.feitaEm', 'ontem', /feitaEm/],
    ['aposta.feitaEm', '2026-02-30T10:00:00-03:00', /feitaEm/],
    ['aposta.feitaEm', '2026-11-13T15:00:00+14:01', /feitaEm/],
    ['aposta.feitaEm', 20261113, /feitaEm/],
    ['aposta.feitaEm', REMOVER, /feitaEm/],
    ['aposta.valor', -1, /valor/],
    ['aposta.valor', '10', /valor/],
    ['aposta.valor', null, /valor/],
    ['aposta.valor', Number.POSITIVE_INFINITY, /valor/],
    ['aposta.entrada', [], /entrada/],
    ['aposta.entrada', 'x', /entrada/],
  ];
  for (const [caminho, valor, re] of invalidos)
    it(`recusa ${caminho} = ${String(JSON.stringify(valor))}`, async () => {
      // Infinity não passa pelo JSON, então não dá para rehashear: o corpo é recusado antes
      if (valor === Number.POSITIVE_INFINITY) {
        const lista = await cadeia();
        const f = clonar(lista[IDX.aposta]);
        definir(caminho, valor)(f);
        await expect(conferirRegistro(f)).rejects.toThrow(re);
        return;
      }
      await recusa(IDX.aposta, definir(caminho, valor), re);
    });

  const validos: [string, unknown][] = [
    ['aposta.valor', REMOVER],
    ['aposta.valor', 0],
    ['aposta.odd', 1.01],
    ['aposta.extra', 1],
    ['aposta.entrada', {}],
    ['aposta.feitaEm', '2026-11-13T18:00:00Z'],
  ];
  for (const [caminho, valor] of validos)
    it(`aceita ${caminho} = ${valor === REMOVER ? '(ausente)' : JSON.stringify(valor)}`, async () => {
      await aceita(IDX.aposta, definir(caminho, valor));
    });
});

describe('aposta_registrada.stakeAutorizada × StakeAutorizada (kelly.ts)', () => {
  // o compilador exige uma linha para CADA campo declarado em StakeAutorizada
  const CAMPOS: Record<keyof StakeAutorizada, 'obrigatorio' | 'opcional'> = {
    autorizada: 'obrigatorio',
    motivo: 'opcional',
    kellyCheio: 'obrigatorio',
    fracaoKelly: 'obrigatorio',
    fracaoBanca: 'obrigatorio',
    limites: 'obrigatorio',
    teto: 'obrigatorio',
    valor: 'opcional',
  };
  for (const [campo, tipo] of Object.entries(CAMPOS))
    if (tipo === 'obrigatorio')
      it(`campo obrigatório ${campo} ausente é recusado`, async () => {
        await recusa(IDX.aposta, definir(`stakeAutorizada.${campo}`, REMOVER), /stakeAutorizada/);
      });
    else
      it(`campo opcional ${campo} pode faltar`, async () => {
        await aceita(IDX.aposta, definir(`stakeAutorizada.${campo}`, REMOVER));
      });

  const invalidos: [string, unknown][] = [
    ['stakeAutorizada', 'x'],
    ['stakeAutorizada', null],
    ['stakeAutorizada', []],
    ['stakeAutorizada.autorizada', 'sim'],
    ['stakeAutorizada.autorizada', 1],
    ['stakeAutorizada.kellyCheio', '0.2'],
    ['stakeAutorizada.kellyCheio', null],
    ['stakeAutorizada.fracaoKelly', -0.25],
    ['stakeAutorizada.fracaoBanca', -0.01],
    ['stakeAutorizada.fracaoBanca', '0.02'],
    ['stakeAutorizada.teto', -1],
    ['stakeAutorizada.limites', 'teto'],
    ['stakeAutorizada.limites', ['semana']],
    ['stakeAutorizada.limites', [1]],
    ['stakeAutorizada.limites', null],
    ['stakeAutorizada.motivo', 5],
    ['stakeAutorizada.valor', -1],
    ['stakeAutorizada.valor', '20'],
    ['stakeAutorizada.valor', null],
  ];
  for (const [caminho, valor] of invalidos)
    it(`recusa ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await recusa(IDX.aposta, definir(caminho, valor), /stakeAutorizada/);
    });

  const validos: [string, unknown][] = [
    ['stakeAutorizada.kellyCheio', -0.1], // EV negativo continua negativo
    ['stakeAutorizada.autorizada', false],
    ['stakeAutorizada.motivo', 'sem vantagem: EV nulo ou negativo'],
    ['stakeAutorizada.limites', []],
    ['stakeAutorizada.limites', ['teto', 'jogo', 'dia']],
    ['stakeAutorizada.valor', 0],
    ['stakeAutorizada.maisUmCampoDoMotor', 1], // campos a mais são tolerados
  ];
  for (const [caminho, valor] of validos)
    it(`aceita ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await aceita(IDX.aposta, definir(caminho, valor));
    });
});

describe('aposta_registrada.travas × TravasBanca (banca.ts)', () => {
  const CAMPOS: Record<keyof TravasBanca, 'obrigatorio' | 'opcional'> = {
    bancaInicial: 'obrigatorio',
    bancaAtual: 'obrigatorio',
    pico: 'obrigatorio',
    drawdown: 'obrigatorio',
    fatorKelly: 'obrigatorio',
    pausadoAte: 'obrigatorio', // string | null: precisa estar presente, null vale
    perdasHoje: 'obrigatorio',
    diaEncerrado: 'obrigatorio',
    expostoHoje: 'obrigatorio',
    expostoJogo: 'opcional',
    motivos: 'obrigatorio',
  };
  for (const [campo, tipo] of Object.entries(CAMPOS))
    if (tipo === 'obrigatorio')
      it(`campo obrigatório ${campo} ausente é recusado`, async () => {
        await recusa(IDX.aposta, definir(`travas.${campo}`, REMOVER), /travas/);
      });
    else
      it(`campo opcional ${campo} pode faltar`, async () => {
        await aceita(IDX.aposta, definir(`travas.${campo}`, REMOVER));
      });

  const invalidos: [string, unknown][] = [
    ['travas', null],
    ['travas', 'x'],
    ['travas', []],
    ['travas.bancaInicial', '1000'],
    ['travas.bancaAtual', null],
    ['travas.pico', true],
    ['travas.drawdown', -0.1],
    ['travas.fatorKelly', -1],
    ['travas.pausadoAte', 'ontem'],
    ['travas.pausadoAte', 5],
    ['travas.pausadoAte', '2026-11-20T15:00:00+15:00'],
    ['travas.perdasHoje', 1.5],
    ['travas.perdasHoje', -1],
    ['travas.perdasHoje', '0'],
    ['travas.diaEncerrado', 0],
    ['travas.diaEncerrado', 'false'],
    ['travas.expostoHoje', -0.5],
    ['travas.expostoJogo', -0.01],
    ['travas.expostoJogo', '0'],
    ['travas.motivos', 'x'],
    ['travas.motivos', [1]],
    ['travas.motivos', null],
  ];
  for (const [caminho, valor] of invalidos)
    it(`recusa ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await recusa(IDX.aposta, definir(caminho, valor), /travas/);
    });

  const validos: [string, unknown][] = [
    ['travas.bancaAtual', -50], // a banca pode ficar negativa: só precisa ser finita
    ['travas.drawdown', 0.35],
    ['travas.fatorKelly', 0.5],
    ['travas.pausadoAte', '2026-11-20T15:00:00-03:00'],
    ['travas.pausadoAte', '2026-11-20T18:00:00.000Z'],
    ['travas.perdasHoje', 5],
    ['travas.diaEncerrado', true],
    ['travas.expostoJogo', 0.01],
    ['travas.motivos', ['drawdown de 21,0% ≥ 20%: frações de Kelly pela metade']],
    ['travas.campoNovo', 1],
  ];
  for (const [caminho, valor] of validos)
    it(`aceita ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await aceita(IDX.aposta, definir(caminho, valor));
    });
});

describe('resultado.resultado', () => {
  const invalidos: [string, unknown, RegExp][] = [
    ['resultado', 'x', /resultado/],
    ['resultado', [], /resultado/],
    ['resultado', null, /resultado/],
    ['resultado', {}, /casa/],
    ['resultado.casa', -1, /casa/],
    ['resultado.casa', 1.5, /casa/],
    ['resultado.casa', '1', /casa/],
    ['resultado.casa', null, /casa/],
    ['resultado.casa', REMOVER, /casa/],
    ['resultado.fora', -1, /fora/],
    ['resultado.fora', 2.5, /fora/],
    ['resultado.fora', '0', /fora/],
    ['resultado.fora', REMOVER, /fora/],
    ['resultado.registradoEm', 'ontem', /registradoEm/],
    ['resultado.registradoEm', '2026-11-13T15:00:00-12:01', /registradoEm/],
    ['resultado.registradoEm', 5, /registradoEm/],
    ['resultado.registradoEm', REMOVER, /registradoEm/],
  ];
  for (const [caminho, valor, re] of invalidos)
    it(`recusa ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await recusa(IDX.resultado, definir(caminho, valor), re);
    });

  const validos: [string, unknown][] = [
    ['resultado.casa', 0],
    ['resultado.fora', 7],
    ['resultado.intervalo', { casa: 0, fora: 0 }],
    ['resultado.oddFechamento', 1.9],
    ['resultado.registradoEm', '2026-11-13T18:00:00Z'],
  ];
  for (const [caminho, valor] of validos)
    it(`aceita ${caminho} = ${JSON.stringify(valor)}`, async () => {
      await aceita(IDX.resultado, definir(caminho, valor));
    });
});

describe('correcao.novo: presença e conteúdo serializável', () => {
  for (const valor of [null, [], {}, 5, 'x', false, { a: [1, { b: null }] }])
    it(`aceita novo = ${JSON.stringify(valor)}`, async () => {
      await aceita(IDX.correcao, definir('novo', valor));
    });

  it('recusa novo ausente', async () => {
    await recusa(IDX.correcao, definir('novo', REMOVER), /novo/);
  });

  it('recusa novo = undefined (conta como ausente)', async () => {
    await recusa(IDX.correcao, definir('novo', undefined), /novo/);
  });

  it('recusa conteúdo que não serializa (NaN, Infinity, Date, função), em todas as portas', async () => {
    for (const ruim of [Number.NaN, Number.POSITIVE_INFINITY, new Date(), () => 1]) {
      const lista = await cadeia();
      const f = clonar(lista[IDX.correcao]);
      (f.corpo as unknown as Obj).novo = ruim; // sem rehash: não há como hashear
      await expect(conferirRegistro(f)).rejects.toThrow(/serializável/);
      const rel = await verificarCadeia([...lista.slice(0, IDX.correcao), f]);
      expect(rel.estado).toBe('adulterada');
      expect(codigos(rel)).toContain('corpo_incompativel');
      await expect(
        criarRegistro(
          {
            ...pedido('correcao', 4, { corrige: { seq: 3, hash: lista[2].hash } }),
            corpo: f.corpo,
          },
          lista[2],
        ),
      ).rejects.toThrow(/serializável/);
    }
  });

  it('o motivo precisa ser texto', async () => {
    await recusa(IDX.correcao, definir('motivo', 5), /motivo/);
  });
});

// ───────────────────────── 2 e 3. corrige

describe('cabeçalho `corrige`: exatamente { seq, hash }', () => {
  it('criarRegistro RECUSA campo adicional (não descarta em silêncio)', async () => {
    const lista = await cadeia();
    const base = pedido('correcao', 4);
    for (const corrige of [
      { seq: 3, hash: lista[2].hash, extra: 1 },
      { seq: 3, hash: lista[2].hash, motivo: 'x' },
      { seq: 3, hash: lista[2].hash, extra: null },
    ])
      await expect(criarRegistro({ ...base, corrige }, lista[2])).rejects.toThrow(/corrige/);
  });

  it('criarRegistro: campo adicional com valor undefined é ausente e a cópia no cabeçalho é limpa', async () => {
    const lista = await cadeia();
    const r = await criarRegistro(
      {
        ...pedido('correcao', 4),
        corrige: { seq: 3, hash: lista[2].hash, extra: undefined } as never,
      },
      lista[2],
    );
    expect(Object.keys(r.cabecalho.corrige ?? {}).sort()).toEqual(['hash', 'seq']);
  });

  it('conferirRegistro, aceitarAnexo e verificarCadeia recusam campo adicional (hash refeito)', async () => {
    const lista = await cadeia();
    const f = await forjar(lista[IDX.correcao], (c) => {
      (c.cabecalho.corrige as unknown as Obj).extra = 1;
    });
    await expect(conferirRegistro(f)).rejects.toThrow(/corrige/);
    await expect(aceitarAnexo(lista[2], f)).rejects.toThrow(/corrige/);
    const rel = await verificarCadeia([...lista.slice(0, 3), f]);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'corpo_incompativel', seq: 4 }),
    );
  });

  it('corrige com campo a menos, tipos errados ou hash fora do formato', async () => {
    const lista = await cadeia();
    const ruins: unknown[] = [
      { seq: 3 },
      { hash: lista[2].hash },
      {},
      null,
      'x',
      [],
      { seq: '3', hash: lista[2].hash },
      { seq: 3, hash: 'xyz' },
      { seq: 3, hash: 'A'.repeat(64) },
      { seq: null, hash: lista[2].hash },
    ];
    for (const corrige of ruins) {
      const f = await forjar(lista[IDX.correcao], (c) => {
        (c.cabecalho as unknown as Obj).corrige = corrige;
      });
      await expect(conferirRegistro(f), JSON.stringify(corrige)).rejects.toThrow(/corrige/);
      const rel = await verificarCadeia([...lista.slice(0, 3), f]);
      expect(rel.estado).toBe('adulterada');
    }
  });

  it('`corrige` em registro que não é correção é recusado, inclusive null', async () => {
    const lista = await cadeia();
    for (const valor of [{ seq: 1, hash: HASH }, null, 'x']) {
      const f = await forjar(lista[IDX.exclusao], (c) => {
        (c.cabecalho as unknown as Obj).corrige = valor;
      });
      await expect(conferirRegistro(f)).rejects.toThrow(/só existe/);
      const rel = await verificarCadeia([...lista.slice(0, 4), f]);
      expect(rel.estado).toBe('adulterada');
    }
  });
});

describe('corrige.seq: inteiro positivo e estritamente menor que o seq do registro', () => {
  const ruins: [string, number | string][] = [
    ['igual ao do próprio registro', 4],
    ['maior que o do registro', 5],
    ['muito maior', 99],
    ['zero', 0],
    ['negativo', -1],
    ['fracionário', 1.5],
    ['texto', '1'],
  ];
  for (const [nome, seq] of ruins)
    it(`recusa seq ${nome} (${String(seq)}) em todas as portas`, async () => {
      const lista = await cadeia();
      // criarRegistro (o seq do novo registro é 4)
      await expect(
        criarRegistro(
          {
            ...pedido('correcao', 4),
            corrige: { seq: seq as number, hash: lista[2].hash },
          },
          lista[2],
        ),
      ).rejects.toThrow(/corrige|anterior/);
      // registro forjado com hash coerente
      const f = await forjar(lista[IDX.correcao], (c) => {
        (c.cabecalho.corrige as unknown as Obj).seq = seq;
      });
      await expect(conferirRegistro(f)).rejects.toThrow(/corrige/);
      await expect(aceitarAnexo(lista[2], f)).rejects.toThrow(/corrige/);
      const rel = await verificarCadeia([...lista.slice(0, 3), f]);
      expect(rel.estado).toBe('adulterada');
      expect(codigos(rel)).toContain('corpo_incompativel');
    });

  it('aceita corrigir qualquer registro anterior, inclusive o primeiro e outra correção', async () => {
    const lista = await cadeia();
    for (const alvo of [1, 2, 3]) {
      const r = await criarRegistro(
        {
          ...pedido('correcao', 6),
          corrige: { seq: alvo, hash: lista[alvo - 1].hash },
        },
        lista[4],
      );
      await expect(aceitarAnexo(lista[4], r)).resolves.toBeUndefined();
      expect((await verificarCadeia([...lista, r])).estado).toBe('integra');
    }
    // corrigir uma correção (seq 4) a partir do seq 6
    const sobreCorrecao = await criarRegistro(
      { ...pedido('correcao', 6), corrige: { seq: 4, hash: lista[3].hash } },
      lista[4],
    );
    expect((await verificarCadeia([...lista, sobreCorrecao])).estado).toBe('integra');
  });
});

describe('verificarCadeia: o registro corrigido existe e tem o hash declarado', () => {
  it('cadeia com a correção certa é íntegra', async () => {
    const rel = await verificarCadeia(await cadeia());
    expect(rel.estado).toBe('integra');
    expect(rel.problemas).toEqual([]);
  });

  it('hash de outro registro em `corrige`: adulterada, com código específico (hash refeito)', async () => {
    const lista = await cadeia();
    const f = await forjar(lista[IDX.correcao], (c) => {
      c.cabecalho.corrige = { seq: 3, hash: lista[1].hash }; // hash bem formado, mas do registro 2
    });
    const rel = await verificarCadeia([...lista.slice(0, 3), f]);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'correcao_hash_diverge', seq: 4 }),
    );
    expect(codigos(rel)).not.toContain('hash_invalido');
    expect(codigos(rel)).not.toContain('corpo_incompativel');
  });

  it('hash inventado em `corrige`: adulterada', async () => {
    const lista = await cadeia();
    const f = await forjar(lista[IDX.correcao], (c) => {
      c.cabecalho.corrige = { seq: 3, hash: 'f'.repeat(64) };
    });
    const rel = await verificarCadeia([...lista.slice(0, 3), f]);
    expect(rel.estado).toBe('adulterada');
    expect(codigos(rel)).toContain('correcao_hash_diverge');
  });

  it('o registro corrigido foi alterado depois: o hash dele denuncia e a correção também', async () => {
    const lista = clonar(await cadeia());
    (lista[2].corpo as unknown as { resultado: { casa: number } }).resultado.casa = 9;
    const rel = await verificarCadeia(lista);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'hash_invalido', seq: 3 }),
    );
  });

  it('registro apontado ausente numa cópia parcial: INCOMPLETA (não é prova de adulteração)', async () => {
    const lista = await cadeia();
    const rel = await verificarCadeia(lista.slice(3)); // só a correção (4) e a exclusão (5)
    expect(rel.estado).toBe('incompleta');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'correcao_referencia_ausente', seq: 4 }),
    );
  });

  it('registro apontado ausente por lacuna: incompleta, e a lacuna também é acusada', async () => {
    const lista = await cadeia();
    const rel = await verificarCadeia(lista.filter((r) => r.cabecalho.seq !== 3));
    expect(rel.estado).toBe('incompleta');
    expect(codigos(rel)).toEqual(
      expect.arrayContaining(['lacuna_de_seq', 'correcao_referencia_ausente']),
    );
  });

  it('numa cadeia contígua desde o seq 1, apontar para registro inexistente é impossível sem ser adulterada', async () => {
    const lista = await cadeia();
    // seq inexistente = maior que o do próprio registro: recusado como corpo incompatível
    const f = await forjar(lista[IDX.correcao], (c) => {
      c.cabecalho.corrige = { seq: 99, hash: lista[2].hash };
    });
    const rel = await verificarCadeia([...lista.slice(0, 3), f]);
    expect(rel.estado).toBe('adulterada');
    expect(codigos(rel)).toContain('corpo_incompativel');
  });

  it('adulteração prevalece sobre incompleta quando as duas existem', async () => {
    const lista = clonar(await cadeia());
    // cópia parcial (sem gênese, logo incompleta) em que um registro também foi alterado
    (lista[2].corpo as unknown as { resultado: { casa: number } }).resultado.casa = 9;
    const rel = await verificarCadeia(lista.slice(2));
    expect(codigos(rel)).toEqual(expect.arrayContaining(['sem_genese', 'hash_invalido']));
    expect(rel.estado).toBe('adulterada');
  });
});

// ───────────────────────── 4. datas

describe('ehDataIsoComDeslocamento: limites de deslocamento e calendário', () => {
  const validas = [
    '2026-11-13T15:00:00Z',
    '2026-11-13T15:00:00+00:00', // +00:00 vale
    '2026-11-13T15:00:00-12:00', // limite inferior
    '2026-11-13T15:00:00+14:00', // limite superior
    '2026-11-13T15:00:00-03:00',
    '2026-11-13T15:00:00+05:45', // Nepal
    '2026-11-13T15:00:00-09:30',
    '2026-11-13T15:00:00+13:00',
    '2026-11-13T15:00:00-00:01', // não é o -00:00 proibido
    '2028-02-29T00:00:00Z', // bissexto
    '2000-02-29T00:00:00Z', // bissexto (divisível por 400)
    '2024-02-29T23:59:59-03:00',
    '2026-11-13T15:00:00.1Z',
    '2026-11-13T15:00:00.123-03:00',
    '2026-11-13T15:00:00.123456789+14:00',
    '2026-12-31T23:59:59Z',
    '2026-01-01T00:00:00Z',
  ];
  for (const d of validas)
    it(`aceita ${d}`, () => {
      expect(ehDataIsoComDeslocamento(d)).toBe(true);
    });

  const invalidas: [string, string][] = [
    ['2026-11-13T15:00:00-12:01', 'abaixo de −12:00'],
    ['2026-11-13T15:00:00-13:00', 'abaixo de −12:00'],
    ['2026-11-13T15:00:00+14:01', 'acima de +14:00'],
    ['2026-11-13T15:00:00+15:00', 'acima de +14:00'],
    ['2026-11-13T15:00:00+23:59', 'acima de +14:00'],
    ['2026-11-13T15:00:00+24:00', 'acima de +14:00'],
    ['2026-11-13T15:00:00+00:60', 'minutos 60'],
    ['2026-11-13T15:00:00-00:60', 'minutos 60'],
    ['2026-11-13T15:00:00+05:99', 'minutos 99'],
    ['2026-11-13T15:00:00-00:00', '"-00:00" é recusado'],
    ['2026-11-13T24:00:00Z', 'hora 24'],
    ['2026-11-13T23:59:60Z', 'segundo intercalar'],
    ['2026-11-13T23:60:00Z', 'minuto 60'],
    ['2026-02-29T00:00:00Z', '2026 não é bissexto'],
    ['1900-02-29T00:00:00Z', '1900 não é bissexto'],
    ['2100-02-29T00:00:00Z', '2100 não é bissexto'],
    ['2026-02-30T10:00:00-03:00', '30 de fevereiro'],
    ['2026-04-31T00:00:00Z', 'abril tem 30 dias'],
    ['2026-13-01T00:00:00Z', 'mês 13'],
    ['2026-00-10T00:00:00Z', 'mês 0'],
    ['2026-01-00T00:00:00Z', 'dia 0'],
    ['2026-11-13T15:00:00', 'sem deslocamento'],
    ['2026-11-13T15:00:00+0300', 'sem dois-pontos'],
    ['2026-11-13T15:00:00+03', 'só horas'],
    ['2026-11-13T15:00:00z', 'z minúsculo'],
    ['2026-11-13t15:00:00Z', 't minúsculo'],
    ['2026-11-13T15:00:00.Z', 'fração vazia'],
    ['2026-11-13T15:00Z', 'sem segundos'],
    ['2026-11-13 15:00:00Z', 'espaço no lugar do T'],
    [' 2026-11-13T15:00:00Z', 'espaço antes'],
    ['2026-11-13T15:00:00Z ', 'espaço depois'],
    ['2026-11-13T15:00:00Z\n', 'quebra de linha'],
    ['2026-11-13', 'só a data'],
    ['', 'vazio'],
    ['ontem', 'texto'],
  ];
  for (const [d, porque] of invalidas)
    it(`recusa ${JSON.stringify(d)} (${porque})`, () => {
      expect(ehDataIsoComDeslocamento(d)).toBe(false);
    });

  it('só texto: número, null, undefined e Date são recusados', () => {
    for (const x of [20261113, null, undefined, new Date(), {}, []])
      expect(ehDataIsoComDeslocamento(x)).toBe(false);
  });
});

describe('limites de data nas três portas (hash coerente)', () => {
  const ruins = [
    '2026-11-13T15:00:00-12:01',
    '2026-11-13T15:00:00+14:01',
    '2026-11-13T15:00:00+23:59',
    '2026-11-13T15:00:00+00:60',
    '2026-11-13T15:00:00-00:00',
    '2026-11-13T24:00:00Z',
    '2026-11-13T23:59:60Z',
  ];
  const boas = [
    '2026-11-13T15:00:00-12:00',
    '2026-11-13T15:00:00+14:00',
    '2026-11-13T15:00:00Z',
    '2028-02-29T10:00:00-03:00',
  ];

  it('recusadas por criarRegistro, conferirRegistro e verificarCadeia', async () => {
    for (const criadoEm of ruins) {
      await expect(criarRegistro(pedido('resultado', 1, { criadoEm }), null)).rejects.toThrow(
        /criadoEm/,
      );
      const base = await criarRegistro(pedido('resultado', 1), null);
      const f = await forjar(base, (c) => {
        c.cabecalho.criadoEm = criadoEm;
      });
      await expect(conferirRegistro(f), criadoEm).rejects.toThrow(/criadoEm/);
      await expect(aceitarAnexo(null, f), criadoEm).rejects.toThrow(/criadoEm/);
      const rel = await verificarCadeia([f]);
      expect(rel.estado).toBe('adulterada');
      expect(codigos(rel)).toEqual(['data_invalida']);
    }
  });

  it('aceitas pelas três portas', async () => {
    for (const criadoEm of boas) {
      const r = await criarRegistro(pedido('resultado', 1, { criadoEm }), null);
      await expect(aceitarAnexo(null, r)).resolves.toBeUndefined();
      expect((await verificarCadeia([r])).estado).toBe('integra');
    }
  });
});

// ───────────────────────── números não finitos, domínios e listas esparsas

/**
 * Valores que não passam pelo JSON (NaN, Infinity) e listas esparsas não podem ser "forjados com o
 * hash refeito": o próprio hash falha ao serializar. Por isso eles entram SEM refazer o hash, e a
 * validação tem de recusá-los ANTES (em `conferirRegistro`, em `criarRegistro` e, na verificação
 * histórica, como `corpo_incompativel`).
 */
async function recusaSemHash(idx: number, alterar: (c: RegistroLedger) => void, esperado: RegExp) {
  const lista = await cadeia();
  const r = clonar(lista[idx]);
  alterar(r);
  await expect(conferirRegistro(r)).rejects.toThrow(esperado);
  const rel = await verificarCadeia([...lista.slice(0, idx), r]);
  expect(rel.estado).toBe('adulterada');
  expect(codigos(rel)).toContain('corpo_incompativel');
  const refeito = await criarRegistro(
    { ...pedido(r.cabecalho.tipo, idx + 1), corpo: r.corpo },
    lista[idx - 1] ?? null,
  ).catch((e: unknown) => e);
  expect((refeito as Error).message).toMatch(esperado);
}

const NAO_FINITOS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe('stakeAutorizada: NaN, Infinity e negativos nos campos em que são proibidos', () => {
  // [campo, aceita negativo?]  (kellyCheio pode ser negativo; os demais não)
  const numericos: [string, boolean][] = [
    ['kellyCheio', true],
    ['fracaoKelly', false],
    ['fracaoBanca', false],
    ['teto', false],
    ['valor', false],
  ];
  for (const [campo, aceitaNegativo] of numericos) {
    for (const ruim of NAO_FINITOS)
      it(`recusa ${campo} = ${String(ruim)}`, async () => {
        await recusaSemHash(
          IDX.aposta,
          definir(`stakeAutorizada.${campo}`, ruim),
          /stakeAutorizada/,
        );
      });
    if (!aceitaNegativo)
      for (const ruim of [-1, -0.0001, -Number.MIN_VALUE])
        it(`recusa ${campo} = ${ruim} (negativo)`, async () => {
          await recusaSemHash(
            IDX.aposta,
            definir(`stakeAutorizada.${campo}`, ruim),
            /stakeAutorizada/,
          );
        });
  }
  it('kellyCheio negativo é aceito (EV negativo continua negativo)', async () => {
    await aceita(IDX.aposta, definir('stakeAutorizada.kellyCheio', -0.5));
  });
});

describe('travas: campos numéricos e booleanos ausentes ou inválidos', () => {
  const finitos = ['bancaInicial', 'bancaAtual', 'pico'];
  const naoNegativos = ['drawdown', 'fatorKelly', 'expostoHoje', 'expostoJogo', 'perdasHoje'];
  for (const campo of [...finitos, ...naoNegativos])
    for (const ruim of NAO_FINITOS)
      it(`recusa ${campo} = ${String(ruim)}`, async () => {
        await recusaSemHash(IDX.aposta, definir(`travas.${campo}`, ruim), /travas/);
      });
  for (const campo of naoNegativos)
    it(`recusa ${campo} negativo`, async () => {
      await recusaSemHash(IDX.aposta, definir(`travas.${campo}`, -1), /travas/);
    });
  for (const campo of finitos)
    it(`${campo} negativo é aceito (a banca pode ficar negativa)`, async () => {
      await aceita(IDX.aposta, definir(`travas.${campo}`, -10));
    });
  for (const ruim of [1.5, 0.1, Number.NaN])
    it(`perdasHoje = ${ruim} (não inteiro) é recusado`, async () => {
      await recusaSemHash(IDX.aposta, definir('travas.perdasHoje', ruim), /travas/);
    });
  for (const campo of ['diaEncerrado'])
    for (const ruim of [0, 1, 'true', null])
      it(`${campo} = ${JSON.stringify(ruim)} não é booleano`, async () => {
        await recusaSemHash(IDX.aposta, definir(`travas.${campo}`, ruim), /travas/);
      });
});

describe('aposta: odd <= 1 e não finita', () => {
  for (const odd of [1, 0.999, 0.5, 0, -1, Number.NEGATIVE_INFINITY, Number.NaN])
    it(`recusa odd = ${String(odd)}`, async () => {
      await recusaSemHash(IDX.aposta, definir('aposta.odd', odd), /odd/);
    });
  for (const odd of [1.000001, 1.01, 2, 1000])
    it(`aceita odd = ${odd}`, async () => {
      await aceita(IDX.aposta, definir('aposta.odd', odd));
    });
  for (const valor of NAO_FINITOS)
    it(`recusa valor = ${String(valor)}`, async () => {
      await recusaSemHash(IDX.aposta, definir('aposta.valor', valor), /valor/);
    });
});

describe('resultado: placar negativo, decimal, não finito ou ausente', () => {
  for (const campo of ['casa', 'fora'])
    for (const ruim of [-1, 0.5, 1.0000001, Number.NaN, Number.POSITIVE_INFINITY, '2', null])
      it(`recusa ${campo} = ${String(ruim)}`, async () => {
        await recusaSemHash(IDX.resultado, definir(`resultado.${campo}`, ruim), /resultado/);
      });
  for (const campo of ['casa', 'fora', 'registradoEm'])
    it(`recusa ${campo} ausente`, async () => {
      await recusaSemHash(IDX.resultado, definir(`resultado.${campo}`, REMOVER), /resultado/);
    });
  it('recusa o resultado inteiro ausente ou vazio', async () => {
    await recusaSemHash(IDX.resultado, definir('resultado', REMOVER), /resultado/);
    await recusaSemHash(IDX.resultado, definir('resultado', {}), /resultado/);
  });
  for (const [casa, fora] of [
    [0, 0],
    [3, 1],
    [10, 12],
  ])
    it(`aceita ${casa} x ${fora}`, async () => {
      const lista = await cadeia();
      const f = await forjar(lista[IDX.resultado], (c) => {
        definir('resultado.casa', casa)(c);
        definir('resultado.fora', fora)(c);
      });
      await expect(conferirRegistro(f)).resolves.toBeUndefined();
    });
});

describe('listas esparsas: Array.every pula as posições vazias, a validação não', () => {
  it('premissa: `every` aceita uma lista só de buracos (por isso a verificação é índice a índice)', () => {
    expect(new Array<string>(3).every((x) => typeof x === 'string')).toBe(true);
    // eslint-disable-next-line no-sparse-arrays
    expect(['a', , 'b'].every((x) => typeof x === 'string')).toBe(true);
  });

  const esparsas: [string, () => unknown][] = [
    ['só buracos (new Array(3))', () => new Array<string>(3)],
    // eslint-disable-next-line no-sparse-arrays
    ['buraco no começo', () => [, 'a']],
    // eslint-disable-next-line no-sparse-arrays
    ['buraco no meio', () => ['a', , 'b']],
    [
      'buraco no fim (length maior)',
      () => {
        const l = ['a'];
        l.length = 3;
        return l;
      },
    ],
    ['undefined explícito', () => ['a', undefined]],
  ];

  for (const [nome, fazer] of esparsas) {
    it(`travas.motivos: ${nome}`, async () => {
      await recusaSemHash(IDX.aposta, definir('travas.motivos', fazer()), /travas\.motivos/);
    });
    it(`stakeAutorizada.limites: ${nome}`, async () => {
      await recusaSemHash(
        IDX.aposta,
        definir('stakeAutorizada.limites', fazer()),
        /stakeAutorizada\.limites/,
      );
    });
    it(`snapshot.odds: ${nome}`, async () => {
      await recusaSemHash(IDX.decisao, definir('snapshot.odds', fazer()), /odds/);
    });
  }

  it('listas densas válidas continuam aceitas (inclusive vazias)', async () => {
    await aceita(IDX.aposta, definir('travas.motivos', []));
    await aceita(IDX.aposta, definir('travas.motivos', ['a', 'b']));
    await aceita(IDX.aposta, definir('stakeAutorizada.limites', ['teto', 'dia']));
    await aceita(IDX.decisao, definir('snapshot.odds', [{}, { casa: 'x' }]));
  });

  it('elemento inválido numa lista cheia: texto que não é texto, limite desconhecido', async () => {
    await recusaSemHash(IDX.aposta, definir('travas.motivos', ['a', 5]), /travas\.motivos/);
    await recusaSemHash(
      IDX.aposta,
      definir('stakeAutorizada.limites', ['teto', 'semana']),
      /limites/,
    );
  });
});

// ───────────────────────── 5. preservação

describe('o formato do hash não mudou (SHA-256 e JSON canônico intactos)', () => {
  it('o hash de ouro ANTIGO (corpo do resultado antigo) continua reproduzido pelo código novo', async () => {
    // o registro da rodada anterior: o corpo tinha só { placar }, hoje inválido para criarRegistro,
    // mas o hash dele não depende da validação e tem de continuar o mesmo
    const impressao = createHash('sha256').update('{"x":1}', 'utf8').digest('hex');
    const cabecalho = {
      esquema: 1,
      tipo: 'resultado' as const,
      cadeia: 'A',
      seq: 1,
      prevHash: null,
      criadoEm: '2026-11-13T15:01:00-03:00',
      versaoMotor: 'teste',
      impressaoPoliticas: impressao,
      politicas: { x: 1 },
    };
    const corpoAntigo = { decisao: null, resultado: { placar: [1, 0] } } as unknown as CorpoLedger;
    expect(await hashDoRegistro(cabecalho, corpoAntigo)).toBe(
      '046fc2e577e367d53b05e6efeae07663bcec77b821173467d2be1e3b22f0e533',
    );
    const independente = createHash('sha256')
      .update(
        'pe-ledger/v1\n{"cabecalho":{"cadeia":"A","criadoEm":"2026-11-13T15:01:00-03:00","esquema":1,' +
          `"impressaoPoliticas":"${impressao}","politicas":{"x":1},"prevHash":null,"seq":1,` +
          '"tipo":"resultado","versaoMotor":"teste"},"corpo":{"decisao":null,"resultado":{"placar":[1,0]}}}',
        'utf8',
      )
      .digest('hex');
    expect(independente).toBe('046fc2e577e367d53b05e6efeae07663bcec77b821173467d2be1e3b22f0e533');
  });

  it('registros válidos de todos os tipos continuam sendo criados, aceitos e verificados', async () => {
    const lista = await cadeia();
    let ponta: RegistroLedger | null = null;
    for (const r of lista) {
      await expect(aceitarAnexo(ponta, r)).resolves.toBeUndefined();
      ponta = r;
    }
    expect((await verificarCadeia(lista)).estado).toBe('integra');
  });
});
