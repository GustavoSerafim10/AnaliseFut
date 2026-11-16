/** Encadeamento, verificação e os estados da cadeia: íntegra, incompleta, adulterada, incompatível. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aceitarAnexo,
  conferirPonta,
  conferirRegistro,
  ConflitoDeCadeia,
  criarRegistro,
  ErroDeCadeia,
  hashDoRegistro,
  serializarCanonico,
  verificarCadeia,
  verificarLedger,
  type CorpoLedger,
  type RegistroLedger,
} from '../../src/ledger';

const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
const POLITICAS = { x: 1 };
/** o mínimo que um `resultado` precisa ter (placar inteiro e data do registro) */
const BASE_RES = { casa: 1, fora: 0, registradoEm: T(1) };
const corpo = (i: number): CorpoLedger => ({
  decisao: null,
  resultado: { casa: i, fora: 0, registradoEm: T(i), placar: [i, 0] },
});

async function construir(n: number, cadeia = 'A', opcoes: { prefixo?: string } = {}) {
  const lista: RegistroLedger[] = [];
  let ultimo: RegistroLedger | null = null;
  for (let i = 1; i <= n; i++) {
    const r: RegistroLedger = await criarRegistro(
      {
        tipo: 'resultado',
        cadeia,
        criadoEm: T(i),
        corpo: corpo(i + (opcoes.prefixo ? 100 : 0)),
        versaoMotor: 'teste',
        politicas: POLITICAS,
      },
      ultimo,
    );
    lista.push(r);
    ultimo = r;
  }
  return lista;
}
const clonar = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const codigos = (r: { problemas: { codigo: string }[] }) => r.problemas.map((p) => p.codigo);

describe('formato do hash (documentado e conferido por fora)', () => {
  it('é SHA-256 de "pe-ledger/v1\\n" + JSON canônico de { cabecalho, corpo }', async () => {
    const [r] = await construir(1);
    const impressao = createHash('sha256').update('{"x":1}', 'utf8').digest('hex');
    // a string canônica escrita À MÃO, com as chaves em ordem de unidade de código
    const esperado =
      '{"cabecalho":{"cadeia":"A","criadoEm":"2026-11-13T15:01:00-03:00","esquema":1,' +
      `"impressaoPoliticas":"${impressao}","politicas":{"x":1},"prevHash":null,"seq":1,` +
      '"tipo":"resultado","versaoMotor":"teste"},' +
      '"corpo":{"decisao":null,"resultado":{"casa":1,"fora":0,"placar":[1,0],' +
      '"registradoEm":"2026-11-13T15:01:00-03:00"}}}';
    expect(serializarCanonico({ cabecalho: r.cabecalho, corpo: r.corpo })).toBe(esperado);
    const independente = createHash('sha256')
      .update('pe-ledger/v1\n' + esperado, 'utf8')
      .digest('hex');
    expect(r.hash).toBe(independente);
    expect(await hashDoRegistro(r.cabecalho, r.corpo)).toBe(independente);
  });

  it('trava o hash de um registro conhecido (regressão do formato)', async () => {
    const [r] = await construir(1);
    expect(r.hash).toBe(GOLDEN_HASH);
  });

  it('o hash cobre o cabeçalho: mudar seq, cadeia, data ou política muda o hash', async () => {
    const [r] = await construir(1);
    const base = r.hash;
    for (const mudanca of [
      { seq: 2 },
      { cadeia: 'B' },
      { criadoEm: T(2) },
      { versaoMotor: 'outra' },
      { politicas: { x: 2 } },
    ])
      expect(await hashDoRegistro({ ...r.cabecalho, ...mudanca }, r.corpo)).not.toBe(base);
  });

  it('a ordem das propriedades na criação não muda o hash', async () => {
    const a = await criarRegistro(
      {
        tipo: 'resultado',
        cadeia: 'A',
        criadoEm: T(1),
        corpo: {
          resultado: { b: 1, registradoEm: T(1), a: 2, fora: 0, casa: 1 },
          decisao: null,
        },
        versaoMotor: 'teste',
        politicas: POLITICAS,
      },
      null,
    );
    const b = await criarRegistro(
      {
        tipo: 'resultado',
        cadeia: 'A',
        criadoEm: T(1),
        corpo: { decisao: null, resultado: { casa: 1, fora: 0, registradoEm: T(1), a: 2, b: 1 } },
        versaoMotor: 'teste',
        politicas: POLITICAS,
      },
      null,
    );
    expect(a.hash).toBe(b.hash);
  });

  it('campo ausente e undefined dão o mesmo hash; null dá outro', async () => {
    const mk = (corpoX: CorpoLedger) =>
      criarRegistro(
        {
          tipo: 'resultado',
          cadeia: 'A',
          criadoEm: T(1),
          corpo: corpoX,
          versaoMotor: 'teste',
          politicas: POLITICAS,
        },
        null,
      );
    const a = await mk({ decisao: null, resultado: { ...BASE_RES, k: 1 } });
    const b = await mk({ decisao: null, resultado: { ...BASE_RES, k: 1, extra: undefined } });
    const c = await mk({ decisao: null, resultado: { ...BASE_RES, k: 1, extra: null } });
    expect(a.hash).toBe(b.hash);
    expect(c.hash).not.toBe(a.hash);
  });

  it('determinístico: o mesmo pedido gera o mesmo registro', async () => {
    const [a] = await construir(1);
    const [b] = await construir(1);
    expect(b).toEqual(a);
  });

  it('um registro que passou por JSON (como no IndexedDB ou num backup) tem o mesmo hash', async () => {
    const lista = await construir(3);
    const volta = clonar(lista);
    for (const r of volta) expect(await hashDoRegistro(r.cabecalho, r.corpo)).toBe(r.hash);
  });
});

