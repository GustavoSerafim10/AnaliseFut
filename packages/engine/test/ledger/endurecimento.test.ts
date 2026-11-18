/**
 * Endurecimento da L1: a porta de escrita (`anexar`) confere o registro (hash recalculado, data,
 * corpo × tipo) e a verificação histórica aplica a mesma coerência semântica. Registros inválidos são
 * FORJADOS com o hash recalculado de propósito: assim o hash confere e só a regra nova os detecta.
 * (Antes, estes testes usavam `aceitarAnexo`, retirada da API: gravam agora por `anexar`, que confere
 * ainda mais: referências, registro anterior e ponta, atomicamente.)
 */
import { describe, expect, it } from 'vitest';
import {
  anexar,
  conferirRegistro,
  ConflitoDeCadeia,
  criarRegistro,
  ErroDeCadeia,
  hashDoRegistro,
  motivoCorpoIncompativel,
  verificarCadeia,
  type CorpoLedger,
  type RegistroLedger,
  type TipoRegistro,
} from '../../src/ledger';
import { ArmazemDeTeste, gravarSobre } from './apoioGravacao';

const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
const HASH = 'a'.repeat(64);
const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const codigos = (r: { problemas: { codigo: string }[] }) => r.problemas.map((p) => p.codigo);

/** uma `StakeAutorizada` como o motor a produz (com limite de teto aplicado) */
const STAKE_OK = {
  autorizada: true,
  kellyCheio: 0.2,
  fracaoKelly: 0.25,
  fracaoBanca: 0.02,
  limites: ['teto'],
  teto: 0.02,
  valor: 20,
};
/** uma `TravasBanca` como `calcularTravas` a produz */
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
    saida: {},
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
  correcao: { motivo: 'placar digitado errado', novo: { placar: [2, 1] } },
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

/** Cadeia com os cinco tipos, na ordem. */
async function cadeiaComTodosOsTipos(): Promise<RegistroLedger[]> {
  const lista: RegistroLedger[] = [];
  const tipos: TipoRegistro[] = [
    'decisao',
    'aposta_registrada',
    'resultado',
    'correcao',
    'exclusao',
  ];
  for (const [i, tipo] of tipos.entries()) {
    // a aposta aponta para a decisão REAL do seq 1 (o hash dela), como o Ledger exige
    const extra: Partial<Pedido> =
      tipo === 'correcao'
        ? { corrige: { seq: 3, hash: lista[2].hash } }
        : tipo === 'aposta_registrada'
          ? {
              corpo: {
                ...CORPOS.aposta_registrada,
                decisao: { seq: 1, hash: lista[0].hash },
              } as CorpoLedger,
            }
          : {};
    lista.push(await criarRegistro(pedido(tipo, i + 1, extra), lista.at(-1) ?? null));
  }
  return lista;
}

/** Copia o registro, aplica a alteração e RECALCULA o hash: o hash confere, o conteúdo é que é inválido. */
async function forjar(
  r: RegistroLedger,
  alterar: (c: RegistroLedger) => void,
): Promise<RegistroLedger> {
  const f = clonar(r);
  alterar(f);
  f.hash = await hashDoRegistro(f.cabecalho, f.corpo);
  return f;
}

describe('anexar: registros válidos continuam sendo aceitos', () => {
  it('os cinco tipos, encadeados, um a um', async () => {
    const lista = await cadeiaComTodosOsTipos();
    const armazem = new ArmazemDeTeste();
    for (const r of lista) await expect(anexar(armazem, r)).resolves.toBeUndefined();
    expect(armazem.lista()).toEqual(lista);
    expect(lista.map((r) => r.cabecalho.tipo)).toEqual([
      'decisao',
      'aposta_registrada',
      'resultado',
      'correcao',
      'exclusao',
    ]);
  });

  it('registro que passou por JSON (IndexedDB, backup) também é aceito', async () => {
    const [d] = await cadeiaComTodosOsTipos();
    await expect(gravarSobre([], clonar(d))).resolves.toBeUndefined();
  });

  it('data com "Z" e com milissegundos é aceita', async () => {
    for (const criadoEm of ['2026-11-13T18:00:00Z', '2026-11-13T18:00:00.123+00:00']) {
      const r = await criarRegistro(pedido('resultado', 1, { criadoEm }), null);
      await expect(gravarSobre([], r)).resolves.toBeUndefined();
    }
  });
});

