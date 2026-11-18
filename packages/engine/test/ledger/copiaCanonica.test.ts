/**
 * CÓPIA CANÔNICA: o que é gravado é exatamente o que foi validado e autorizado.
 *
 * A Fase A lê o registro do chamador UMA vez (`serializarCanonico`), transforma esse texto numa cópia de
 * dados puros (`JSON.parse`), congela e valida só a cópia; a autorização fica ligada a ela, e a Fase B
 * grava a cópia, nunca o objeto do chamador. Por isso um getter (ou Proxy) que muda de valor entre as
 * leituras não consegue fazer gravar outro conteúdo: ou o registro é recusado, ou é gravado o conteúdo
 * conferido, em qualquer ponto em que a troca aconteça.
 */
import { describe, expect, it } from 'vitest';
import {
  anexar,
  anexarNaTransacao,
  ConflitoDeCadeia,
  criarRegistro,
  ErroDeCadeia,
  hashDoRegistro,
  serializarCanonico,
  verificarCadeia,
  verificarReferencias,
  type ArmazemLedger,
  type RegistroLedger,
  type TransacaoLedger,
} from '../../src/ledger';
import { cadeiaBase, T } from './apoioEsquema2';

const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;

/**
 * Armazém em memória que COPIA ao gravar (`structuredClone`, como o IndexedDB) ou que guarda a
 * REFERÊNCIA do objeto recebido (como o armazém dos testes).
 */
class Armazem implements ArmazemLedger {
  dados = new Map<string, RegistroLedger>();
  gravados: RegistroLedger[] = [];
  transacoesConfirmadas = 0;
  constructor(
    registros: RegistroLedger[],
    private readonly modo: 'clona' | 'referencia',
  ) {
    for (const r of registros) this.dados.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
  }
  async ler(cadeia: string, seq: number) {
    await Promise.resolve();
    return this.dados.get(chave(cadeia, seq)) ?? null;
  }
  async transacao<R>(corpo: (tx: TransacaoLedger) => R): Promise<R> {
    await Promise.resolve();
    const rascunho = new Map(this.dados);
    const gravadosNaTx: RegistroLedger[] = [];
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
        const guardado = this.modo === 'clona' ? structuredClone(r) : r;
        rascunho.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), guardado);
        gravadosNaTx.push(r); // o objeto que a Fase B entregou ao armazém
      },
    };
    const resultado = corpo(tx);
    this.dados = rascunho;
    this.gravados.push(...gravadosNaTx);
    this.transacoesConfirmadas++;
    return resultado;
  }
  lista(cadeia = 'A'): RegistroLedger[] {
    return [...this.dados.values()]
      .filter((r) => r.cabecalho.cadeia === cadeia)
      .sort((a, b) => a.cabecalho.seq - b.cabecalho.seq);
  }
}