describe('criarRegistro', () => {
  it('gênese: seq 1 e prevHash null', async () => {
    const [r] = await construir(1);
    expect(r.cabecalho.seq).toBe(1);
    expect(r.cabecalho.prevHash).toBeNull();
    expect(r.cabecalho.esquema).toBe(1);
  });

  it('encadeia: seq seguinte e prevHash = hash do anterior', async () => {
    const [a, b, c] = await construir(3);
    expect(b.cabecalho.seq).toBe(2);
    expect(b.cabecalho.prevHash).toBe(a.hash);
    expect(c.cabecalho.prevHash).toBe(b.hash);
  });

  it('grava versão do motor, esquema, políticas e a impressão das políticas', async () => {
    const r = await criarRegistro(
      { tipo: 'exclusao', cadeia: 'A', criadoEm: T(1), corpo: { motivo: null } },
      null,
    );
    expect(r.cabecalho.versaoMotor).toMatch(/^motor-/);
    expect(r.cabecalho.esquema).toBe(1);
    expect(r.cabecalho.politicas).toBeTruthy();
    expect(r.cabecalho.impressaoPoliticas).toMatch(/^[0-9a-f]{64}$/);
  });

  it('não altera a ponta recebida', async () => {
    const [a] = await construir(1);
    const copia = JSON.stringify(a);
    await criarRegistro(
      { tipo: 'exclusao', cadeia: 'A', criadoEm: T(2), corpo: { motivo: null } },
      a,
    );
    expect(JSON.stringify(a)).toBe(copia);
  });

  it('recusa ponta de outra cadeia (cadeias não se fundem)', async () => {
    const [a] = await construir(1, 'A');
    await expect(
      criarRegistro({ tipo: 'exclusao', cadeia: 'B', criadoEm: T(2), corpo: { motivo: null } }, a),
    ).rejects.toBeInstanceOf(ErroDeCadeia);
  });

  it('recusa data sem deslocamento, texto livre e cadeia vazia', async () => {
    for (const criadoEm of ['2026-11-13', '2026-11-13T15:00:00', 'ontem', '']) {
      await expect(
        criarRegistro({ tipo: 'exclusao', cadeia: 'A', criadoEm, corpo: { motivo: null } }, null),
      ).rejects.toThrow(/ISO 8601/);
    }
    await expect(
      criarRegistro(
        { tipo: 'exclusao', cadeia: '', criadoEm: T(1), corpo: { motivo: null } },
        null,
      ),
    ).rejects.toThrow(/cadeia vazia/);
  });

  it('aceita "Z" e milissegundos', async () => {
    const r = await criarRegistro(
      {
        tipo: 'exclusao',
        cadeia: 'A',
        criadoEm: '2026-11-13T18:00:00.123Z',
        corpo: { motivo: null },
      },
      null,
    );
    expect(r.cabecalho.criadoEm).toBe('2026-11-13T18:00:00.123Z');
  });

  it('correção: exige `corrige` com hash válido e só aponta para o passado', async () => {
    const lista = await construir(2);
    const ok = await criarRegistro(
      {
        tipo: 'correcao',
        cadeia: 'A',
        criadoEm: T(3),
        corpo: { motivo: 'placar digitado errado', novo: { placar: [2, 1] } },
        corrige: { seq: 2, hash: lista[1].hash },
      },
      lista[1],
    );
    expect(ok.cabecalho.corrige).toEqual({ seq: 2, hash: lista[1].hash });
    // o registro corrigido continua exatamente como era
    expect(lista[1].corpo).toEqual(corpo(2));
    const base = {
      tipo: 'correcao' as const,
      cadeia: 'A',
      criadoEm: T(3),
      corpo: { motivo: 'x', novo: null },
    };
    await expect(criarRegistro(base, lista[1])).rejects.toThrow(/corrige/);
    await expect(
      criarRegistro({ ...base, corrige: { seq: 3, hash: lista[1].hash } }, lista[1]),
    ).rejects.toThrow(/anterior/);
    await expect(
      criarRegistro({ ...base, corrige: { seq: 1, hash: 'xyz' } }, lista[1]),
    ).rejects.toThrow(/corrige/);
    await expect(
      criarRegistro(
        {
          tipo: 'exclusao',
          cadeia: 'A',
          criadoEm: T(3),
          corpo: { motivo: null },
          corrige: { seq: 1, hash: lista[0].hash },
        },
        lista[1],
      ),
    ).rejects.toThrow(/só existe em registros/);
  });

  it('recusa conteúdo não serializável (nunca grava um registro que não dá para hashear)', async () => {
    await expect(
      criarRegistro(
        {
          tipo: 'resultado',
          cadeia: 'A',
          criadoEm: T(1),
          corpo: { decisao: null, resultado: { ...BASE_RES, x: NaN } },
        },
        null,
      ),
    ).rejects.toThrow(/não finito/);
  });
});

