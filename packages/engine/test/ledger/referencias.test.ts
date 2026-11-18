/**
 * Integridade referencial na verificação histórica: `aposta_registrada.decisao` e
 * `resultado.decisao` precisam apontar para um registro `decisao` da MESMA cadeia, anterior, que
 * exista e tenha o hash declarado. (A gravação confere o mesmo em armazem.test.ts.)
 * Os registros inválidos são forjados com o hash refeito: o hash confere, só o cruzamento acusa.
 */
import { describe, expect, it } from 'vitest';
import {
  criarRegistro,
  hashDoRegistro,
  referenciasDoRegistro,
  verificarCadeia,
  verificarLedger,
  type CorpoLedger,
  type RegistroLedger,
  type TipoRegistro,
} from '../../src/ledger';

const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
const clonar = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
const codigos = (r: { problemas: { codigo: string }[] }) => r.problemas.map((p) => p.codigo);

const STAKE = {
  autorizada: true,
  kellyCheio: 0.2,
  fracaoKelly: 0.25,
  fracaoBanca: 0.02,
  limites: ['teto'],
  teto: 0.02,
  valor: 20,
};
const TRAVAS = {
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

type Ref = { seq: number; hash: string } | null;
const corpoDe = (tipo: TipoRegistro, decisao: Ref): CorpoLedger => {
  switch (tipo) {
    case 'decisao':
      return {
        entradaMotor: { v4: null, lista: null },
        saida: {},
        snapshot: { odds: [], estatisticas: {}, contexto: {}, prints: {} },
        impressao: 'abc',
      };
    case 'aposta_registrada':
      return {
        decisao,
        aposta: { odd: 2, casa: '1win', feitaEm: T(2) },
        stakeAutorizada: STAKE,
        travas: TRAVAS,
      };
    case 'resultado':
      return { decisao, resultado: { casa: 1, fora: 0, registradoEm: T(3) } };
    default:
      return { motivo: null };
  }
};

async function criar(
  tipo: TipoRegistro,
  n: number,
  ultimo: RegistroLedger | null,
  decisao: Ref = null,
  cadeia = 'A',
): Promise<RegistroLedger> {
  return criarRegistro(
    {
      tipo,
      cadeia,
      criadoEm: T(n),
      corpo: corpoDe(tipo, decisao),
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    ultimo,
  );
}

/** [decisao, aposta → decisao, resultado → decisao] */
async function cadeia(id = 'A'): Promise<RegistroLedger[]> {
  const d = await criar('decisao', 1, null, null, id);
  const a = await criar('aposta_registrada', 2, d, { seq: 1, hash: d.hash }, id);
  const r = await criar('resultado', 3, a, { seq: 1, hash: d.hash }, id);
  return [d, a, r];
}

async function forjar(r: RegistroLedger, alterar: (c: RegistroLedger) => void) {
  const f = clonar(r);
  alterar(f);
  f.hash = await hashDoRegistro(f.cabecalho, f.corpo);
  return f;
}
const comDecisao = (ref: Ref) => (c: RegistroLedger) => {
  (c.corpo as unknown as { decisao: Ref }).decisao = ref;
};

describe('referenciasDoRegistro', () => {
  it('aposta e resultado devolvem a decisão; decisao null e outros tipos, nada', async () => {
    const [d, a, r] = await cadeia();
    expect(referenciasDoRegistro(a)).toEqual([
      { campo: 'decisao', seq: 1, hash: d.hash, tipoExigido: 'decisao' },
    ]);
    expect(referenciasDoRegistro(r)).toHaveLength(1);
    expect(referenciasDoRegistro(d)).toEqual([]);
    expect(referenciasDoRegistro(await criar('resultado', 3, a, null))).toEqual([]);
    expect(referenciasDoRegistro(await criar('exclusao', 3, a))).toEqual([]);
  });

  it('correção devolve o `corrige` (qualquer tipo anterior)', async () => {
    const [d, a] = await cadeia();
    const c = await criarRegistro(
      {
        tipo: 'correcao',
        cadeia: 'A',
        criadoEm: T(4),
        corpo: { motivo: 'm', novo: { casa: 1, fora: 0 } },
        corrige: { seq: 2, hash: a.hash },
        versaoMotor: 'teste',
        politicas: { x: 1 },
      },
      a,
    );
    expect(referenciasDoRegistro(c)).toEqual([
      { campo: 'corrige', seq: 2, hash: a.hash, tipoExigido: null },
    ]);
    void d;
  });

  it('forma inválida não lança: devolve lista vazia', () => {
    expect(
      referenciasDoRegistro({ cabecalho: { tipo: 'resultado' }, corpo: null } as never),
    ).toEqual([]);
    expect(
      referenciasDoRegistro({
        cabecalho: { tipo: 'aposta_registrada' },
        corpo: { decisao: { seq: 'x', hash: 1 } },
      } as never),
    ).toEqual([]);
  });
});

describe('verificarCadeia: referência `decisao`', () => {
  it('cadeia com as decisões certas é íntegra', async () => {
    const rel = await verificarCadeia(await cadeia());
    expect(rel.problemas).toEqual([]);
    expect(rel.estado).toBe('integra');
  });

  it('decisao null (sem vínculo) é íntegra', async () => {
    const d = await criar('decisao', 1, null);
    const a = await criar('aposta_registrada', 2, d, null);
    const r = await criar('resultado', 3, a, null);
    expect((await verificarCadeia([d, a, r])).estado).toBe('integra');
  });

  for (const [indice, nome] of [
    [1, 'aposta_registrada'],
    [2, 'resultado'],
  ] as const) {
    describe(nome, () => {
      it('hash divergente (de outro registro): adulterada, código específico', async () => {
        const lista = await cadeia();
        const f = await forjar(lista[indice], comDecisao({ seq: 1, hash: 'f'.repeat(64) }));
        const rel = await verificarCadeia([...lista.slice(0, indice), f]);
        expect(rel.estado).toBe('adulterada');
        expect(rel.problemas).toContainEqual(
          expect.objectContaining({ codigo: 'decisao_hash_diverge', seq: indice + 1 }),
        );
        expect(codigos(rel)).not.toContain('hash_invalido');
      });

      it('tipo INCORRETO: aponta para um registro que não é decisão', async () => {
        const lista = await cadeia();
        // o seq 2 é a aposta (ou, para o resultado, também a aposta): hash certo, tipo errado
        const f = await forjar(lista[indice], comDecisao({ seq: 2, hash: lista[1].hash }));
        const base = indice === 1 ? [lista[0]] : lista.slice(0, 2);
        if (indice === 1) {
          // a aposta apontando para si mesma não é anterior; usa o resultado como alvo do tipo errado
          const outra = await criar('resultado', 2, lista[0], null);
          const apos = await criar('aposta_registrada', 3, outra, { seq: 2, hash: outra.hash });
          const rel = await verificarCadeia([lista[0], outra, apos]);
          expect(rel.estado).toBe('adulterada');
          expect(rel.problemas).toContainEqual(
            expect.objectContaining({ codigo: 'decisao_tipo_incorreto', seq: 3 }),
          );
          return;
        }
        const rel = await verificarCadeia([...base, f]);
        expect(rel.estado).toBe('adulterada');
        expect(rel.problemas).toContainEqual(
          expect.objectContaining({ codigo: 'decisao_tipo_incorreto', seq: 3 }),
        );
      });

      it('seq igual ou superior ao do registro: adulterada (não é anterior)', async () => {
        const lista = await cadeia();
        for (const seq of [indice + 1, indice + 2, 99]) {
          const f = await forjar(lista[indice], comDecisao({ seq, hash: lista[0].hash }));
          const rel = await verificarCadeia([...lista.slice(0, indice), f]);
          expect(rel.estado).toBe('adulterada');
          expect(rel.problemas).toContainEqual(
            expect.objectContaining({ codigo: 'decisao_nao_anterior', seq: indice + 1 }),
          );
        }
      });

      it('decisão ausente numa cópia parcial: INCOMPLETA, não adulterada', async () => {
        const lista = await cadeia();
        const rel = await verificarCadeia(lista.slice(1));
        expect(rel.estado).toBe('incompleta');
        expect(rel.problemas).toContainEqual(
          expect.objectContaining({ codigo: 'decisao_referencia_ausente' }),
        );
      });
    });
  }

  it('a decisão apontada foi adulterada: o hash dela denuncia (hash_invalido no seq 1)', async () => {
    const lista = clonar(await cadeia());
    (lista[0].corpo as unknown as { impressao: string }).impressao = 'outra';
    const rel = await verificarCadeia(lista);
    expect(rel.estado).toBe('adulterada');
    expect(rel.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'hash_invalido', seq: 1 }),
    );
  });

  it('adulteração prevalece sobre incompleta (cópia parcial com hash de decisão errado)', async () => {
    const lista = await cadeia();
    const f = await forjar(lista[1], comDecisao({ seq: 1, hash: 'f'.repeat(64) }));
    const rel = await verificarCadeia([f, lista[2]].slice(0, 1)); // sem gênese: seq 2 sozinho
    expect(codigos(rel)).toEqual(
      expect.arrayContaining(['sem_genese', 'decisao_referencia_ausente']),
    );
    expect(rel.estado).toBe('incompleta');
    const ruim = await forjar(lista[2], comDecisao({ seq: 99, hash: lista[0].hash }));
    const rel2 = await verificarCadeia([ruim]);
    expect(rel2.estado).toBe('adulterada');
  });

  it('registro de esquema desconhecido não é julgado por esta regra', async () => {
    const lista = clonar(await cadeia());
    lista[1].cabecalho.esquema = 99;
    (lista[1].corpo as unknown as { decisao: Ref }).decisao = { seq: 99, hash: 'f'.repeat(64) };
    const rel = await verificarCadeia(lista.slice(0, 2));
    expect(codigos(rel)).toEqual(['esquema_incompativel']);
    expect(rel.estado).toBe('incompativel');
  });
});

