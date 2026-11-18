/**
 * Fase A: a referência exige que o registro APONTADO seja válido (forma, esquema suportado, data,
 * tipo × esquema e corpo × tipo), e não apenas que o hash recalculado confira. Um registro inválido
 * também tem hash correto: foi o furo que este arquivo fecha.
 *
 * A validade vem de `motivoRegistroInvalido`, o validador de LEITURA: independente dos bloqueios de
 * escrita (aceita o `fechamento`, que é somente leitura). Referenciar um fechamento válido NÃO libera
 * a escrita do fechamento.
 */
import { describe, expect, it } from 'vitest';
import {
  anexar,
  conferirReferencia,
  conferirRegistro,
  ConflitoDeCadeia,
  criarRegistro,
  ErroDeCadeia,
  verificarCadeia,
  verificarReferencias,
  type ArmazemLedger,
  type RegistroLedger,
  type TransacaoLedger,
} from '../../src/ledger';
// módulo INTERNO do Ledger (fora da API pública de @pe/engine): importado direto, só nos testes
import { motivoRegistroInvalido } from '../../src/ledger/registroValido';
import {
  cadeiaBase,
  corpoDeFechamento,
  fechamentoApos,
  refazerHash,
  registroMontado,
  T,
} from './apoioEsquema2';

const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;

/** Armazém em memória mínimo: leitura fora da transação, transação tudo-ou-nada. */
class Armazem implements ArmazemLedger {
  dados = new Map<string, RegistroLedger>();
  transacoesAbertas = 0;
  constructor(registros: RegistroLedger[] = []) {
    for (const r of registros) this.dados.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
  }
  async ler(cadeia: string, seq: number) {
    await Promise.resolve();
    return this.dados.get(chave(cadeia, seq)) ?? null;
  }
  async transacao<R>(corpo: (tx: TransacaoLedger) => R): Promise<R> {
    await Promise.resolve();
    this.transacoesAbertas++;
    const rascunho = new Map(this.dados);
    const tx: TransacaoLedger = {
      ponta: (cadeia) => {
        let melhor: RegistroLedger | null = null;
        for (const r of rascunho.values())
          if (r.cabecalho.cadeia === cadeia && (!melhor || r.cabecalho.seq > melhor.cabecalho.seq))
            melhor = r;
        return melhor;
      },
      ler: (cadeia, seq) => rascunho.get(chave(cadeia, seq)) ?? null,
      adicionar: (r) => {
        const k = chave(r.cabecalho.cadeia, r.cabecalho.seq);
        if (rascunho.has(k)) throw new Error(`ConstraintError: chave ${k} repetida`);
        rascunho.set(k, r);
      },
    };
    const resultado = corpo(tx);
    this.dados = rascunho;
    return resultado;
  }
  lista(cadeia = 'A'): RegistroLedger[] {
    return [...this.dados.values()]
      .filter((r) => r.cabecalho.cadeia === cadeia)
      .sort((a, b) => a.cabecalho.seq - b.cabecalho.seq);
  }
}

/** uma correção (esquema 1) que corrige o registro `alvo`, logo depois de `ultimo` */
const correcaoDe = (ultimo: RegistroLedger, alvo: RegistroLedger) =>
  criarRegistro(
    {
      tipo: 'correcao',
      cadeia: 'A',
      criadoEm: T(ultimo.cabecalho.seq + 1),
      corpo: { motivo: 'placar digitado errado', novo: { casa: 2, fora: 1 } },
      corrige: { seq: alvo.cabecalho.seq, hash: alvo.hash },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    ultimo,
  );

describe('motivoRegistroInvalido: o validador de leitura', () => {
  it('aceita os registros válidos dos esquemas 1 e 2, inclusive o fechamento (somente leitura)', async () => {
    const base = await cadeiaBase();
    for (const r of base) expect(motivoRegistroInvalido(r)).toBeNull();
    expect(motivoRegistroInvalido(await fechamentoApos(base[2], base))).toBeNull();
  });

  it('é independente dos bloqueios de escrita: aprova o fechamento que conferirRegistro recusa', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    expect(motivoRegistroInvalido(f)).toBeNull();
    await expect(conferirRegistro(f)).rejects.toThrow(/somente leitura/);
  });

  it('recusa forma inválida, esquema não suportado, data inválida, tipo × esquema e corpo × tipo', async () => {
    const base = await cadeiaBase();
    expect(motivoRegistroInvalido(null)).toMatch(/malformado/);
    expect(motivoRegistroInvalido({ cabecalho: {} })).toMatch(/malformado/);
    expect(
      motivoRegistroInvalido(await refazerHash(base[2], (c) => (c.cabecalho.esquema = 99))),
    ).toMatch(/esquema 99 não suportado/);
    expect(
      motivoRegistroInvalido(await refazerHash(base[2], (c) => (c.cabecalho.criadoEm = 'ontem'))),
    ).toMatch(/data ISO/);
    expect(
      motivoRegistroInvalido(await refazerHash(base[2], (c) => (c.cabecalho.esquema = 2))),
    ).toMatch(/tipo desconhecido/);
    expect(
      motivoRegistroInvalido(
        await refazerHash(base[2], (c) => (c.corpo = { motivo: null } as never)),
      ),
    ).toMatch(/corpo incompatível/);
  });

  it('respeita os esquemas suportados informados (verificador mais antigo)', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    expect(motivoRegistroInvalido(f, [1])).toMatch(/esquema 2 não suportado/);
  });
});