describe('cadeia íntegra', () => {
  it('cinco registros encadeados', async () => {
    const r = await verificarCadeia(await construir(5));
    expect(r.estado).toBe('integra');
    expect(r.problemas).toEqual([]);
    expect(r.total).toBe(5);
    expect(r.primeiroSeq).toBe(1);
    expect(r.ultimoSeq).toBe(5);
    expect(r.hashPonta).toBe((await construir(5))[4].hash);
  });

  it('a ordem do array não importa', async () => {
    const lista = await construir(6);
    const embaralhada = [lista[3], lista[0], lista[5], lista[2], lista[4], lista[1]];
    expect((await verificarCadeia(embaralhada)).estado).toBe('integra');
  });

  it('uma cópia idêntica repetida (importação duas vezes) é ignorada', async () => {
    const lista = await construir(3);
    const r = await verificarCadeia([...lista, clonar(lista[1]), clonar(lista[2])]);
    expect(r.estado).toBe('integra');
    expect(r.total).toBe(3);
  });

  it('sobrevive a JSON (IndexedDB/backup)', async () => {
    expect((await verificarCadeia(clonar(await construir(4)))).estado).toBe('integra');
  });

  it('registros congelados (imutáveis) são verificados sem erro e sem alteração', async () => {
    const lista = await construir(3);
    const congelar = (o: unknown): void => {
      if (o && typeof o === 'object') {
        Object.freeze(o);
        for (const v of Object.values(o)) congelar(v);
      }
    };
    congelar(lista);
    const antes = JSON.stringify(lista);
    expect((await verificarCadeia(lista)).estado).toBe('integra');
    expect(JSON.stringify(lista)).toBe(antes);
  });
});