describe('verificarLedger: referência a registro de OUTRA cadeia', () => {
  it('decisao apontando para a decisão de outra cadeia: adulterada, referencia_outra_cadeia', async () => {
    const a = await cadeia('A');
    const b = await cadeia('B');
    const f = await forjar(a[1], comDecisao({ seq: 1, hash: b[0].hash }));
    const rel = await verificarLedger([a[0], f, ...b]);
    const cadeiaA = rel.cadeias.find((c) => c.cadeia === 'A')!;
    expect(cadeiaA.estado).toBe('adulterada');
    expect(cadeiaA.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'referencia_outra_cadeia', seq: 2 }),
    );
    expect(rel.cadeias.find((c) => c.cadeia === 'B')!.estado).toBe('integra');
  });

  it('correção apontando para registro de outra cadeia: também referencia_outra_cadeia', async () => {
    const a = await cadeia('A');
    const b = await cadeia('B');
    const c = await criarRegistro(
      {
        tipo: 'correcao',
        cadeia: 'A',
        criadoEm: T(4),
        corpo: { motivo: 'm', novo: { casa: 1, fora: 0 } },
        corrige: { seq: 2, hash: b[1].hash },
        versaoMotor: 'teste',
        politicas: { x: 1 },
      },
      a[2],
    );
    const rel = await verificarLedger([...a, c, ...b]);
    const cadeiaA = rel.cadeias.find((x) => x.cadeia === 'A')!;
    expect(cadeiaA.estado).toBe('adulterada');
    expect(codigos(cadeiaA)).toEqual(
      expect.arrayContaining(['referencia_outra_cadeia', 'correcao_hash_diverge']),
    );
  });

  it('duas cadeias íntegras e separadas continuam íntegras', async () => {
    const rel = await verificarLedger([...(await cadeia('A')), ...(await cadeia('B'))]);
    expect(rel.cadeias.map((c) => c.estado)).toEqual(['integra', 'integra']);
  });
});
