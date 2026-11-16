/** Reprodução histórica: reexecuta e compara, sem NUNCA alterar o registro. */
import { describe, expect, it } from 'vitest';
import { analisarV4, melhoresEntradas } from '../../src';
import {
  criarRegistro,
  executorDoMotorAtual,
  impressaoDaDecisao,
  impressaoDasPoliticas,
  politicasVigentes,
  reproduzir,
  reproduzirComMotorAtual,
  resumirSaidaDoMotor,
  verificarCadeia,
  VERSAO_MOTOR,
  type CorpoDecisao,
  type Json,
  type RegistroLedger,
} from '../../src/ledger';

const AGORA = '2026-10-26T16:00:00-03:00';
const JOGO = { casa: 'Flamengo', fora: 'Atlético-MG', inicio: '2026-10-26T20:00:00-03:00' };
const par = (casa: string, o: number, u: number, linha = 2.5) =>
  (['over', 'under'] as const).map((lado, i) => ({
    casa,
    mercado: 'total',
    lado,
    odd: i === 0 ? o : u,
    linha,
    periodo: 'FT',
    horarioColeta: AGORA,
  }));
const json = <T>(x: T): Json => JSON.parse(JSON.stringify(x)) as Json;

const entradaV4 = () => ({
  jogo: JOGO,
  agora: AGORA,
  ligaPrincipal: true,
  banca: 1000,
  linhas: [...par('Pinnacle', 1.95, 1.95), ...par('1win', 2.1, 1.72)],
});
const entradaLista = () => ({
  jogo: JOGO,
  agora: AGORA,
  linhas: par('1win', 1.4, 3.0, 1.5),
  apoio: { lambdas: { casa: 2.0, fora: 0.8 }, dq: 'A', w: 0.5, jogosMin: 10 },
});

type Opcoes = {
  v4?: Json | null;
  lista?: Json | null;
  versaoMotor?: string;
  politicas?: Json;
  saida?: Json;
};

async function registro(o: Opcoes = {}): Promise<RegistroLedger> {
  const v4 = o.v4 === undefined ? json(entradaV4()) : o.v4;
  const lista = o.lista === undefined ? null : o.lista;
  const saida =
    o.saida ??
    resumirSaidaDoMotor(
      v4 ? analisarV4(v4 as never) : null,
      lista ? melhoresEntradas(lista as never) : null,
    );
  const corpo: CorpoDecisao = {
    entradaMotor: { v4, lista },
    saida,
    snapshot: { odds: [], estatisticas: {}, contexto: {}, prints: {} },
    impressao: await impressaoDaDecisao(saida, 'A'),
  };
  return criarRegistro(
    {
      tipo: 'decisao',
      cadeia: 'A',
      criadoEm: '2026-10-26T16:00:00-03:00',
      corpo,
      ...(o.versaoMotor ? { versaoMotor: o.versaoMotor } : {}),
      ...(o.politicas ? { politicas: o.politicas } : {}),
    },
    null,
  );
}

const congelar = (o: unknown): void => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) congelar(v);
  }
};

describe('reprodução fiel', () => {
  it('a V4: o motor atual reproduz exatamente a decisão gravada', async () => {
    const r = await reproduzirComMotorAtual(await registro());
    expect(r.situacao).toBe('reproduzida');
    expect(r.causa).toBeUndefined();
    expect(r.diferencas).toEqual([]);
    expect(r.hashSaidaGravada).toBe(r.hashSaidaRecalculada);
    expect(r.versaoGravada).toBe(VERSAO_MOTOR);
    expect(r.politicasMudaram).toBe(false);
  });

  it('a lista de entradas também', async () => {
    const r = await reproduzirComMotorAtual(
      await registro({ v4: null, lista: json(entradaLista()) }),
    );
    expect(r.situacao).toBe('reproduzida');
  });

  it('V4 e lista juntas', async () => {
    const r = await reproduzirComMotorAtual(await registro({ lista: json(entradaLista()) }));
    expect(r.situacao).toBe('reproduzida');
  });

  it('determinístico: reproduzir de novo dá o mesmo relatório', async () => {
    const reg = await registro();
    expect(await reproduzirComMotorAtual(reg)).toEqual(await reproduzirComMotorAtual(reg));
  });

  it('um registro que passou por JSON (banco, backup) reproduz do mesmo jeito', async () => {
    const reg = await registro();
    const volta = JSON.parse(JSON.stringify(reg)) as RegistroLedger;
    expect((await reproduzirComMotorAtual(volta)).situacao).toBe('reproduzida');
  });

  it('o resumo gravado cobre decisão, preço, stake, rastro por linha e motivos', async () => {
    const reg = await registro();
    const saida = (reg.corpo as CorpoDecisao).saida as {
      v4: { decisao: string; melhor: { stake: unknown }; rastro: unknown[]; avaliadas: unknown[] };
    };
    expect(saida.v4.decisao).toBe('BET');
    expect(saida.v4.melhor.stake).toBeTruthy();
    expect(saida.v4.rastro.length).toBe(entradaV4().linhas.length);
    expect(saida.v4.avaliadas.length).toBeGreaterThan(0);
  });
});