describe('cadeia ADULTERADA', () => {
  it('conteúdo do corpo alterado: hash_invalido naquele registro', async () => {
    const lista = clonar(await construir(5));
    (lista[2].corpo as unknown as { resultado: { placar: number[] } }).resultado.placar[0] = 99;
    const r = await verificarCadeia(lista);
    expect(r.estado).toBe('adulterada');
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'hash_invalido', seq: 3 }),
    );
  });

  it('cabeçalho alterado (data, política, versão)', async () => {
    for (const mudanca of [
      (r: RegistroLedger) => (r.cabecalho.criadoEm = T(59)),
      (r: RegistroLedger) => ((r.cabecalho.politicas as { x: number }).x = 7),
      (r: RegistroLedger) => (r.cabecalho.versaoMotor = 'falsa'),
    ]) {
      const lista = clonar(await construir(3));
      mudanca(lista[1]);
      const r = await verificarCadeia(lista);
      expect(r.estado).toBe('adulterada');
      expect(codigos(r)).toContain('hash_invalido');
    }
  });

  it('alterar E recalcular o hash do registro: o seguinte denuncia (prevhash_nao_confere)', async () => {
    const lista = clonar(await construir(4));
    (lista[1].corpo as unknown as { resultado: { placar: number[] } }).resultado.placar[0] = 99;
    lista[1].hash = await hashDoRegistro(lista[1].cabecalho, lista[1].corpo);
    const r = await verificarCadeia(lista);
    expect(r.estado).toBe('adulterada');
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'prevhash_nao_confere', seq: 3 }),
    );
    expect(codigos(r)).not.toContain('hash_invalido');
  });

  it('refazer a cadeia inteira de forma consistente NÃO é detectável sozinho (limite documentado)', async () => {
    const original = await construir(4);
    // quem refaz tudo depois do ponto alterado: a cadeia fica íntegra, só a âncora externa denuncia
    const refeita: RegistroLedger[] = [original[0]];
    for (let i = 2; i <= 4; i++)
      refeita.push(
        await criarRegistro(
          {
            tipo: 'resultado',
            cadeia: 'A',
            criadoEm: T(i),
            corpo: corpo(i === 2 ? 999 : i),
            versaoMotor: 'teste',
            politicas: POLITICAS,
          },
          refeita[i - 2],
        ),
      );
    expect((await verificarCadeia(refeita)).estado).toBe('integra');
    const ancora = { cadeia: 'A', seq: 4, hash: original[3].hash };
    const r = await verificarCadeia(refeita, { ancora });
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toContain('ancora_diverge');
  });

  it('seq duplicado com conteúdo diferente', async () => {
    const lista = await construir(3);
    const outra = await criarRegistro(
      {
        tipo: 'resultado',
        cadeia: 'A',
        criadoEm: T(9),
        corpo: corpo(777),
        versaoMotor: 'teste',
        politicas: POLITICAS,
      },
      lista[0],
    );
    const r = await verificarCadeia([...lista, outra]);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toContain('seq_duplicada');
  });

  it('prevHash trocado (reordenação lógica) é detectado', async () => {
    const lista = clonar(await construir(3));
    lista[2].cabecalho.prevHash = lista[0].hash;
    lista[2].hash = await hashDoRegistro(lista[2].cabecalho, lista[2].corpo);
    const r = await verificarCadeia(lista);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toContain('prevhash_nao_confere');
  });

  it('gênese que aponta para um anterior (continuidade artificial)', async () => {
    const [a] = await construir(1, 'A');
    const intruso = clonar(await construir(1, 'B'))[0];
    intruso.cabecalho.prevHash = a.hash;
    intruso.hash = await hashDoRegistro(intruso.cabecalho, intruso.corpo);
    const r = await verificarCadeia([intruso]);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toContain('genese_com_prevhash');
  });

  it('hash fora do formato ou ausente, corpo ausente: registro malformado', async () => {
    const lista = clonar(await construir(3));
    (lista[1] as { hash: unknown }).hash = 'curto';
    (lista[2] as { corpo: unknown }).corpo = undefined;
    const r = await verificarCadeia(lista);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r).filter((c) => c === 'registro_malformado')).toHaveLength(2);
  });

  it('o primeiro problema aponta o registro e o motivo, sem "ok" parcial', async () => {
    const lista = clonar(await construir(6));
    (lista[4].corpo as unknown as { resultado: { placar: number[] } }).resultado.placar[1] = 5;
    const r = await verificarCadeia(lista);
    expect(r.problemas[0]).toMatchObject({ codigo: 'hash_invalido', seq: 5 });
  });
});