/** o resultado válido do seq 4, logo depois do seq 3 da cadeia base */
const resultado4 = async (base: RegistroLedger[]) =>
  criarRegistro(
    {
      tipo: 'resultado',
      cadeia: 'A',
      criadoEm: T(4),
      corpo: { decisao: null, resultado: { casa: 2, fora: 1, registradoEm: T(4) } },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    base[2],
  );

/** um corpo de outro tipo: inválido num resultado */
const CORPO_INVALIDO = { motivo: null };

/**
 * O registro `valido` com o `corpo` trocado por um GETTER que devolve o corpo válido nas `trocaApos`
 * primeiras leituras e o inválido daí em diante.
 */
function comGetterNoCorpo(valido: RegistroLedger, trocaApos: number) {
  let leituras = 0;
  const r = { cabecalho: valido.cabecalho, hash: valido.hash } as RegistroLedger;
  Object.defineProperty(r, 'corpo', {
    enumerable: true,
    get: () => (++leituras > trocaApos ? CORPO_INVALIDO : valido.corpo),
  });
  return { r, leituras: () => leituras };
}

/** o registro `valido` com um GETTER ANINHADO em `corpo.resultado.casa` (2 nas primeiras leituras, 99 depois) */
function comGetterAninhado(valido: RegistroLedger, trocaApos: number) {
  let leituras = 0;
  const original = (valido.corpo as unknown as { resultado: Record<string, unknown> }).resultado;
  const resultado: Record<string, unknown> = { ...original };
  Object.defineProperty(resultado, 'casa', {
    enumerable: true,
    get: () => (++leituras > trocaApos ? 99 : original.casa),
  });
  const r = {
    cabecalho: valido.cabecalho,
    hash: valido.hash,
    corpo: { decisao: null, resultado },
  } as unknown as RegistroLedger;
  return { r, leituras: () => leituras };
}

/**
 * Para CADA ponto em que o getter troca de valor: ou o registro é recusado (nada gravado), ou o que foi
 * gravado é exatamente o registro válido conferido, e a cadeia é íntegra. Nunca o conteúdo trocado.
 */
async function nuncaGravaOutroConteudo(
  montar: (valido: RegistroLedger, trocaApos: number) => { r: RegistroLedger },
  modo: 'clona' | 'referencia',
) {
  const base = await cadeiaBase();
  const valido = await resultado4(base);
  const esperado = serializarCanonico(valido);
  let aceitos = 0;
  let recusados = 0;
  for (let trocaApos = 0; trocaApos <= 15; trocaApos++) {
    const armazem = new Armazem(base, modo);
    const { r } = montar(valido, trocaApos);
    const erro = await anexar(armazem, r).catch((e: unknown) => e);
    if (erro === undefined) {
      aceitos++;
      const gravado = armazem.dados.get('A#4')!;
      expect(serializarCanonico(gravado), `troca após ${trocaApos}`).toBe(esperado);
      expect(await hashDoRegistro(gravado.cabecalho, gravado.corpo)).toBe(valido.hash);
      expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
    } else {
      recusados++;
      expect(erro, `troca após ${trocaApos}`).toBeInstanceOf(ErroDeCadeia);
      expect(armazem.dados.has('A#4')).toBe(false);
      expect(armazem.transacoesConfirmadas).toBe(0);
    }
  }
  // os dois desfechos aparecem: trocar cedo é recusado; trocar tarde grava o conteúdo conferido
  expect(recusados).toBeGreaterThan(0);
  expect(aceitos).toBeGreaterThan(0);
}

describe('getter que muda o conteúdo: nunca é gravado outro conteúdo', () => {
  it('o cenário da auditoria: o corpo muda na ÚLTIMA leitura (armazém que clona)', async () => {
    const base = await cadeiaBase();
    const valido = await resultado4(base);
    // quantas vezes `corpo` é lido numa gravação completa, com o getter sempre válido
    const medida = comGetterNoCorpo(valido, Number.POSITIVE_INFINITY);
    await anexar(new Armazem(base, 'clona'), medida.r);
    const total = medida.leituras();
    // agora o corpo vira inválido só na última dessas leituras
    const armazem = new Armazem(base, 'clona');
    const { r } = comGetterNoCorpo(valido, total - 1);
    const erro = await anexar(armazem, r).catch((e: unknown) => e);
    const gravado = armazem.dados.get('A#4');
    if (erro === undefined) expect(serializarCanonico(gravado)).toBe(serializarCanonico(valido));
    else expect(gravado).toBeUndefined();
    // em nenhum caso o armazém guarda o corpo inválido
    expect(JSON.stringify(gravado?.corpo ?? null)).not.toContain('"motivo"');
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });

  it('getter no corpo, em cada ponto de troca: armazém que CLONA (structuredClone)', async () => {
    await nuncaGravaOutroConteudo(comGetterNoCorpo, 'clona');
  });

  it('getter no corpo, em cada ponto de troca: armazém que guarda a REFERÊNCIA', async () => {
    await nuncaGravaOutroConteudo(comGetterNoCorpo, 'referencia');
  });

  it('getter ANINHADO (corpo.resultado.casa), em cada ponto de troca, nos dois armazéns', async () => {
    await nuncaGravaOutroConteudo(comGetterAninhado, 'clona');
    await nuncaGravaOutroConteudo(comGetterAninhado, 'referencia');
  });

  it('o objeto do chamador é lido UMA vez na Fase A (a cópia) e uma no vínculo da Fase B', async () => {
    const base = await cadeiaBase();
    const valido = await resultado4(base);
    const m = comGetterNoCorpo(valido, Number.POSITIVE_INFINITY);
    await anexar(new Armazem(base, 'clona'), m.r);
    expect(m.leituras()).toBe(2);
  });

  it('Proxy que troca o corpo depois da primeira leitura: recusado no vínculo, nada gravado', async () => {
    const base = await cadeiaBase();
    const valido = await resultado4(base);
    let leituras = 0;
    const proxy = new Proxy(valido, {
      get: (alvo, p, rec) =>
        p === 'corpo' && ++leituras > 1 ? CORPO_INVALIDO : Reflect.get(alvo, p, rec),
    });
    const armazem = new Armazem(base, 'clona');
    await expect(anexar(armazem, proxy)).rejects.toThrow(/outro registro ou de outro conteúdo/);
    expect(armazem.dados.has('A#4')).toBe(false);
  });
});

describe('o objeto do chamador alterado depois da Fase A', () => {
  it('entre a Fase A e a Fase B: recusado (o vínculo é pela representação canônica), nada gravado', async () => {
    const base = await cadeiaBase();
    const novo = await resultado4(base);
    const armazem = new Armazem(base, 'referencia');
    const autorizacao = await verificarReferencias(armazem, novo);
    (novo.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
    const erro = await armazem
      .transacao((tx) => anexarNaTransacao(tx, novo, autorizacao))
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/outro registro ou de outro conteúdo/);
    expect(armazem.dados.has('A#4')).toBe(false);
  });

  it('depois da gravação, num armazém que guarda a REFERÊNCIA: o gravado não muda', async () => {
    const base = await cadeiaBase();
    const novo = await resultado4(base);
    const validado = serializarCanonico(novo);
    const armazem = new Armazem(base, 'referencia');
    await anexar(armazem, novo);
    (novo.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
    novo.cabecalho.versaoMotor = 'outra';
    const gravado = armazem.dados.get('A#4')!;
    expect(gravado).not.toBe(novo); // o armazém recebeu a cópia, não o objeto do chamador
    expect(serializarCanonico(gravado)).toBe(validado);
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });
});

describe('a cópia autorizada é imutável e é o que chega ao armazém', () => {
  it('o objeto entregue a tx.adicionar é a cópia: congelada em profundidade e independente', async () => {
    const base = await cadeiaBase();
    const novo = await resultado4(base);
    const armazem = new Armazem(base, 'referencia');
    await anexar(armazem, novo);
    const [entregue] = armazem.gravados;
    expect(entregue).not.toBe(novo);
    expect(entregue.corpo).not.toBe(novo.corpo);
    const naoCongelados: string[] = [];
    const visitar = (x: unknown, cam: string) => {
      if (typeof x !== 'object' || x === null) return;
      if (!Object.isFrozen(x)) naoCongelados.push(cam);
      for (const [k, v] of Object.entries(x)) visitar(v, `${cam}.${k}`);
    };
    visitar(entregue, 'registro');
    expect(naoCongelados).toEqual([]);
    expect(() => {
      (entregue.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
    }).toThrow(TypeError);
    expect(() => {
      (entregue.cabecalho as unknown as { seq: number }).seq = 99;
    }).toThrow(TypeError);
    // dados puros: nenhum getter/setter em lugar nenhum
    const comAcessor: string[] = [];
    const procurar = (x: unknown, cam: string) => {
      if (typeof x !== 'object' || x === null) return;
      for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(x))) {
        if (d.get || d.set) comAcessor.push(`${cam}.${k}`);
        procurar(d.value, `${cam}.${k}`);
      }
    };
    procurar(entregue, 'registro');
    expect(comAcessor).toEqual([]);
  });

  it('a cópia gravada é a mesma ligada à autorização: mesma representação canônica e mesmo hash', async () => {
    for (const modo of ['clona', 'referencia'] as const) {
      const base = await cadeiaBase();
      const novo = await resultado4(base);
      const armazem = new Armazem(base, modo);
      const autorizacao = await verificarReferencias(armazem, novo);
      await armazem.transacao((tx) => anexarNaTransacao(tx, novo, autorizacao));
      const gravado = armazem.dados.get('A#4')!;
      expect(serializarCanonico(gravado), modo).toBe(autorizacao.registroCanonico);
      expect(serializarCanonico(armazem.gravados[0]), modo).toBe(autorizacao.registroCanonico);
      expect(gravado.hash).toBe(autorizacao.registro);
      expect(await hashDoRegistro(gravado.cabecalho, gravado.corpo)).toBe(gravado.hash);
    }
  });

  it('registro honesto: a cópia é igual ao original (nada muda para quem não tem getters)', async () => {
    const base = await cadeiaBase();
    const novo = await resultado4(base);
    const armazem = new Armazem(base, 'clona');
    await anexar(armazem, novo);
    expect(armazem.dados.get('A#4')).toEqual(novo);
    expect(serializarCanonico(armazem.dados.get('A#4'))).toBe(serializarCanonico(novo));
  });
});

describe('verificarCadeia depois de várias gravações (cópias)', () => {
  it('uma cadeia gravada inteira pela porta é íntegra, e cada registro gravado tem o hash do conteúdo', async () => {
    const base = await cadeiaBase();
    for (const modo of ['clona', 'referencia'] as const) {
      const armazem = new Armazem([], modo);
      for (const r of base) await anexar(armazem, r);
      let ultimo = base[2];
      for (let i = 4; i <= 8; i++) {
        const r = await criarRegistro(
          {
            tipo: 'resultado',
            cadeia: 'A',
            criadoEm: T(i),
            corpo: { decisao: null, resultado: { casa: i, fora: 0, registradoEm: T(i) } },
            versaoMotor: 'teste',
            politicas: { x: 1 },
          },
          ultimo,
        );
        await anexar(armazem, r);
        ultimo = r;
      }
      const lista = armazem.lista();
      expect(lista).toHaveLength(8);
      expect((await verificarCadeia(lista)).estado, modo).toBe('integra');
      for (const g of lista) expect(await hashDoRegistro(g.cabecalho, g.corpo)).toBe(g.hash);
    }
  });

  it('a autorização gravada uma vez não grava de novo (conflito), nem com a cópia', async () => {
    const base = await cadeiaBase();
    const novo = await resultado4(base);
    const armazem = new Armazem(base, 'clona');
    const autorizacao = await verificarReferencias(armazem, novo);
    await armazem.transacao((tx) => anexarNaTransacao(tx, novo, autorizacao));
    await expect(
      armazem.transacao((tx) => anexarNaTransacao(tx, novo, autorizacao)),
    ).rejects.toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.lista()).toHaveLength(4);
  });
});