describe('anexar: recalcula o hash e não confia em criarRegistro', () => {
  it('corpo alterado depois de criado (hash declarado é o antigo)', async () => {
    const r = await criarRegistro(pedido('resultado', 1), null);
    const adulterado = clonar(r);
    (adulterado.corpo as unknown as { resultado: { placar: number[] } }).resultado.placar[0] = 99;
    await expect(gravarSobre([], adulterado)).rejects.toThrow(/hash declarado/);
    await expect(conferirRegistro(adulterado)).rejects.toBeInstanceOf(ErroDeCadeia);
  });

  it('cabeçalho alterado depois de criado', async () => {
    const r = await criarRegistro(pedido('resultado', 1), null);
    const adulterado = clonar(r);
    adulterado.cabecalho.versaoMotor = 'outra';
    await expect(gravarSobre([], adulterado)).rejects.toThrow(/hash declarado/);
  });

  it('hash declarado incorreto (bem formado, mas de outro conteúdo)', async () => {
    const r = await criarRegistro(pedido('resultado', 1), null);
    const errado = { ...clonar(r), hash: 'f'.repeat(64) };
    await expect(gravarSobre([], errado)).rejects.toThrow(/hash declarado/);
  });

  it('hash ausente ou fora do formato', async () => {
    const r = await criarRegistro(pedido('resultado', 1), null);
    for (const hash of ['curto', 'A'.repeat(64), undefined, 123]) {
      const mau = { ...clonar(r), hash } as unknown as RegistroLedger;
      await expect(gravarSobre([], mau)).rejects.toBeInstanceOf(ErroDeCadeia);
    }
  });

  it('conteúdo não serializável é recusado, não propaga o erro cru', async () => {
    const r = await criarRegistro(pedido('resultado', 1), null);
    const mau = clonar(r);
    // o resto do resultado continua válido: só o NaN impede de serializar
    (mau.corpo as unknown as { resultado: Record<string, unknown> }).resultado.x = Number.NaN;
    await expect(gravarSobre([], mau)).rejects.toThrow(/não serializável/);
  });

  it('esquema desconhecido: recusado em vez de gravar algo que não sabemos conferir', async () => {
    const r = await forjar(await criarRegistro(pedido('resultado', 1), null), (c) => {
      c.cabecalho.esquema = 99;
    });
    await expect(gravarSobre([], r)).rejects.toThrow(/esquema 99/);
  });

  it('registro inválido NÃO é um conflito: reler a ponta não o conserta', async () => {
    const r = await criarRegistro(pedido('resultado', 1), null);
    const errado = { ...clonar(r), hash: 'f'.repeat(64) };
    const erro = await gravarSobre([], errado).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
  });

  it('o conflito de ponta continua sendo conflito (e vem depois da conferência do registro)', async () => {
    const [a] = await cadeiaComTodosOsTipos();
    const outraGenese = await criarRegistro(pedido('resultado', 9), null);
    await expect(gravarSobre([a], outraGenese)).rejects.toBeInstanceOf(ConflitoDeCadeia);
    // registro inválido E ponta velha: prevalece o erro do registro
    const errado = { ...clonar(outraGenese), hash: 'f'.repeat(64) };
    const erro = await gravarSobre([a], errado).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
  });

  it('a identidade da ponta é conferida na gravação (era o teste direto de conferirPonta, agora interna)', async () => {
    const lista = await cadeiaComTodosOsTipos();
    // a ponta certa: grava
    await expect(gravarSobre([lista[0]], lista[1])).resolves.toBeUndefined();
    // outro escritor já gravou o seq 2: a ponta é o seq 2, e o seq 2 de novo é conflito
    const erro = await gravarSobre([lista[0], lista[1]], lista[1]).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/esperado seq 3, recebido 2/);
    // seq pulado (falta o anterior): conflito, a ser resolvido relendo a ponta
    await expect(gravarSobre([lista[0]], lista[2])).rejects.toBeInstanceOf(ConflitoDeCadeia);
  });
});