describe('divergência: relatada, com causa, sem tocar no registro', () => {
  const adulteraSaida = async (): Promise<Json> => {
    const base = (await registro()).corpo as CorpoDecisao;
    const saida = JSON.parse(JSON.stringify(base.saida)) as { v4: { decisao: string } };
    saida.v4.decisao = 'NO_BET';
    return saida as unknown as Json;
  };

  it('mesma versão e mesmas políticas: divergência séria (motor não determinístico ou mudou sem avisar)', async () => {
    const r = await reproduzirComMotorAtual(await registro({ saida: await adulteraSaida() }));
    expect(r.situacao).toBe('divergente');
    expect(r.causa).toBe('mesma_versao_e_politicas');
    expect(r.diferencas.map((d) => d.caminho)).toContain('v4.decisao');
    const d = r.diferencas.find((x) => x.caminho === 'v4.decisao')!;
    expect(d.gravado).toBe('NO_BET');
    expect(d.recalculado).toBe('BET');
    expect(r.hashSaidaGravada).not.toBe(r.hashSaidaRecalculada);
  });

  it('versão do motor diferente: causa esperada, e o registro continua com a versão da época', async () => {
    const reg = await registro({ saida: await adulteraSaida(), versaoMotor: 'motor-antigo-1' });
    const r = await reproduzirComMotorAtual(reg);
    expect(r.situacao).toBe('divergente');
    expect(r.causa).toBe('versao_do_motor_diferente');
    expect(r.versaoGravada).toBe('motor-antigo-1');
    expect(r.versaoAtual).toBe(VERSAO_MOTOR);
    expect(reg.cabecalho.versaoMotor).toBe('motor-antigo-1');
  });

  it('política diferente (limite mudou, versão não): detectada pela impressão das políticas', async () => {
    const velha = json({ ...(politicasVigentes() as object), exposicao: { tetoPorJogo: 0.5 } });
    const reg = await registro({ saida: await adulteraSaida(), politicas: velha });
    const r = await reproduzirComMotorAtual(reg);
    expect(r.situacao).toBe('divergente');
    expect(r.causa).toBe('politicas_diferentes');
    expect(r.politicasMudaram).toBe(true);
  });

  it('política diferente mas saída igual: reproduzida (a política mudou sem efeito neste caso)', async () => {
    const velha = json({ ...(politicasVigentes() as object), extra: 1 });
    const r = await reproduzirComMotorAtual(await registro({ politicas: velha }));
    expect(r.situacao).toBe('reproduzida');
    expect(r.politicasMudaram).toBe(true);
  });

  it('as diferenças trazem caminho, valor gravado e valor recalculado', async () => {
    const base = (await registro()).corpo as CorpoDecisao;
    const saida = JSON.parse(JSON.stringify(base.saida)) as {
      v4: { melhor: { ev: number; stake: { fracaoBanca: number } } };
    };
    saida.v4.melhor.ev = 0.5;
    saida.v4.melhor.stake.fracaoBanca = 0.5;
    const r = await reproduzirComMotorAtual(await registro({ saida: saida as unknown as Json }));
    const caminhos = r.diferencas.map((d) => d.caminho);
    expect(caminhos).toContain('v4.melhor.ev');
    expect(caminhos).toContain('v4.melhor.stake.fracaoBanca');
  });

  it('limita a lista de diferenças (não explode com saídas muito diferentes)', async () => {
    const r = await reproduzir(await registro(), () => ({
      v4: { lixo: Array.from({ length: 500 }, (_, i) => i) },
    }));
    expect(r.situacao).toBe('divergente');
    expect(r.diferencas.length).toBeLessThanOrEqual(50);
  });
});

