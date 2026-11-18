/**
 * V2, SOMENTE LEITURA: esquemas 1 e 2, `fechamento` exclusivo do esquema 2, prefixo "pe-ledger/v2",
 * validação do corpo e das referências, cadeias mistas e o bloqueio de ESCRITA do fechamento.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  anexar,
  anexarNaTransacao,
  conferirRegistro,
  criarRegistro,
  ErroDeCadeia,
  ESQUEMA_DO_TIPO,
  ESQUEMAS_SUPORTADOS,
  hashDoRegistro,
  motivoCorpoIncompativel,
  referenciasDoRegistro,
  reproduzirComMotorAtual,
  serializarCanonico,
  TIPOS_DE_REGISTRO,
  TIPOS_DO_ESQUEMA,
  TIPOS_SOMENTE_LEITURA,
  verificarCadeia,
  verificarLedger,
  verificarReferencias,
  type ArmazemLedger,
  type TransacaoLedger,
} from '../../src/ledger';
import {
  cadeiaBase,
  clonar,
  codigos,
  corpoDeFechamento,
  fechamentoApos,
  refazerHash,
  registroMontado,
  T,
} from './apoioEsquema2';
import { gravarSobre } from './apoioGravacao';

describe('constantes: esquema por tipo', () => {
  it('esquemas 1 e 2 suportados; os cinco tipos antigos no 1, o fechamento no 2', () => {
    expect(ESQUEMAS_SUPORTADOS).toEqual([1, 2]);
    expect(ESQUEMA_DO_TIPO).toEqual({
      decisao: 1,
      aposta_registrada: 1,
      resultado: 1,
      correcao: 1,
      exclusao: 1,
      fechamento: 2,
    });
    expect(TIPOS_DO_ESQUEMA[1]).toEqual([
      'decisao',
      'aposta_registrada',
      'resultado',
      'correcao',
      'exclusao',
    ]);
    expect(TIPOS_DO_ESQUEMA[2]).toEqual(['fechamento']);
  });

  it('os tipos ESCRITOS continuam sendo só os cinco; o fechamento é somente leitura', () => {
    expect(TIPOS_DE_REGISTRO).toEqual(TIPOS_DO_ESQUEMA[1]);
    expect(TIPOS_SOMENTE_LEITURA).toEqual(['fechamento']);
  });

  it('todo registro criado por esta versão continua com esquema 1', async () => {
    for (const r of await cadeiaBase()) expect(r.cabecalho.esquema).toBe(1);
  });
});

describe('prefixo "pe-ledger/v2" no hash do fechamento', () => {
  it('é SHA-256 de "pe-ledger/v2\\n" + JSON canônico, calculado por fora', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const canonico = serializarCanonico({ cabecalho: f.cabecalho, corpo: f.corpo });
    const v2 = createHash('sha256')
      .update('pe-ledger/v2\n' + canonico, 'utf8')
      .digest('hex');
    expect(f.hash).toBe(v2);
    expect(await hashDoRegistro(f.cabecalho, f.corpo)).toBe(v2);
    expect(f.cabecalho.esquema).toBe(2);
  });

  it('o prefixo separa os domínios: o mesmo conteúdo com prefixo v1 dá OUTRO hash', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const canonico = serializarCanonico({ cabecalho: f.cabecalho, corpo: f.corpo });
    const v1 = createHash('sha256')
      .update('pe-ledger/v1\n' + canonico, 'utf8')
      .digest('hex');
    expect(v1).not.toBe(f.hash);
  });
});

describe('fechamento válido', () => {
  it('mínimo (sem fonte, sem outros lados): cadeia mista íntegra', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const rel = await verificarCadeia([...base, f]);
    expect(rel.problemas).toEqual([]);
    expect(rel.estado).toBe('integra');
    expect(rel.total).toBe(4);
  });

  it('com fonte e com as odds dos outros lados', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base, {
      fonte: 'consenso das casas',
      fechamentoOutros: [3.4, 5.2],
      oddFechamento: 2.05,
    });
    expect((await verificarCadeia([...base, f])).estado).toBe('integra');
  });

  it('vários fechamentos da mesma aposta são permitidos (nada impede, vale o de maior seq)', async () => {
    const base = await cadeiaBase();
    const f1 = await fechamentoApos(base[2], base, { oddFechamento: 1.9 });
    const f2 = await fechamentoApos(f1, base, { oddFechamento: 1.85 });
    const f3 = await fechamentoApos(f2, base, { oddFechamento: 1.8 });
    const rel = await verificarCadeia([...base, f1, f2, f3]);
    expect(rel.estado).toBe('integra');
    const vigente = [f1, f2, f3].reduce((a, b) => (b.cabecalho.seq > a.cabecalho.seq ? b : a));
    expect(vigente.cabecalho.seq).toBe(6);
  });

  it('uma correção (esquema 1) pode corrigir um fechamento (esquema 2): cadeia mista íntegra', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const c = await criarRegistro(
      {
        tipo: 'correcao',
        cadeia: 'A',
        criadoEm: T(5),
        corpo: { motivo: 'odd digitada errado', novo: { oddFechamento: 1.9 } },
        corrige: { seq: 4, hash: f.hash },
        versaoMotor: 'teste',
        politicas: { x: 1 },
      },
      f,
    );
    const rel = await verificarCadeia([...base, f, c]);
    expect(rel.estado).toBe('integra');
    expect(c.cabecalho.esquema).toBe(1);
  });

  it('a referência do fechamento é uma `aposta` para `aposta_registrada`', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    expect(referenciasDoRegistro(f)).toEqual([
      { campo: 'aposta', seq: 2, hash: base[1].hash, tipoExigido: 'aposta_registrada' },
    ]);
  });
});

describe('fechamento: corpo inválido (hash refeito: só a regra acusa)', () => {
  const invalidos: [string, (c: Record<string, unknown>) => void][] = [
    ['campo a mais', (c) => (c.extra = 1)],
    ['sem aposta', (c) => delete c.aposta],
    ['sem oddFechamento', (c) => delete c.oddFechamento],
    ['sem fechamentoOutros', (c) => delete c.fechamentoOutros],
    ['sem registradoEm', (c) => delete c.registradoEm],
    ['aposta null', (c) => (c.aposta = null)],
    ['aposta com campo a mais', (c) => (c.aposta = { ...(c.aposta as object), x: 1 })],
    ['aposta sem hash', (c) => (c.aposta = { seq: 2 })],
    ['aposta com hash fora do formato', (c) => (c.aposta = { seq: 2, hash: 'xyz' })],
    ['aposta com seq 0', (c) => (c.aposta = { ...(c.aposta as object), seq: 0 })],
    ['aposta com seq decimal', (c) => (c.aposta = { ...(c.aposta as object), seq: 1.5 })],
    ['oddFechamento = 1', (c) => (c.oddFechamento = 1)],
    ['oddFechamento menor que 1', (c) => (c.oddFechamento = 0.9)],
    ['oddFechamento texto', (c) => (c.oddFechamento = '1.85')],
    ['oddFechamento null', (c) => (c.oddFechamento = null)],
    ['fechamentoOutros não é lista', (c) => (c.fechamentoOutros = 3.4)],
    ['fechamentoOutros com odd = 1', (c) => (c.fechamentoOutros = [3.4, 1])],
    ['fechamentoOutros com texto', (c) => (c.fechamentoOutros = ['3.4'])],
    ['fechamentoOutros = null', (c) => (c.fechamentoOutros = null)],
    ['registradoEm inválido', (c) => (c.registradoEm = 'ontem')],
    ['registradoEm com fuso fora do limite', (c) => (c.registradoEm = '2026-11-13T15:00:00+14:01')],
    ['fonte vazia', (c) => (c.fonte = '')],
    ['fonte só espaços', (c) => (c.fonte = '   ')],
    ['fonte que não é texto', (c) => (c.fonte = 5)],
    ['fonte null', (c) => (c.fonte = null)],
  ];
  for (const [nome, alterar] of invalidos)
    it(nome, async () => {
      const base = await cadeiaBase();
      const corpo = corpoDeFechamento(base);
      alterar(corpo);
      const f = await registroMontado(base[2], 2, 'fechamento', corpo);
      const rel = await verificarCadeia([...base, f]);
      expect(rel.estado).toBe('adulterada');
      expect(rel.problemas).toContainEqual(
        expect.objectContaining({ codigo: 'corpo_incompativel', seq: 4 }),
      );
    });

  it('NaN, Infinity e lista esparsa (não passam pelo JSON): recusados pela regra do corpo', async () => {
    const base = await cadeiaBase();
    // eslint-disable-next-line no-sparse-arrays
    const esparsa = [3.4, , 5.2];
    for (const alterar of [
      (c: Record<string, unknown>) => (c.oddFechamento = Number.NaN),
      (c: Record<string, unknown>) => (c.oddFechamento = Number.POSITIVE_INFINITY),
      (c: Record<string, unknown>) => (c.fechamentoOutros = [Number.NaN]),
      (c: Record<string, unknown>) => (c.fechamentoOutros = esparsa),
      (c: Record<string, unknown>) => (c.fechamentoOutros = new Array<number>(2)),
      (c: Record<string, unknown>) => (c.fechamentoOutros = [3.4, undefined]),
    ]) {
      const corpo = corpoDeFechamento(base);
      alterar(corpo);
      expect(motivoCorpoIncompativel({ tipo: 'fechamento', seq: 4, esquema: 2 }, corpo)).toMatch(
        /fechamento\./,
      );
    }
  });

  it('`corrige` no cabeçalho de um fechamento é recusado', async () => {
    const base = await cadeiaBase();
    const f = await registroMontado(base[2], 2, 'fechamento', corpoDeFechamento(base), {
      corrige: { seq: 1, hash: base[0].hash },
    });
    const rel = await verificarCadeia([...base, f]);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'corpo_incompativel', seq: 4 }),
    );
  });
});

describe('tipo e esquema: igualdade estrita', () => {
  it('fechamento com esquema 1: tipo fora da lista do esquema 1 (adulterada)', async () => {
    const base = await cadeiaBase();
    const f = await registroMontado(base[2], 1, 'fechamento', corpoDeFechamento(base));
    const rel = await verificarCadeia([...base, f]);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'registro_malformado', detalhe: 'tipo desconhecido' }),
    );
  });

  it('um tipo dos cinco com esquema 2: fora da lista do esquema 2 (adulterada)', async () => {
    const base = await cadeiaBase();
    for (const [tipo, corpo] of [
      ['resultado', { decisao: null, resultado: { casa: 1, fora: 0, registradoEm: T(4) } }],
      ['exclusao', { motivo: null }],
    ] as const) {
      const r = await registroMontado(base[2], 2, tipo, corpo);
      const rel = await verificarCadeia([...base, r]);
      expect(rel.estado, tipo).toBe('adulterada');
      expect(rel.problemas).toContainEqual(
        expect.objectContaining({ codigo: 'registro_malformado', detalhe: 'tipo desconhecido' }),
      );
    }
  });

  it('motivoCorpoIncompativel confere a coerência quando recebe o esquema', () => {
    const corpo = { motivo: null };
    expect(motivoCorpoIncompativel({ tipo: 'exclusao', seq: 1, esquema: 1 }, corpo)).toBeNull();
    expect(motivoCorpoIncompativel({ tipo: 'exclusao', seq: 1, esquema: 2 }, corpo)).toMatch(
      /pertence ao esquema 1, não ao 2/,
    );
    expect(motivoCorpoIncompativel({ tipo: 'exclusao', seq: 1 }, corpo)).toBeNull(); // sem esquema: só o corpo
  });

  it('esquema 3 ou maior continua incompatível, com fechamento ou não', async () => {
    const base = await cadeiaBase();
    for (const esquema of [3, 99]) {
      const f = await registroMontado(base[2], esquema, 'fechamento', corpoDeFechamento(base));
      const rel = await verificarCadeia([...base, f]);
      expect(rel.estado).toBe('incompativel');
      expect(codigos(rel)).toEqual(['esquema_incompativel']);
    }
  });
});

describe('fechamento: referência à aposta', () => {
  it('aposta ausente (cópia sem o registro): INCOMPLETA', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const rel = await verificarCadeia([base[0], base[2], f]); // falta o seq 2 (a aposta)
    expect(codigos(rel)).toEqual(
      expect.arrayContaining(['lacuna_de_seq', 'fechamento_referencia_ausente']),
    );
    expect(rel.estado).toBe('incompleta');
  });

  it('hash divergente: adulterada', async () => {
    const base = await cadeiaBase();
    const f = await registroMontado(
      base[2],
      2,
      'fechamento',
      corpoDeFechamento(base, { aposta: { seq: 2, hash: 'f'.repeat(64) } }),
    );
    const rel = await verificarCadeia([...base, f]);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'fechamento_hash_diverge', seq: 4 }),
    );
  });

  it('tipo incorreto: aponta para o resultado ou para a decisão, não para uma aposta', async () => {
    const base = await cadeiaBase();
    for (const alvo of [base[0], base[2]]) {
      const f = await registroMontado(
        base[2],
        2,
        'fechamento',
        corpoDeFechamento(base, { aposta: { seq: alvo.cabecalho.seq, hash: alvo.hash } }),
      );
      const rel = await verificarCadeia([...base, f]);
      expect(rel.estado).toBe('adulterada');
      expect(rel.problemas).toContainEqual(
        expect.objectContaining({ codigo: 'fechamento_tipo_incorreto', seq: 4 }),
      );
    }
  });

  it('seq igual ou superior ao do próprio fechamento: não anterior', async () => {
    const base = await cadeiaBase();
    for (const seq of [4, 5, 99]) {
      const f = await registroMontado(
        base[2],
        2,
        'fechamento',
        corpoDeFechamento(base, { aposta: { seq, hash: base[1].hash } }),
      );
      const rel = await verificarCadeia([...base, f]);
      expect(rel.estado).toBe('adulterada');
      expect(rel.problemas).toContainEqual(
        expect.objectContaining({ codigo: 'fechamento_nao_anterior', seq: 4 }),
      );
    }
  });

  it('a aposta apontada foi adulterada: o hash dela denuncia', async () => {
    const base = clonar(await cadeiaBase());
    const f = await fechamentoApos(base[2], base);
    (base[1].corpo as unknown as { aposta: { odd: number } }).aposta.odd = 9;
    const rel = await verificarCadeia([...base, f]);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'hash_invalido', seq: 2 }),
    );
  });

  it('aposta de OUTRA cadeia: referencia_outra_cadeia (verificarLedger)', async () => {
    const a = await cadeiaBase('A');
    const b = await cadeiaBase('B');
    const f = await registroMontado(
      a[2],
      2,
      'fechamento',
      corpoDeFechamento(a, { aposta: { seq: 2, hash: b[1].hash } }),
    );
    const rel = await verificarLedger([...a, f, ...b]);
    const cadeiaA = rel.cadeias.find((c) => c.cadeia === 'A')!;
    expect(cadeiaA.estado).toBe('adulterada');
    expect(codigos(cadeiaA)).toEqual(
      expect.arrayContaining(['referencia_outra_cadeia', 'fechamento_hash_diverge']),
    );
  });
});

describe('o fechamento NÃO é escrito nesta versão', () => {
  it('criarRegistro recusa o tipo', async () => {
    const base = await cadeiaBase();
    await expect(
      criarRegistro(
        {
          tipo: 'fechamento' as never,
          cadeia: 'A',
          criadoEm: T(4),
          corpo: corpoDeFechamento(base) as never,
          versaoMotor: 'teste',
          politicas: { x: 1 },
        },
        base[2],
      ),
    ).rejects.toThrow(/somente leitura/);
  });

  it('conferirRegistro e anexar recusam um fechamento VÁLIDO', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    expect((await verificarCadeia([...base, f])).estado).toBe('integra'); // lê e verifica
    await expect(conferirRegistro(f)).rejects.toThrow(/somente leitura/);
    await expect(gravarSobre(base, f)).rejects.toBeInstanceOf(ErroDeCadeia);
  });

  it('a Fase A não emite autorização para um fechamento, e a Fase B o recusa antes de tocar na transação', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const chamadas: string[] = [];
    const tx: TransacaoLedger = {
      ponta: () => (chamadas.push('ponta'), null),
      ler: () => (chamadas.push('ler'), null),
      adicionar: () => void chamadas.push('adicionar'),
    };
    const armazem: ArmazemLedger = {
      transacao: async (corpo) => corpo(tx),
      ler: async (_c, seq) => (chamadas.push('ler-A'), base[seq - 1] ?? null),
    };
    // a Fase A confere o próprio registro antes de ler o armazém: nenhuma autorização é emitida
    await expect(verificarReferencias(armazem, f)).rejects.toThrow(/somente leitura/);
    // sem autorização legítima possível, a Fase B recusa pelo tipo antes de qualquer outra coisa
    expect(() => anexarNaTransacao(tx, f, {} as never)).toThrow(/somente leitura/);
    expect(chamadas).toEqual([]);
  });

  it('anexar recusa e nada é gravado nem lido', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const chamadas: string[] = [];
    const armazem: ArmazemLedger = {
      transacao: async <T>(): Promise<T> => {
        chamadas.push('transacao');
        throw new Error('não deveria abrir transação');
      },
      ler: async () => (chamadas.push('ler'), null),
    };
    await expect(anexar(armazem, f)).rejects.toThrow(/somente leitura/);
    expect(chamadas).toEqual([]);
  });
});

describe('outros pontos de leitura', () => {
  it('a reprodução de um fechamento: não reproduzível (só decisões se reproduzem)', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    expect(await reproduzirComMotorAtual(f)).toMatchObject({
      situacao: 'nao_reproduzivel',
      causa: 'tipo_sem_reproducao',
    });
  });

  it('a ordem do array não muda o resultado', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const rel = await verificarCadeia([f, base[1], base[0], base[2]]);
    expect(rel.estado).toBe('integra');
  });

  it('adulteração no esquema 1 numa cadeia mista continua sendo detectada', async () => {
    const base = clonar(await cadeiaBase());
    const f = await fechamentoApos(base[2], base);
    (base[2].corpo as unknown as { resultado: { casa: number } }).resultado.casa = 9;
    const rel = await verificarCadeia([...base, f]);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'hash_invalido', seq: 3 }),
    );
  });

  it('refazer o hash de um registro do esquema 1 numa cadeia mista: o seguinte denuncia', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const alterado = await refazerHash(base[2], (c) => {
      (c.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 9;
    });
    const rel = await verificarCadeia([base[0], base[1], alterado, f]);
    expect(rel.estado).toBe('adulterada');
    expect(codigos(rel)).toContain('prevhash_nao_confere');
  });
});