describe('anexar: corpo incompatível com o tipo declarado', () => {
  it('um corpo de resultado dentro de um registro do tipo exclusão (hash coerente)', async () => {
    const r = await forjar(await criarRegistro(pedido('resultado', 1), null), (c) => {
      c.cabecalho.tipo = 'exclusao';
    });
    // o hash confere, mas o corpo não é de uma exclusão
    expect(r.hash).toBe(await hashDoRegistro(r.cabecalho, r.corpo));
    await expect(gravarSobre([], r)).rejects.toThrow(/incompatível com o tipo "exclusao"/);
  });

  it('cada tipo recusa o corpo dos outros quatro', async () => {
    const tipos = Object.keys(CORPOS) as TipoRegistro[];
    for (const tipo of tipos)
      for (const outro of tipos) {
        if (outro === tipo) continue;
        const g = await criarRegistro(pedido('resultado', 1), null);
        const extra: Partial<Pedido> =
          outro === 'correcao' ? { corrige: { seq: 1, hash: g.hash } } : {};
        const r = await criarRegistro(pedido(outro, 2, extra), g);
        const forjado = await forjar(r, (c) => {
          c.cabecalho.tipo = tipo;
          delete c.cabecalho.corrige; // o cabeçalho de correção é outro motivo de recusa
          if (tipo === 'correcao') c.cabecalho.corrige = { seq: 1, hash: HASH };
        });
        const motivo = motivoCorpoIncompativel(forjado.cabecalho, forjado.corpo);
        expect(motivo, `${outro} como ${tipo}`).toMatch(/incompatível/);
        await expect(gravarSobre([], forjado)).rejects.toBeInstanceOf(ErroDeCadeia);
      }
  });

  it('campo a mais, campo a menos e campo mal tipado', async () => {
    const base = await criarRegistro(pedido('resultado', 1), null);
    const alteracoes: [string, (c: RegistroLedger) => void][] = [
      ['campo a mais', (c) => ((c.corpo as unknown as Record<string, unknown>).extra = 1)],
      ['sem o resultado', (c) => delete (c.corpo as unknown as Record<string, unknown>).resultado],
      ['decisão que não é uma referência', (c) => ((c.corpo as { decisao: unknown }).decisao = 5)],
      [
        'referência com hash ruim',
        (c) => ((c.corpo as { decisao: unknown }).decisao = { seq: 1, hash: 'xyz' }),
      ],
    ];
    for (const [nome, alterar] of alteracoes) {
      const f = await forjar(base, alterar);
      await expect(gravarSobre([], f), nome).rejects.toThrow(/incompatível/);
    }
  });

  it('correção sem `corrige` no cabeçalho, ou `corrige` em outro tipo', async () => {
    const lista = await cadeiaComTodosOsTipos();
    const semCorrige = await forjar(lista[3], (c) => {
      delete c.cabecalho.corrige;
    });
    await expect(gravarSobre(lista.slice(0, 3), semCorrige)).rejects.toThrow(/corrige/);
    const comCorrigeIndevido = await forjar(lista[4], (c) => {
      c.cabecalho.corrige = { seq: 1, hash: HASH };
    });
    await expect(gravarSobre(lista.slice(0, 4), comCorrigeIndevido)).rejects.toThrow(/só existe/);
  });

  it('criarRegistro também recusa o corpo errado (não nasce registro incoerente)', async () => {
    await expect(
      criarRegistro(pedido('exclusao', 1, { corpo: CORPOS.resultado }), null),
    ).rejects.toThrow(/incompatível/);
    await expect(
      criarRegistro(pedido('decisao', 1, { corpo: { motivo: 'x', novo: 1 } as CorpoLedger }), null),
    ).rejects.toThrow(/incompatível/);
  });
});