describe('o passado nunca é alterado pela reprodução', () => {
  it('registro congelado: reproduzir não lança e não muda um byte', async () => {
    const reg = await registro({ saida: json({ v4: { decisao: 'NO_BET' } }) });
    congelar(reg);
    const antes = JSON.stringify(reg);
    const r = await reproduzirComMotorAtual(reg);
    expect(r.situacao).toBe('divergente');
    expect(JSON.stringify(reg)).toBe(antes);
  });

  it('um executor que mexe na entrada só mexe na cópia', async () => {
    const reg = await registro();
    congelar(reg);
    const antes = JSON.stringify(reg);
    const r = await reproduzir(reg, (entrada) => {
      const v4 = entrada.v4 as { linhas: unknown[]; banca: number };
      v4.linhas.length = 0;
      v4.banca = -1;
      (entrada as { v4: unknown }).v4 = null;
      return {};
    });
    expect(r.situacao).toBe('divergente');
    expect(JSON.stringify(reg)).toBe(antes);
  });

  it('o hash do registro continua o mesmo depois de reproduzir (divergente ou não)', async () => {
    const reg = await registro({ saida: json({ v4: { decisao: 'NO_BET' } }) });
    const hash = reg.hash;
    await reproduzirComMotorAtual(reg);
    expect(reg.hash).toBe(hash);
  });

  it('divergência de reprodução NÃO muda o estado da cadeia (são eixos separados)', async () => {
    const reg = await registro({ saida: json({ v4: { decisao: 'NO_BET' } }) });
    expect((await reproduzirComMotorAtual(reg)).situacao).toBe('divergente');
    const cadeia = await verificarCadeia([reg]);
    expect(cadeia.estado).toBe('integra');
  });

  it('o relatório é um objeto novo: alterá-lo não afeta o registro', async () => {
    const reg = await registro({ saida: json({ v4: { decisao: 'NO_BET' } }) });
    const r = await reproduzirComMotorAtual(reg);
    r.diferencas.length = 0;
    r.situacao = 'reproduzida';
    expect((await reproduzirComMotorAtual(reg)).situacao).toBe('divergente');
  });
});

describe('o que não é reproduzível', () => {
  it('esquema desconhecido', async () => {
    const reg = JSON.parse(JSON.stringify(await registro())) as RegistroLedger;
    reg.cabecalho.esquema = 99;
    const r = await reproduzirComMotorAtual(reg);
    expect(r).toMatchObject({ situacao: 'nao_reproduzivel', causa: 'esquema_incompativel' });
  });

  it('só decisões se reproduzem', async () => {
    const reg = await criarRegistro(
      {
        tipo: 'exclusao',
        cadeia: 'A',
        criadoEm: '2026-10-26T16:00:00-03:00',
        corpo: { motivo: null },
      },
      null,
    );
    expect(await reproduzirComMotorAtual(reg)).toMatchObject({
      situacao: 'nao_reproduzivel',
      causa: 'tipo_sem_reproducao',
    });
  });

  it('decisão sem entrada do motor', async () => {
    const corpo: CorpoDecisao = {
      entradaMotor: { v4: null, lista: null },
      saida: {},
      snapshot: { odds: [], estatisticas: {}, contexto: {}, prints: {} },
      impressao: 'x',
    };
    const reg = await criarRegistro(
      { tipo: 'decisao', cadeia: 'A', criadoEm: '2026-10-26T16:00:00-03:00', corpo },
      null,
    );
    expect(await reproduzirComMotorAtual(reg)).toMatchObject({
      situacao: 'nao_reproduzivel',
      causa: 'registro_sem_entrada',
    });
  });

  it('erro ao executar o motor (entrada inválida gravada): relatado, sem exceção', async () => {
    const reg = await registro({
      v4: json({ ...entradaV4(), jogo: { ...JOGO, inicio: 'sem data' } }),
      saida: json({ v4: {} }),
    });
    const r = await reproduzirComMotorAtual(reg);
    expect(r.situacao).toBe('nao_reproduzivel');
    expect(r.causa).toBe('erro_ao_executar');
    expect(r.detalhe).toContain('inicio');
  });

  it('executor que lança também é relatado', async () => {
    const r = await reproduzir(await registro(), () => {
      throw new Error('falhou');
    });
    expect(r).toMatchObject({
      situacao: 'nao_reproduzivel',
      causa: 'erro_ao_executar',
      detalhe: 'falhou',
    });
  });
});

