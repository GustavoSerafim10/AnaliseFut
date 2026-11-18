/**
 * ETAPA 0 (V1): a precedência é do ESQUEMA sobre o tipo.
 *  - esquema que o verificador conhece + tipo fora da lista do esquema: registro malformado (adulteração);
 *  - esquema que o verificador NÃO conhece (qualquer tipo, até desconhecido): incompatível, nem "ok"
 *    nem "adulterado";
 *  - a precedência de estados continua adulterada > incompatível > incompleta > íntegra.
 * Os registros "de um esquema futuro" são montados à mão, com o hash correto para o prefixo dele.
 */
import { describe, expect, it } from 'vitest';
import {
  conferirRegistro,
  criarRegistro,
  ErroDeCadeia,
  hashDoRegistro,
  reproduzirComMotorAtual,
  verificarCadeia,
  verificarLedger,
  type CabecalhoLedger,
  type RegistroLedger,
} from '../../src/ledger';
import { gravarSobre } from './apoioGravacao';

const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
const clonar = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
const codigos = (r: { problemas: { codigo: string }[] }) => r.problemas.map((p) => p.codigo);

async function resultado(n: number, ultimo: RegistroLedger | null, cadeia = 'A') {
  return criarRegistro(
    {
      tipo: 'resultado',
      cadeia,
      criadoEm: T(n),
      corpo: { decisao: null, resultado: { casa: n, fora: 0, registradoEm: T(n) } },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    ultimo,
  );
}

/** Um registro de formato mais novo: esquema e tipo livres, hash correto para o prefixo do esquema. */
async function deOutroEsquema(
  base: RegistroLedger,
  esquema: number,
  tipo: unknown,
  corpo: unknown = { qualquer: 1 },
): Promise<RegistroLedger> {
  const cabecalho = {
    ...clonar(base.cabecalho),
    esquema,
    tipo,
    seq: base.cabecalho.seq + 1,
    prevHash: base.hash,
  } as unknown as CabecalhoLedger;
  return { cabecalho, corpo, hash: await hashDoRegistro(cabecalho, corpo as never) } as never;
}

describe('tipo desconhecido no esquema 1 continua sendo ADULTERAÇÃO', () => {
  it('esquema 1 + tipo fora da lista: registro_malformado, adulterada', async () => {
    const r1 = await resultado(1, null);
    for (const tipo of ['fechamento', 'xyz', 'RESULTADO', 'resultado ', 'Decisao']) {
      const estranho = await deOutroEsquema(r1, 1, tipo);
      const rel = await verificarCadeia([r1, estranho]);
      expect(rel.estado, tipo).toBe('adulterada');
      expect(rel.problemas).toContainEqual(
        expect.objectContaining({ codigo: 'registro_malformado', detalhe: 'tipo desconhecido' }),
      );
    }
  });

  it('os cinco tipos do esquema 1 continuam aceitos (contrato preservado)', async () => {
    const r1 = await resultado(1, null);
    expect((await verificarCadeia([r1])).estado).toBe('integra');
  });
});

describe('esquema NÃO suportado vence o tipo: incompatível, não adulterada', () => {
  for (const esquema of [3, 4, 99, 1000]) {
    it(`esquema ${esquema} com tipo desconhecido`, async () => {
      const r1 = await resultado(1, null);
      const futuro = await deOutroEsquema(r1, esquema, 'fechamento');
      const rel = await verificarCadeia([r1, futuro]);
      expect(rel.estado).toBe('incompativel');
      expect(codigos(rel)).toEqual(['esquema_incompativel']);
      expect(rel.problemas[0].seq).toBe(2);
    });
  }

  it('esquema 0 e negativo (nunca existiram) também: incompatível', async () => {
    const r1 = await resultado(1, null);
    for (const esquema of [0, -1, -99]) {
      const rel = await verificarCadeia([r1, await deOutroEsquema(r1, esquema, 'qualquercoisa')]);
      expect(rel.estado, String(esquema)).toBe('incompativel');
    }
  });

  it('esquema não suportado com tipo CONHECIDO continua incompatível (como antes)', async () => {
    const r1 = await resultado(1, null);
    const rel = await verificarCadeia([
      r1,
      await deOutroEsquema(r1, 99, 'exclusao', { motivo: null }),
    ]);
    expect(rel.estado).toBe('incompativel');
  });

  it('o registro de formato novo NÃO é julgado: corpo e referências livres', async () => {
    const r1 = await resultado(1, null);
    const futuro = await deOutroEsquema(r1, 99, 'fechamento', {
      aposta: { seq: 99, hash: 'não é hash' },
      campoNovo: [1, 2, 3],
    });
    const rel = await verificarCadeia([r1, futuro]);
    expect(codigos(rel)).toEqual(['esquema_incompativel']);
  });
});

describe('o que ainda é malformado, mesmo num esquema não suportado (forma do registro)', () => {
  it('esquema que não é inteiro', async () => {
    const r1 = await resultado(1, null);
    for (const esquema of [1.5, '1', null, Number.NaN, undefined, true]) {
      const f = await deOutroEsquema(r1, 99, 'x');
      (f.cabecalho as unknown as { esquema: unknown }).esquema = esquema;
      const rel = await verificarCadeia([r1, f]);
      expect(rel.estado, String(esquema)).toBe('adulterada');
      expect(codigos(rel)).toContain('registro_malformado');
    }
  });

  it('tipo ausente, vazio ou que não é texto (o tipo ainda precisa ser texto)', async () => {
    const r1 = await resultado(1, null);
    for (const tipo of [undefined, null, '', 5, {}, []]) {
      const rel = await verificarCadeia([r1, await deOutroEsquema(r1, 99, tipo)]);
      expect(rel.estado, JSON.stringify(tipo)).toBe('adulterada');
      expect(rel.problemas).toContainEqual(
        expect.objectContaining({ codigo: 'registro_malformado', detalhe: 'tipo ausente' }),
      );
    }
  });

  it('hash fora do formato, corpo que não é objeto, cadeia/seq/prevHash/criadoEm inválidos', async () => {
    const r1 = await resultado(1, null);
    const alteracoes: ((f: RegistroLedger) => void)[] = [
      (f) => ((f as unknown as { hash: unknown }).hash = 'curto'),
      (f) => ((f as unknown as { corpo: unknown }).corpo = 5),
      (f) => ((f.cabecalho as unknown as { cadeia: unknown }).cadeia = ''),
      (f) => ((f.cabecalho as unknown as { seq: unknown }).seq = 0),
      (f) => ((f.cabecalho as unknown as { prevHash: unknown }).prevHash = 'x'),
      (f) => ((f.cabecalho as unknown as { criadoEm: unknown }).criadoEm = 5),
    ];
    for (const alterar of alteracoes) {
      const f = await deOutroEsquema(r1, 99, 'fechamento');
      alterar(f);
      const rel = await verificarCadeia([r1, f]);
      expect(rel.estado).toBe('adulterada');
    }
  });
});

describe('cadeias mistas e precedência de estados', () => {
  it('registros do esquema 1 + um de esquema futuro no fim: a cadeia é incompatível, o resto verifica', async () => {
    const r1 = await resultado(1, null);
    const r2 = await resultado(2, r1);
    const futuro = await deOutroEsquema(r2, 99, 'fechamento');
    const rel = await verificarCadeia([r1, r2, futuro]);
    expect(rel.estado).toBe('incompativel');
    expect(codigos(rel)).toEqual(['esquema_incompativel']);
    expect(rel.total).toBe(3);
    expect(rel.ultimoSeq).toBe(3);
  });

  it('adulteração real no esquema 1 vence a incompatibilidade (adulterada > incompatível)', async () => {
    const r1 = await resultado(1, null);
    const r2 = clonar(await resultado(2, r1));
    const futuro = await deOutroEsquema(r2, 99, 'fechamento');
    (r2.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
    const rel = await verificarCadeia([r1, r2, futuro]);
    expect(rel.estado).toBe('adulterada');
    expect(codigos(rel)).toEqual(expect.arrayContaining(['hash_invalido', 'esquema_incompativel']));
  });

  it('incompatível vence incompleta (incompatível > incompleta)', async () => {
    const r1 = await resultado(1, null);
    const r2 = await resultado(2, r1);
    const futuro = await deOutroEsquema(r2, 99, 'fechamento');
    const rel = await verificarCadeia([r2, futuro]); // sem gênese: também incompleta
    expect(codigos(rel)).toEqual(expect.arrayContaining(['sem_genese', 'esquema_incompativel']));
    expect(rel.estado).toBe('incompativel');
  });

  it('a ordem do array não muda o resultado', async () => {
    const r1 = await resultado(1, null);
    const futuro = await deOutroEsquema(r1, 99, 'fechamento');
    expect((await verificarCadeia([futuro, r1])).estado).toBe('incompativel');
  });

  it('verificarLedger: cada cadeia por si; o registro malformado vai para o grupo próprio', async () => {
    const a1 = await resultado(1, null, 'A');
    const b1 = await resultado(1, null, 'B');
    const futuroB = await deOutroEsquema(b1, 99, 'fechamento');
    const malformado = await deOutroEsquema(a1, 1, 'fechamento'); // esquema 1 + tipo desconhecido
    const rel = await verificarLedger([a1, b1, futuroB, malformado]);
    const por = (id: string) => rel.cadeias.find((c) => c.cadeia === id)!;
    expect(por('A').estado).toBe('integra');
    expect(por('B').estado).toBe('incompativel');
    expect(por('(registros malformados)').estado).toBe('adulterada');
  });
});

describe('o caminho de gravação e a reprodução usam a mesma precedência', () => {
  it('conferirRegistro e anexar: esquema não suportado é recusado POR ESQUEMA (não por tipo)', async () => {
    const r1 = await resultado(1, null);
    const futuro = await deOutroEsquema(r1, 99, 'fechamento');
    await expect(conferirRegistro(futuro)).rejects.toThrow(/esquema 99 não suportado/);
    await expect(gravarSobre([r1], futuro)).rejects.toBeInstanceOf(ErroDeCadeia);
    await expect(gravarSobre([r1], futuro)).rejects.toThrow(/esquema 99 não suportado/);
  });

  it('esquema 1 + tipo desconhecido na gravação: recusado como tipo desconhecido', async () => {
    const r1 = await resultado(1, null);
    await expect(conferirRegistro(await deOutroEsquema(r1, 1, 'fechamento'))).rejects.toThrow(
      /tipo desconhecido/,
    );
  });

  it('criarRegistro continua recusando tipo que não é dos cinco', async () => {
    await expect(
      criarRegistro(
        {
          tipo: 'xyz' as never,
          cadeia: 'A',
          criadoEm: T(1),
          corpo: {} as never,
          versaoMotor: 'teste',
          politicas: { x: 1 },
        },
        null,
      ),
    ).rejects.toThrow(/tipo de registro desconhecido/);
  });

  it('a reprodução de um registro de esquema não suportado: não reproduzível por esquema', async () => {
    const r1 = await resultado(1, null);
    const futuro = await deOutroEsquema(r1, 99, 'fechamento');
    expect(await reproduzirComMotorAtual(futuro)).toMatchObject({
      situacao: 'nao_reproduzivel',
      causa: 'esquema_incompativel',
    });
  });
});
