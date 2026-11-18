/**
 * A AUTORIZAÇÃO da Fase A (`ReferenciasVerificadas`) não pode ser forjada em tempo de execução.
 *  - só `verificarReferencias` a emite, e ela fica registrada num `WeakSet` privado do módulo: a Fase B
 *    recusa qualquer outro objeto, ainda que tenha os mesmos campos (cópia, JSON, reconstrução);
 *  - é congelada em profundidade: não pode ser alterada depois de emitida;
 *  - vale só para o registro de exatamente aquele hash e aquela representação canônica;
 *  - só é emitida depois de o PRÓPRIO registro novo ser conferido (`conferirRegistro`).
 * As referências, o registro anterior e a comparação canônica da ponta continuam valendo.
 */
import { describe, expect, it } from 'vitest';
import {
  anexar,
  anexarNaTransacao,
  ConflitoDeCadeia,
  criarRegistro,
  ErroDeCadeia,
  hashDoRegistro,
  verificarCadeia,
  verificarReferencias,
  type RegistroLedger,
  type ReferenciasVerificadas,
  type TransacaoLedger,
} from '../../src/ledger';
import { cadeiaBase, clonar, fechamentoApos, T } from './apoioEsquema2';
import { ArmazemDeTeste } from './apoioGravacao';

const NAO_EMITIDA = /não foram verificadas \(Fase A\): a autorização não foi emitida/;
const OUTRO_REGISTRO = /não foram verificadas \(Fase A\): a autorização é de outro registro/;