describe('impressão digital da decisão', () => {
  it('estável e igual para a mesma decisão', async () => {
    const saida = ((await registro()).corpo as CorpoDecisao).saida;
    expect(await impressaoDaDecisao(saida, 'A')).toBe(await impressaoDaDecisao(saida, 'A'));
  });

  it('muda com a decisão, a stake, a melhor odd e a DQ', async () => {
    const base = JSON.parse(JSON.stringify(((await registro()).corpo as CorpoDecisao).saida)) as {
      v4: { decisao: string; melhor: { melhorOdd: number; stake: { fracaoBanca: number } } };
    };
    const ref = await impressaoDaDecisao(base as unknown as Json, 'A');
    const muda = async (f: (x: typeof base) => void, dq = 'A') => {
      const c = JSON.parse(JSON.stringify(base)) as typeof base;
      f(c);
      return impressaoDaDecisao(c as unknown as Json, dq);
    };
    expect(await muda((c) => (c.v4.decisao = 'NO_BET'))).not.toBe(ref);
    expect(await muda((c) => (c.v4.melhor.stake.fracaoBanca += 0.001))).not.toBe(ref);
    expect(await muda((c) => (c.v4.melhor.melhorOdd += 0.01))).not.toBe(ref);
    expect(await muda(() => undefined, 'C')).not.toBe(ref);
  });

  it('NÃO muda com o texto dos motivos (edição irrelevante não gera registro novo)', async () => {
    const base = JSON.parse(JSON.stringify(((await registro()).corpo as CorpoDecisao).saida)) as {
      v4: { motivos: string[] };
    };
    const ref = await impressaoDaDecisao(base as unknown as Json, 'A');
    base.v4.motivos.push('outro texto qualquer');
    expect(await impressaoDaDecisao(base as unknown as Json, 'A')).toBe(ref);
  });

  it('aceita saída vazia sem lançar', async () => {
    await expect(impressaoDaDecisao({}, null)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('versão do motor e políticas', () => {
  it('as políticas vigentes são JSON serializável e trazem os limites que decidem', () => {
    const p = politicasVigentes() as {
      exposicao: { tetoPorJogo: number; tetoPorDia: number; tetoGeralPorAposta: number };
      v4: { gates: { R2: number } };
    };
    expect(p.exposicao.tetoPorJogo).toBe(0.02);
    expect(p.exposicao.tetoPorDia).toBe(0.06);
    expect(p.exposicao.tetoGeralPorAposta).toBe(0.02);
    expect(p.v4.gates.R2).toBe(0.035);
  });

  it('a impressão das políticas é estável entre chamadas', async () => {
    expect(await impressaoDasPoliticas()).toBe(await impressaoDasPoliticas());
  });

  it('trava as políticas de hoje: mudar qualquer limite exige atualizar este teste e VERSAO_MOTOR', async () => {
    expect(await impressaoDasPoliticas()).toBe(IMPRESSAO_POLITICAS_ATUAIS);
  });

  it('o executor do motor atual é o usado por reproduzirComMotorAtual', async () => {
    const reg = await registro();
    const direto = await reproduzir(reg, executorDoMotorAtual);
    expect(direto).toEqual(await reproduzirComMotorAtual(reg));
  });
});

// Impressão das políticas vigentes em 2026-11-13 (VERSAO_MOTOR motor-2026-11-13.1).
const IMPRESSAO_POLITICAS_ATUAIS =
  'ad3e3f798ff3d30898c71235234f979f649f6d43323cf9aa22ca90d5deb2664b';