describe('Fase A: registro apontado VÁLIDO', () => {
  it('uma correção do resultado (seq 3) é gravada', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    const c = await correcaoDe(base[2], base[2]);
    await anexar(armazem, c);
    expect(armazem.lista()).toHaveLength(4);
    expect(armazem.transacoesAbertas).toBe(1);
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });

  it('uma aposta com `decisao` apontando para a decisão válida é gravada', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem([base[0]]);
    await anexar(armazem, base[1]);
    expect(armazem.lista()).toHaveLength(2);
  });
});

describe('Fase A: hash CORRETO, mas o registro apontado é inválido', () => {
  /** recusa na Fase A: erro de cadeia (não conflito), nenhuma transação aberta, nada gravado */
  async function recusa(armazem: Armazem, novo: RegistroLedger, padrao: RegExp, tamanho: number) {
    const erro = await anexar(armazem, novo).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/inválido/);
    expect((erro as Error).message).toMatch(padrao);
    expect(armazem.transacoesAbertas).toBe(0);
    expect(armazem.lista()).toHaveLength(tamanho);
  }

  it('corpo incompatível com o tipo (data do resultado inválida): recusada', async () => {
    const base = await cadeiaBase();
    const ruim = await refazerHash(base[2], (c) => {
      (c.corpo as unknown as { resultado: { registradoEm: string } }).resultado.registradoEm =
        'ontem';
    });
    expect(ruim.hash).not.toBe(base[2].hash); // o hash foi refeito: confere com o conteúdo
    const armazem = new Armazem([base[0], base[1], ruim]);
    const c = await correcaoDe(ruim, ruim);
    // a conferência síncrona e o recálculo de hash, sozinhos, aprovariam este registro
    expect(() => conferirReferencia(ruim, c)).not.toThrow();
    await recusa(armazem, c, /corpo incompatível com o tipo "resultado"/, 3);
  });

  it('corpo de OUTRO tipo no registro (um corpo de exclusão num resultado): recusada', async () => {
    const base = await cadeiaBase();
    const ruim = await refazerHash(base[2], (c) => (c.corpo = { motivo: null } as never));
    await recusa(
      new Armazem([base[0], base[1], ruim]),
      await correcaoDe(ruim, ruim),
      /corpo incompatível/,
      3,
    );
  });

  it('tipo incompatível com o esquema (resultado com esquema 2): recusada', async () => {
    const base = await cadeiaBase();
    const ruim = await refazerHash(base[2], (c) => (c.cabecalho.esquema = 2));
    await recusa(
      new Armazem([base[0], base[1], ruim]),
      await correcaoDe(ruim, ruim),
      /tipo desconhecido/,
      3,
    );
  });

  it('tipo incompatível com o esquema (fechamento com esquema 1): recusada', async () => {
    const base = await cadeiaBase();
    const ruim = await registroMontado(base[2], 1, 'fechamento', corpoDeFechamento(base));
    await recusa(
      new Armazem([...base, ruim]),
      await correcaoDe(ruim, ruim),
      /tipo desconhecido/,
      4,
    );
  });

  it('data de criação inválida no registro apontado: recusada', async () => {
    const base = await cadeiaBase();
    const ruim = await refazerHash(base[2], (c) => (c.cabecalho.criadoEm = '2026-13-45T99:00:00Z'));
    await recusa(
      new Armazem([base[0], base[1], ruim]),
      await correcaoDe(ruim, ruim),
      /data ISO/,
      3,
    );
  });

  it('a referência `decisao` também exige uma decisão VÁLIDA (corpo da decisão inválido): recusada', async () => {
    const base = await cadeiaBase();
    const decisaoRuim = await refazerHash(base[0], (c) => {
      (c.corpo as unknown as { impressao: string }).impressao = '';
    });
    const aposta = await criarRegistro(
      {
        tipo: 'aposta_registrada',
        cadeia: 'A',
        criadoEm: T(2),
        corpo: {
          ...(base[1].corpo as object),
          decisao: { seq: 1, hash: decisaoRuim.hash },
        } as never,
        versaoMotor: 'teste',
        politicas: { x: 1 },
      },
      decisaoRuim,
    );
    await recusa(new Armazem([decisaoRuim]), aposta, /corpo incompatível com o tipo "decisao"/, 1);
  });

  it('o armazém devolve lixo (sem cabeçalho): recusada como inválida, sem TypeError', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    armazem.dados.set(chave('A', 3), { corpo: {} } as unknown as RegistroLedger);
    const c = await correcaoDe(base[2], base[2]);
    const erro = await verificarReferencias(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/inválido \(registro malformado/);
  });

  it('a ordem das recusas: conteúdo ALTERADO continua sendo reportado como alterado', async () => {
    const base = await cadeiaBase();
    const adulterado = JSON.parse(JSON.stringify(base[2])) as RegistroLedger;
    (adulterado.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
    const armazem = new Armazem([base[0], base[1], adulterado]);
    await expect(anexar(armazem, await correcaoDe(base[2], base[2]))).rejects.toThrow(/alterado/);
  });
});