describe('anexar: data inválida', () => {
  const invalidas = [
    'ontem',
    '',
    '2026-11-13',
    '2026-11-13 15:00:00-03:00', // sem o T
    '2026-11-13T15:00:00', // sem deslocamento
    '2026-02-30T10:00:00-03:00', // dia que não existe
    '2026-11-13T25:00:00Z', // hora que não existe
    '2026-13-01T00:00:00Z', // mês que não existe
  ];

  it('registro forjado com hash coerente e data inválida', async () => {
    const base = await criarRegistro(pedido('resultado', 1), null);
    for (const data of invalidas) {
      const f = await forjar(base, (c) => {
        c.cabecalho.criadoEm = data;
      });
      await expect(gravarSobre([], f), JSON.stringify(data)).rejects.toThrow(/criadoEm/);
    }
  });

  it('data que não é texto', async () => {
    const base = await criarRegistro(pedido('resultado', 1), null);
    const f = await forjar(base, (c) => {
      (c.cabecalho as unknown as { criadoEm: unknown }).criadoEm = 20261113;
    });
    await expect(gravarSobre([], f)).rejects.toBeInstanceOf(ErroDeCadeia);
  });

  it('criarRegistro continua recusando as mesmas datas', async () => {
    for (const criadoEm of invalidas)
      await expect(criarRegistro(pedido('resultado', 1, { criadoEm }), null)).rejects.toThrow(
        /criadoEm/,
      );
  });
});