/** um resultado (sem referências) logo depois de `anterior` */
const resultadoApos = (anterior: RegistroLedger | null, casa = 1) =>
  criarRegistro(
    {
      tipo: 'resultado',
      cadeia: anterior?.cabecalho.cadeia ?? 'A',
      criadoEm: T((anterior?.cabecalho.seq ?? 0) + 1),
      corpo: { decisao: null, resultado: { casa, fora: 0, registradoEm: T(1) } },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    anterior,
  );

/** uma correção do registro `alvo`, logo depois de `ultimo` */
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

/** cenário: cadeia base (3 registros), um seq 4 e a autorização LEGÍTIMA dele */
async function cenario() {
  const base = await cadeiaBase();
  const armazem = new ArmazemDeTeste(base);
  const novo = await correcaoDe(base[2], base[1]); // corrige o seq 2: tem referência e anterior
  const autorizacao = await verificarReferencias(armazem, novo);
  return { base, armazem, novo, autorizacao };
}

/** grava dentro de uma transação do armazém com a autorização dada; devolve o erro (ou undefined) */
const gravarCom = (armazem: ArmazemDeTeste, novo: RegistroLedger, autorizacao: unknown) =>
  armazem
    .transacao((tx) => anexarNaTransacao(tx, novo, autorizacao as ReferenciasVerificadas))
    .then(
      () => undefined,
      (e: unknown) => e,
    );

/** recusada sem gravar: ErroDeCadeia, nada confirmado, armazém intacto */
async function recusada(r: {
  armazem: ArmazemDeTeste;
  novo: RegistroLedger;
  autorizacao: unknown;
  padrao: RegExp;
}) {
  const antes = r.armazem.foto();
  const erro = await gravarCom(r.armazem, r.novo, r.autorizacao);
  expect(erro).toBeInstanceOf(ErroDeCadeia);
  expect(erro).not.toBeInstanceOf(ConflitoDeCadeia);
  expect((erro as Error).message).toMatch(r.padrao);
  expect(r.armazem.transacoesConfirmadas).toBe(0);
  expect(r.armazem.foto()).toBe(antes);
}

describe('objeto FORJADO, copiado ou reconstruído: recusado (não foi emitido pela Fase A)', () => {
  it('objeto montado à mão com campos IDÊNTICOS ao legítimo', async () => {
    const { armazem, novo, autorizacao } = await cenario();
    const forjado = {
      registro: autorizacao.registro,
      registroCanonico: autorizacao.registroCanonico,
      itens: autorizacao.itens.map((i) => ({ ...i })),
      anterior: autorizacao.anterior && { ...autorizacao.anterior },
    };
    expect(JSON.stringify(forjado)).toBe(JSON.stringify(autorizacao)); // campos idênticos
    await recusada({ armazem, novo, autorizacao: forjado, padrao: NAO_EMITIDA });
  });

  it('cópias da autorização legítima: espalhamento, JSON, structuredClone, Object.assign', async () => {
    const { armazem, novo, autorizacao } = await cenario();
    for (const copia of [
      { ...autorizacao },
      JSON.parse(JSON.stringify(autorizacao)) as unknown,
      structuredClone(autorizacao),
      Object.assign({}, autorizacao),
      Object.create(autorizacao) as unknown, // herda os campos, mas não é o objeto emitido
    ])
      await recusada({ armazem, novo, autorizacao: copia, padrao: NAO_EMITIDA });
  });

  it('valores que nem são objeto (undefined, null, texto, número): recusados sem TypeError', async () => {
    const { armazem, novo } = await cenario();
    for (const v of [undefined, null, 'autorizada', 42, true, []])
      await recusada({ armazem, novo, autorizacao: v, padrao: NAO_EMITIDA });
  });

  it('a recusa acontece antes de tocar na transação (nem a ponta é lida)', async () => {
    const { base, novo, autorizacao } = await cenario();
    const chamadas: string[] = [];
    const tx: TransacaoLedger = {
      ponta: () => (chamadas.push('ponta'), base[2]),
      ler: (_c, s) => (chamadas.push(`ler:${s}`), base[s - 1] ?? null),
      adicionar: () => void chamadas.push('adicionar'),
    };
    expect(() => anexarNaTransacao(tx, novo, { ...autorizacao } as never)).toThrow(NAO_EMITIDA);
    expect(chamadas).toEqual([]);
  });
});

describe('autorização ALTERADA depois de emitida: impossível (congelada em profundidade)', () => {
  it('o objeto e tudo o que ele contém estão congelados', async () => {
    const { autorizacao } = await cenario();
    expect(Object.isFrozen(autorizacao)).toBe(true);
    expect(Object.isFrozen(autorizacao.itens)).toBe(true);
    for (const i of autorizacao.itens) expect(Object.isFrozen(i)).toBe(true);
    expect(Object.isFrozen(autorizacao.anterior)).toBe(true);
  });

  it('tentar redirecioná-la para OUTRO registro lança TypeError e ela continua valendo só para o seu', async () => {
    const { base, armazem, novo, autorizacao } = await cenario();
    // um registro INVÁLIDO para o mesmo seq (corpo incompatível, hash refeito)
    const invalido = clonar(novo);
    invalido.corpo = { motivo: null } as never;
    invalido.hash = await hashDoRegistro(invalido.cabecalho, invalido.corpo);
    const a = autorizacao as unknown as Record<string, unknown>;
    expect(() => (a.registro = invalido.hash)).toThrow(TypeError);
    expect(() => (a.registroCanonico = JSON.stringify(invalido))).toThrow(TypeError);
    expect(() => Object.defineProperty(a, 'registro', { value: invalido.hash })).toThrow(TypeError);
    expect(() =>
      (autorizacao.itens as unknown as Record<string, unknown>[]).push({ campo: 'x' }),
    ).toThrow(TypeError);
    expect(() => ((autorizacao.anterior as unknown as { seq: number }).seq = 99)).toThrow(
      TypeError,
    );
    expect(autorizacao.registro).toBe(novo.hash);
    // não serve para o inválido...
    await recusada({ armazem, novo: invalido, autorizacao, padrao: OUTRO_REGISTRO });
    // ...e continua servindo para o registro legítimo
    expect(await gravarCom(armazem, novo, autorizacao)).toBeUndefined();
    expect(armazem.dados.size).toBe(base.length + 1);
  });
});

describe('autorização LEGÍTIMA reutilizada com outro registro: recusada (vínculo pelo conteúdo)', () => {
  it('a autorização de um registro não serve para outro (outro hash)', async () => {
    const { base, armazem, autorizacao } = await cenario();
    const outro = await correcaoDe(base[2], base[0]); // outra correção, também seq 4 e válida
    await recusada({ armazem, novo: outro, autorizacao, padrao: OUTRO_REGISTRO });
  });

  it('nem para o MESMO registro com o conteúdo trocado e o campo hash mantido', async () => {
    const { armazem, novo, autorizacao } = await cenario();
    const trocado = clonar(novo);
    (trocado.corpo as unknown as { motivo: string }).motivo = 'outro motivo';
    expect(trocado.hash).toBe(novo.hash); // o campo hash é o mesmo: só o conteúdo denuncia
    await recusada({ armazem, novo: trocado, autorizacao, padrao: OUTRO_REGISTRO });
  });

  it('uma cópia idêntica do registro (outro objeto, mesmo conteúdo) é o mesmo registro: aceita', async () => {
    const { armazem, novo, autorizacao } = await cenario();
    expect(await gravarCom(armazem, clonar(novo), autorizacao)).toBeUndefined();
    expect(armazem.transacoesConfirmadas).toBe(1);
  });

  it('usada uma vez, a mesma autorização não grava de novo (a ponta avançou: conflito)', async () => {
    const { armazem, novo, autorizacao } = await cenario();
    expect(await gravarCom(armazem, novo, autorizacao)).toBeUndefined();
    expect(await gravarCom(armazem, novo, autorizacao)).toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.transacoesConfirmadas).toBe(1);
  });
});