describe('cadeia INCOMPLETA (nada adulterado, mas faltam registros)', () => {
  it('não começa no seq 1: sem gênese', async () => {
    const lista = await construir(5);
    const r = await verificarCadeia(lista.slice(2));
    expect(r.estado).toBe('incompleta');
    expect(codigos(r)).toContain('sem_genese');
    expect(r.primeiroSeq).toBe(3);
  });

  it('lacuna no meio: não dá para ligar os lados, e isso não é "adulterada"', async () => {
    const lista = await construir(5);
    const r = await verificarCadeia([lista[0], lista[1], lista[3], lista[4]]);
    expect(r.estado).toBe('incompleta');
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'lacuna_de_seq', seq: 4 }),
    );
  });

  it('cadeia vazia', async () => {
    const r = await verificarCadeia([]);
    expect(r.estado).toBe('incompleta');
    expect(r.total).toBe(0);
    expect(r.hashPonta).toBeNull();
  });

  it('truncada no FIM: só a âncora externa detecta', async () => {
    const lista = await construir(5);
    const truncada = lista.slice(0, 3);
    expect((await verificarCadeia(truncada)).estado).toBe('integra'); // limite documentado
    const r = await verificarCadeia(truncada, {
      ancora: { cadeia: 'A', seq: 5, hash: lista[4].hash },
    });
    expect(r.estado).toBe('incompleta');
    expect(codigos(r)).toContain('ancora_ausente');
  });

  it('com adulteração E lacuna, prevalece adulterada', async () => {
    const lista = clonar(await construir(5));
    (lista[0].corpo as unknown as { resultado: { placar: number[] } }).resultado.placar[0] = 99;
    const r = await verificarCadeia([lista[0], lista[1], lista[3], lista[4]]);
    expect(r.estado).toBe('adulterada');
    expect(codigos(r)).toContain('lacuna_de_seq');
  });
});

describe('cadeia INCOMPATÍVEL', () => {
  it('esquema desconhecido: nem "ok" nem "adulterada"', async () => {
    const lista = clonar(await construir(3));
    lista[2].cabecalho.esquema = 99;
    const r = await verificarCadeia(lista);
    expect(r.estado).toBe('incompativel');
    expect(r.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'esquema_incompativel', seq: 3 }),
    );
  });

  it('esquema 0 e negativo também', async () => {
    for (const e of [0, -1]) {
      const lista = clonar(await construir(2));
      lista[1].cabecalho.esquema = e;
      expect((await verificarCadeia(lista)).estado).toBe('incompativel');
    }
  });

  it('adulteração real em registros compatíveis não é escondida pelo esquema novo', async () => {
    const lista = clonar(await construir(4));
    lista[3].cabecalho.esquema = 99;
    (lista[1].corpo as unknown as { resultado: { placar: number[] } }).resultado.placar[0] = 99;
    expect((await verificarCadeia(lista)).estado).toBe('adulterada');
  });
});