describe('verificarCadeia: coerência semântica na verificação histórica', () => {
  it('uma cadeia com os cinco tipos é íntegra', async () => {
    const r = await verificarCadeia(await cadeiaComTodosOsTipos());
    expect(r.estado).toBe('integra');
    expect(r.problemas).toEqual([]);
  });

  it('data inválida num registro cujo hash confere: adulterada, com o código e o seq', async () => {
    const lista = await cadeiaComTodosOsTipos();
    const ruim = await forjar(lista[1], (c) => {
      c.cabecalho.criadoEm = 'ontem';
    });
    const r = await verificarCadeia([lista[0], ruim, ...lista.slice(2)]);
    expect(r.estado).toBe('adulterada');
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'data_invalida', seq: 2 }),
    );
    // o hash do registro 2 foi refeito, então quem denuncia a troca é o encadeamento (seq 3)
    expect(codigos(r)).toContain('prevhash_nao_confere');
  });

  it('data inválida sozinha (cadeia refeita de ponta a ponta): ainda é detectada', async () => {
    // quem refaz a cadeia inteira consistente não deixa rastro de hash, mas a data inválida aparece
    const g = await criarRegistro(pedido('resultado', 1, { criadoEm: T(1) }), null);
    const ruim = await forjar(g, (c) => {
      c.cabecalho.criadoEm = '2026-02-30T10:00:00-03:00';
    });
    const r = await verificarCadeia([ruim]);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toEqual(['data_invalida']);
  });

  it('corpo de outro tipo num registro cujo hash confere: adulterada', async () => {
    const [g] = await cadeiaComTodosOsTipos();
    const ruim = await forjar(g, (c) => {
      c.cabecalho.tipo = 'exclusao';
    });
    const r = await verificarCadeia([ruim]);
    expect(r.estado).toBe('adulterada');
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'corpo_incompativel', seq: 1 }),
    );
    expect(codigos(r)).not.toContain('hash_invalido');
  });

  it('campo a mais no corpo (hash refeito): adulterada', async () => {
    const [g] = await cadeiaComTodosOsTipos();
    const ruim = await forjar(g, (c) => {
      (c.corpo as unknown as Record<string, unknown>).extra = true;
    });
    const r = await verificarCadeia([ruim]);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toContain('corpo_incompativel');
  });

  it('correção sem `corrige` (hash refeito): adulterada', async () => {
    const lista = await cadeiaComTodosOsTipos();
    const ruim = await forjar(lista[3], (c) => {
      delete c.cabecalho.corrige;
    });
    const r = await verificarCadeia([...lista.slice(0, 3), ruim]);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toContain('corpo_incompativel');
  });

  it('as duas regras são independentes do hash: hash errado E corpo errado acusam os dois', async () => {
    const [g] = await cadeiaComTodosOsTipos();
    const ruim = clonar(g);
    ruim.cabecalho.tipo = 'exclusao'; // sem refazer o hash
    const r = await verificarCadeia([ruim]);
    expect(codigos(r)).toEqual(expect.arrayContaining(['corpo_incompativel', 'hash_invalido']));
  });

  it('esquema incompatível não é julgado pelas regras do esquema 1', async () => {
    const lista = clonar(await cadeiaComTodosOsTipos());
    lista[4].cabecalho.esquema = 99;
    (lista[4].corpo as unknown as { qualquer: number }) = { qualquer: 1 } as never;
    const r = await verificarCadeia(lista);
    expect(r.estado).toBe('incompativel');
    expect(codigos(r)).toEqual(['esquema_incompativel']);
  });

  it('a verificação histórica continua detectando as adulterações de antes', async () => {
    const lista = clonar(await cadeiaComTodosOsTipos());
    (lista[2].corpo as unknown as { resultado: { placar: number[] } }).resultado.placar[0] = 99;
    const r = await verificarCadeia(lista);
    expect(r.estado).toBe('adulterada');
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'hash_invalido', seq: 3 }),
    );
    const semMeio = await verificarCadeia(
      (await cadeiaComTodosOsTipos()).filter((x) => x.cabecalho.seq !== 3),
    );
    expect(semMeio.estado).toBe('incompleta');
  });
});

describe('motivoCorpoIncompativel', () => {
  it('aceita os cinco corpos válidos', () => {
    for (const tipo of Object.keys(CORPOS) as TipoRegistro[]) {
      const corrige = tipo === 'correcao' ? { seq: 1, hash: HASH } : undefined;
      expect(motivoCorpoIncompativel({ tipo, corrige, seq: 2 }, CORPOS[tipo])).toBeNull();
    }
  });

  it('exclusão: motivo null e texto valem; ausente e número não', () => {
    expect(motivoCorpoIncompativel({ tipo: 'exclusao', seq: 1 }, { motivo: null })).toBeNull();
    expect(
      motivoCorpoIncompativel({ tipo: 'exclusao', seq: 1 }, { motivo: 'duplicada' }),
    ).toBeNull();
    expect(motivoCorpoIncompativel({ tipo: 'exclusao', seq: 1 }, {})).toMatch(/motivo/);
    expect(motivoCorpoIncompativel({ tipo: 'exclusao', seq: 1 }, { motivo: 3 })).toMatch(/motivo/);
  });

  it('decisão: prints precisam ser hashes de blob', () => {
    const corpo = clonar(CORPOS.decisao) as unknown as {
      snapshot: { prints: Record<string, string> };
    };
    corpo.snapshot.prints = { 'print-1': 'não é hash' };
    expect(motivoCorpoIncompativel({ tipo: 'decisao', seq: 1 }, corpo)).toMatch(/prints/);
  });

  it('corpo que nem é objeto', () => {
    for (const c of [null, 1, 'x', [], undefined])
      expect(motivoCorpoIncompativel({ tipo: 'resultado', seq: 1 }, c)).toMatch(/não é um objeto/);
  });
});