describe('Fase A: referência para um FECHAMENTO válido, sem liberar a escrita do fechamento', () => {
  it('uma correção (esquema 1) que corrige um fechamento VÁLIDO é gravada', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const armazem = new Armazem([...base, f]); // o fechamento já está lá (semeado, não escrito)
    const c = await correcaoDe(f, f);
    await anexar(armazem, c);
    expect(armazem.lista()).toHaveLength(5);
    expect(armazem.lista()[4].cabecalho.esquema).toBe(1);
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });

  it('...mas o fechamento continua NÃO podendo ser gravado: nada é lido nem escrito', async () => {
    const base = await cadeiaBase();
    const f1 = await fechamentoApos(base[2], base);
    const armazem = new Armazem([...base, f1]);
    const f2 = await fechamentoApos(f1, base, { oddFechamento: 1.7 });
    await expect(anexar(armazem, f2)).rejects.toThrow(/somente leitura/);
    expect(armazem.transacoesAbertas).toBe(0);
    expect(armazem.lista()).toHaveLength(4);
  });

  it('um fechamento INVÁLIDO (odd 1) não pode ser corrigido por referência: recusada', async () => {
    const base = await cadeiaBase();
    const ruim = await registroMontado(
      base[2],
      2,
      'fechamento',
      corpoDeFechamento(base, { oddFechamento: 1 }),
    );
    const armazem = new Armazem([...base, ruim]);
    await expect(anexar(armazem, await correcaoDe(ruim, ruim))).rejects.toThrow(
      /inválido.*corpo incompatível com o tipo "fechamento"/,
    );
    expect(armazem.lista()).toHaveLength(4);
  });

  it('um fechamento de esquema 2 NÃO é aceito por um verificador que só conhece o esquema 1', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    expect(motivoRegistroInvalido(f, [1])).toMatch(/não suportado/);
  });
});

describe('Fase A: cópias parciais LEGÍTIMAS continuam sendo tratadas como antes', () => {
  it('o registro apontado não está na cópia: recusada por inexistente (não por inválido)', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem([base[0], base[2]]); // falta o seq 2
    const c = await correcaoDe(base[2], base[1]); // corrige o seq 2, que a cópia não tem
    const erro = await anexar(armazem, c).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/não existe na cadeia/);
    expect((erro as Error).message).not.toMatch(/inválido/);
  });

  it('a verificação da cópia parcial legítima continua INCOMPLETA (não adulterada)', async () => {
    const base = await cadeiaBase();
    const c = await correcaoDe(base[2], base[1]);
    const rel = await verificarCadeia([base[0], base[2], c]);
    expect(rel.estado).toBe('incompleta');
    expect(rel.problemas.map((p) => p.codigo)).toEqual(
      expect.arrayContaining(['correcao_referencia_ausente', 'lacuna_de_seq']),
    );
  });

  it('a cadeia completa correspondente é íntegra e a correção é gravada', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    await anexar(armazem, await correcaoDe(base[2], base[1]));
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });
});