describe('origem: local × importada (identidades preservadas, sem continuidade artificial)', () => {
  it('a origem é independente do estado de integridade', async () => {
    const a = await verificarCadeia(await construir(3, 'APARELHO-1'), {
      cadeiaLocal: 'APARELHO-1',
    });
    const b = await verificarCadeia(await construir(3, 'APARELHO-2'), {
      cadeiaLocal: 'APARELHO-1',
    });
    expect(a).toMatchObject({ estado: 'integra', origem: 'local' });
    expect(b).toMatchObject({ estado: 'integra', origem: 'importada' });
    expect((await verificarCadeia(await construir(3, 'X'))).origem).toBe('indeterminada');
  });

  it('verificarLedger mantém cada cadeia separada, com a própria ponta', async () => {
    const a = await construir(3, 'LOCAL');
    const b = await construir(2, 'IMPORTADA', { prefixo: 'x' });
    const rel = await verificarLedger([...a, ...b], { cadeiaLocal: 'LOCAL' });
    expect(rel.cadeias.map((c) => [c.cadeia, c.estado, c.origem, c.total])).toEqual([
      ['IMPORTADA', 'integra', 'importada', 2],
      ['LOCAL', 'integra', 'local', 3],
    ]);
    expect(rel.cadeias.find((c) => c.cadeia === 'LOCAL')!.hashPonta).toBe(a[2].hash);
    expect(rel.cadeias.find((c) => c.cadeia === 'IMPORTADA')!.hashPonta).toBe(b[1].hash);
  });

  it('cadeias com a mesma sequência de seq não se misturam nem geram duplicidade', async () => {
    const rel = await verificarLedger([...(await construir(3, 'A')), ...(await construir(3, 'B'))]);
    expect(rel.cadeias.every((c) => c.estado === 'integra')).toBe(true);
  });

  it('um registro que encadeia na cadeia de OUTRA origem é continuidade artificial', async () => {
    const importada = await construir(3, 'IMPORTADA');
    const intruso = await criarRegistro(
      {
        tipo: 'resultado',
        cadeia: 'LOCAL',
        criadoEm: T(5),
        corpo: corpo(1),
        versaoMotor: 'teste',
        politicas: POLITICAS,
      },
      null,
    );
    const colado = clonar(intruso);
    colado.cabecalho.prevHash = importada[2].hash;
    colado.hash = await hashDoRegistro(colado.cabecalho, colado.corpo);
    const rel = await verificarLedger([...importada, colado], { cadeiaLocal: 'LOCAL' });
    const local = rel.cadeias.find((c) => c.cadeia === 'LOCAL')!;
    expect(local.estado).toBe('adulterada');
    expect(codigos(local)).toContain('continuidade_artificial');
    expect(rel.cadeias.find((c) => c.cadeia === 'IMPORTADA')!.estado).toBe('integra');
  });

  it('verificarCadeia recusa misturar cadeias (use verificarLedger)', async () => {
    await expect(
      verificarCadeia([...(await construir(1, 'A')), ...(await construir(1, 'B'))]),
    ).rejects.toBeInstanceOf(ErroDeCadeia);
  });

  it('registros malformados não derrubam a verificação das demais cadeias', async () => {
    const rel = await verificarLedger([...(await construir(2, 'A')), { lixo: true } as never]);
    expect(rel.cadeias.find((c) => c.cadeia === 'A')!.estado).toBe('integra');
    expect(rel.cadeias.find((c) => c.cadeia === '(registros malformados)')!.estado).toBe(
      'adulterada',
    );
  });

  it('âncora de outra cadeia é ignorada para esta', async () => {
    const lista = await construir(3, 'A');
    const r = await verificarCadeia(lista, {
      ancora: { cadeia: 'B', seq: 9, hash: 'f'.repeat(64) },
    });
    expect(r.estado).toBe('integra');
  });
});

describe('âncora externa', () => {
  it('a ponta confere: continua íntegra', async () => {
    const lista = await construir(4);
    const r = await verificarCadeia(lista, {
      ancora: { cadeia: 'A', seq: 4, hash: lista[3].hash },
    });
    expect(r.estado).toBe('integra');
  });
  it('âncora de um registro do meio também vale', async () => {
    const lista = await construir(4);
    expect(
      (await verificarCadeia(lista, { ancora: { cadeia: 'A', seq: 2, hash: lista[1].hash } }))
        .estado,
    ).toBe('integra');
  });
});

