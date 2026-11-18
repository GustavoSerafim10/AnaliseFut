/**
 * Testes CRUZADOS V1 × V2. O verificador V1 é o da etapa anterior ao esquema 2: conhece só o esquema 1
 * (`esquemasSuportados: [1]`) e já tem a precedência de esquema sobre tipo. O V2 conhece os esquemas 1
 * e 2 (padrão). Os mesmos registros são verificados pelos dois: nada é reescrito entre eles.
 */
import { describe, expect, it } from 'vitest';
import {
  conferirRegistro,
  hashDoRegistro,
  verificarCadeia,
  verificarLedger,
  type RegistroLedger,
} from '../../src/ledger';
import {
  cadeiaBase,
  clonar,
  codigos,
  corpoDeFechamento,
  fechamentoApos,
  registroMontado,
} from './apoioEsquema2';

const V1 = { esquemasSuportados: [1] } as const;
const resumo = (r: { estado: string; problemas: { codigo: string }[] }) => ({
  estado: r.estado,
  codigos: [...new Set(codigos(r))].sort(),
});

describe('mesmos registros, dois verificadores (matriz V1 × V2)', () => {
  it('só esquema 1: igual nos dois', async () => {
    const base = await cadeiaBase();
    expect(resumo(await verificarCadeia(base, V1))).toEqual(resumo(await verificarCadeia(base)));
    expect((await verificarCadeia(base, V1)).estado).toBe('integra');
  });

  it('fechamento VÁLIDO: V1 incompatível, V2 íntegra', async () => {
    const base = await cadeiaBase();
    const lista = [...base, await fechamentoApos(base[2], base)];
    expect(resumo(await verificarCadeia(lista, V1))).toEqual({
      estado: 'incompativel',
      codigos: ['esquema_incompativel'],
    });
    expect(resumo(await verificarCadeia(lista))).toEqual({ estado: 'integra', codigos: [] });
  });

  it('fechamento INVÁLIDO: V1 não julga (incompatível), V2 acusa (adulterada)', async () => {
    const base = await cadeiaBase();
    const ruim = await registroMontado(
      base[2],
      2,
      'fechamento',
      corpoDeFechamento(base, { oddFechamento: 1 }),
    );
    const lista = [...base, ruim];
    expect(resumo(await verificarCadeia(lista, V1))).toEqual({
      estado: 'incompativel',
      codigos: ['esquema_incompativel'],
    });
    expect(resumo(await verificarCadeia(lista))).toEqual({
      estado: 'adulterada',
      codigos: ['corpo_incompativel'],
    });
  });

  it('referência do fechamento com hash errado: V1 incompatível, V2 adulterada', async () => {
    const base = await cadeiaBase();
    const f = await registroMontado(
      base[2],
      2,
      'fechamento',
      corpoDeFechamento(base, { aposta: { seq: 2, hash: 'f'.repeat(64) } }),
    );
    expect(resumo(await verificarCadeia([...base, f], V1)).estado).toBe('incompativel');
    expect(resumo(await verificarCadeia([...base, f]))).toEqual({
      estado: 'adulterada',
      codigos: ['fechamento_hash_diverge'],
    });
  });

  it('tipo dos cinco com esquema 2 (incoerente): V1 incompatível, V2 adulterada', async () => {
    const base = await cadeiaBase();
    const r = await registroMontado(base[2], 2, 'exclusao', { motivo: null });
    expect((await verificarCadeia([...base, r], V1)).estado).toBe('incompativel');
    expect((await verificarCadeia([...base, r])).estado).toBe('adulterada');
  });

  it('fechamento com esquema 1: adulterada nos dois (tipo fora do esquema 1)', async () => {
    const base = await cadeiaBase();
    const f = await registroMontado(base[2], 1, 'fechamento', corpoDeFechamento(base));
    expect(resumo(await verificarCadeia([...base, f], V1))).toEqual(
      resumo(await verificarCadeia([...base, f])),
    );
    expect((await verificarCadeia([...base, f], V1)).estado).toBe('adulterada');
  });

  it('esquema 3 + fechamento: incompatível nos dois', async () => {
    const base = await cadeiaBase();
    const f = await registroMontado(base[2], 3, 'fechamento', corpoDeFechamento(base));
    expect((await verificarCadeia([...base, f], V1)).estado).toBe('incompativel');
    expect((await verificarCadeia([...base, f])).estado).toBe('incompativel');
  });

  it('adulteração no esquema 1 vence a incompatibilidade nos dois (adulterada > incompatível)', async () => {
    const base = clonar(await cadeiaBase());
    const f = await fechamentoApos(base[2], base);
    (base[1].corpo as unknown as { aposta: { odd: number } }).aposta.odd = 9;
    for (const opcoes of [V1, {}]) {
      const rel = await verificarCadeia([...base, f], opcoes);
      expect(rel.estado).toBe('adulterada');
      expect(codigos(rel)).toContain('hash_invalido');
    }
  });

  it('o resto do relatório não depende do verificador (total, pontas, hash da ponta)', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const r1 = await verificarCadeia([...base, f], V1);
    const r2 = await verificarCadeia([...base, f]);
    for (const k of ['cadeia', 'total', 'primeiroSeq', 'ultimoSeq', 'hashPonta', 'origem'] as const)
      expect(r1[k], k).toEqual(r2[k]);
  });
});