describe('o PRÓPRIO registro novo é conferido antes de emitir a autorização', () => {
  it('hash declarado que não confere com o conteúdo: nenhuma autorização, nada lido nem gravado', async () => {
    const base = await cadeiaBase();
    const armazem = new ArmazemDeTeste(base);
    const novo = await resultadoApos(base[2]);
    const errado = clonar(novo);
    (errado.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 77; // hash antigo
    await expect(verificarReferencias(armazem, errado)).rejects.toThrow(/hash declarado/);
    await expect(anexar(armazem, errado)).rejects.toThrow(/hash declarado/);
    expect(armazem.leituras).toBe(0);
    expect(armazem.transacoesAbertas).toBe(0);
  });

  it('semanticamente inválido (corpo incompatível, data inválida), hash refeito: nenhuma autorização', async () => {
    const base = await cadeiaBase();
    const novo = await resultadoApos(base[2]);
    const invalidos: [RegExp, (c: RegistroLedger) => void][] = [
      [/corpo incompatível/, (c) => (c.corpo = { motivo: null } as never)],
      [/criadoEm/, (c) => (c.cabecalho.criadoEm = '2026-13-45T99:00:00Z')],
    ];
    for (const [padrao, alterar] of invalidos) {
      const armazem = new ArmazemDeTeste(base);
      const r = clonar(novo);
      alterar(r);
      r.hash = await hashDoRegistro(r.cabecalho, r.corpo);
      await expect(verificarReferencias(armazem, r)).rejects.toThrow(padrao);
      await expect(anexar(armazem, r)).rejects.toThrow(padrao);
      expect(armazem.leituras).toBe(0);
      expect(armazem.transacoesAbertas).toBe(0);
    }
  });

  it('o registro de um tipo somente leitura (fechamento) também não recebe autorização', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    await expect(verificarReferencias(new ArmazemDeTeste(base), f)).rejects.toThrow(
      /somente leitura/,
    );
  });
});

describe('autorização legítima, mas o armazém muda ENTRE as fases: conflito, nada gravado', () => {
  it('a referência (seq 2) muda de conteúdo entre as fases', async () => {
    const { base, armazem, novo, autorizacao } = await cenario();
    const trocado = clonar(base[1]);
    (trocado.corpo as unknown as { aposta: { odd: number } }).aposta.odd = 3;
    armazem.dados.set('A#2', trocado);
    const erro = await gravarCom(armazem, novo, autorizacao);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/registro 2 apontado mudou/);
    expect(armazem.transacoesConfirmadas).toBe(0);
  });

  it('a ponta (seq 3) muda de conteúdo entre as fases', async () => {
    const { base, armazem, novo, autorizacao } = await cenario();
    const trocada = clonar(base[2]);
    (trocada.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 9;
    armazem.dados.set('A#3', trocada);
    const erro = await gravarCom(armazem, novo, autorizacao);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/a ponta \(seq 3\) mudou/);
    expect(armazem.transacoesConfirmadas).toBe(0);
  });

  it('outro escritor grava o seq 4 entre as fases (via anexar, com o gancho da transação)', async () => {
    const base = await cadeiaBase();
    const armazem = new ArmazemDeTeste(base);
    const meu = await correcaoDe(base[2], base[1]);
    const dele = await resultadoApos(base[2], 5);
    armazem.aoAbrirTransacao = () => {
      armazem.aoAbrirTransacao = undefined;
      armazem.dados.set('A#4', dele);
    };
    await expect(anexar(armazem, meu)).rejects.toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.transacoesConfirmadas).toBe(0);
    expect(armazem.dados.get('A#4')).toBe(dele);
  });
});

describe('controles legítimos', () => {
  it('gênese: autorização sem anterior, gravada e íntegra', async () => {
    const armazem = new ArmazemDeTeste();
    const g = await resultadoApos(null);
    const autorizacao = await verificarReferencias(armazem, g);
    expect(autorizacao.anterior).toBeNull();
    expect(autorizacao.itens).toEqual([]);
    expect(await gravarCom(armazem, g, autorizacao)).toBeUndefined();
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });

  it('registro com referência e anterior: gravado e íntegro', async () => {
    const { armazem, novo, autorizacao } = await cenario();
    expect(autorizacao.itens).toHaveLength(1);
    expect(autorizacao.anterior?.seq).toBe(3);
    expect(await gravarCom(armazem, novo, autorizacao)).toBeUndefined();
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });

  it('FECHAMENTO válido como registro anterior: a gravação seguinte é autorizada e gravada', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const armazem = new ArmazemDeTeste([...base, f]); // semeado: o fechamento não é escrito pelo Ledger
    const novo = await resultadoApos(f);
    await anexar(armazem, novo);
    expect(armazem.transacoesConfirmadas).toBe(1);
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });

  it('anexar continua sendo a porta completa: Fase A + Fase B numa chamada', async () => {
    const base = await cadeiaBase();
    const armazem = new ArmazemDeTeste(base);
    await anexar(armazem, await correcaoDe(base[2], base[1]));
    expect(armazem.transacoesConfirmadas).toBe(1);
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });
});