describe('concorrência: aceitarAnexo (contrato para a gravação atômica da L2)', () => {
  it('o primeiro escritor passa; o segundo, que leu a mesma ponta, recebe conflito', async () => {
    const [a] = await construir(1);
    const pedido = (n: number) => ({
      tipo: 'resultado' as const,
      cadeia: 'A',
      criadoEm: T(n),
      corpo: corpo(n),
      versaoMotor: 'teste',
      politicas: POLITICAS,
    });
    // duas abas leem a mesma ponta (a) e criam o seq 2 ao mesmo tempo
    const daAba1 = await criarRegistro(pedido(10), a);
    const daAba2 = await criarRegistro(pedido(11), a);
    await expect(aceitarAnexo(a, daAba1)).resolves.toBeUndefined(); // a aba 1 grava
    // a ponta gravada agora é daAba1: a aba 2 falha e precisa reler
    await expect(aceitarAnexo(daAba1, daAba2)).rejects.toBeInstanceOf(ConflitoDeCadeia);
    // ao reler e recriar, passa
    const refeito = await criarRegistro(pedido(11), daAba1);
    await expect(aceitarAnexo(daAba1, refeito)).resolves.toBeUndefined();
    expect(refeito.cabecalho.seq).toBe(3);
  });

  it('gênese só entra em cadeia vazia', async () => {
    const [a] = await construir(1);
    const outraGenese = (await construir(1))[0];
    await expect(aceitarAnexo(null, a)).resolves.toBeUndefined();
    await expect(aceitarAnexo(a, outraGenese)).rejects.toBeInstanceOf(ConflitoDeCadeia);
  });

  it('seq pulado ou prevHash errado são recusados', async () => {
    const lista = await construir(3);
    await expect(aceitarAnexo(lista[0], lista[2])).rejects.toThrow(/esperado seq 2/);
    const falso = clonar(lista[1]);
    falso.cabecalho.prevHash = 'f'.repeat(64);
    falso.hash = await hashDoRegistro(falso.cabecalho, falso.corpo); // hash coerente: só a ponta denuncia
    await expect(aceitarAnexo(lista[0], falso)).rejects.toThrow(/prevHash/);
  });

  it('ponta de outra cadeia é recusada', async () => {
    const a = (await construir(1, 'A'))[0];
    const b = (await construir(2, 'B'))[1];
    await expect(aceitarAnexo(a, b)).rejects.toBeInstanceOf(ConflitoDeCadeia);
  });

  it('cem abas concorrentes: exatamente uma vence por rodada e a cadeia final é íntegra', async () => {
    let gravada: RegistroLedger[] = [];
    const ponta = () => gravada.at(-1) ?? null;
    const tentar = async (n: number): Promise<boolean> => {
      for (let i = 0; i < 1000; i++) {
        const lida = ponta();
        const novo = await criarRegistro(
          {
            tipo: 'resultado',
            cadeia: 'A',
            criadoEm: T(n),
            corpo: corpo(n),
            versaoMotor: 'teste',
            politicas: POLITICAS,
          },
          lida,
        );
        try {
          // a transação: confere a ponta gravada NESTE instante e grava
          await conferirRegistro(novo); // assíncrono, fora da "transação"
          conferirPonta(ponta(), novo); // síncrono + gravação: o trecho atômico
          gravada = [...gravada, novo];
          return true;
        } catch (e) {
          if (!(e instanceof ConflitoDeCadeia)) throw e;
        }
      }
      return false;
    };
    const resultados = await Promise.all(Array.from({ length: 100 }, (_, i) => tentar(i + 1)));
    expect(resultados.every(Boolean)).toBe(true);
    expect(gravada).toHaveLength(100);
    expect((await verificarCadeia(gravada)).estado).toBe('integra');
    expect(gravada.map((r) => r.cabecalho.seq)).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
  });
});

// Hash de referência do registro 1 de `construir(1)`: trava o formato. Se mudar, o ESQUEMA muda.
const GOLDEN_HASH = 'bf206d9b8d4011a8e0c2f22ab4e23ddf8f7ec77110f0c90c6b3eddc691882644';