describe('verificarLedger: cadeias importadas, mistas e simples', () => {
  it('a cadeia com fechamento é incompatível no V1 e íntegra no V2; a outra, íntegra nos dois', async () => {
    const a = await cadeiaBase('A');
    const fa = await fechamentoApos(a[2], a);
    const b = await cadeiaBase('B');
    const todos = [...a, fa, ...b];
    const v1 = await verificarLedger(todos, V1);
    const v2 = await verificarLedger(todos);
    const por = (rel: typeof v1, id: string) => rel.cadeias.find((c) => c.cadeia === id)!.estado;
    expect([por(v1, 'A'), por(v1, 'B')]).toEqual(['incompativel', 'integra']);
    expect([por(v2, 'A'), por(v2, 'B')]).toEqual(['integra', 'integra']);
  });
});

describe('ordem segura de implantação: ler antes de escrever', () => {
  it('os mesmos registros, sem reescrever nada, passam de incompatível (V1) a íntegra (V2)', async () => {
    const base = await cadeiaBase();
    const lista: RegistroLedger[] = [...base, await fechamentoApos(base[2], base)];
    const antes = JSON.stringify(lista);
    expect((await verificarCadeia(lista, V1)).estado).toBe('incompativel');
    expect((await verificarCadeia(lista)).estado).toBe('integra');
    expect(JSON.stringify(lista)).toBe(antes); // verificar nunca altera o registro
  });

  it('nenhum fechamento válido, em nenhuma variante, é chamado de ADULTERADO pelo V1', async () => {
    const base = await cadeiaBase();
    const variantes: Record<string, unknown>[] = [
      {},
      { fonte: 'x' },
      { fechamentoOutros: [3.4] },
      { fechamentoOutros: [3.4, 5.2], oddFechamento: 2.05 },
      { oddFechamento: 1.01 },
    ];
    for (const extra of variantes) {
      const f = await fechamentoApos(base[2], base, extra);
      const rel = await verificarCadeia([...base, f], V1);
      expect(rel.estado, JSON.stringify(extra)).toBe('incompativel');
    }
  });

  it('o prefixo v2 não interfere nos hashes do esquema 1: iguais nos dois verificadores', async () => {
    const base = await cadeiaBase();
    for (const r of base) expect(await hashDoRegistro(r.cabecalho, r.corpo)).toBe(r.hash);
    const f = await fechamentoApos(base[2], base);
    // o fechamento encadeia no hash do registro do esquema 1 anterior, sem mudar nada nele
    expect(f.cabecalho.prevHash).toBe(base[2].hash);
  });

  it('o portão de escrita é o mesmo: nenhum verificador grava o fechamento', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    await expect(conferirRegistro(f)).rejects.toThrow(/somente leitura/);
  });
});
