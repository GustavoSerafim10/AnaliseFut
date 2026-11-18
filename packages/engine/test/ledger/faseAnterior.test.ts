/**
 * O REGISTRO ANTERIOR (`seq − 1`), ao qual o novo se encadeia por `prevHash`, é verificado como uma
 * referência:
 *  - Fase A (fora da transação): forma, identidade (cadeia e seq), esquema suportado, hash
 *    RECALCULADO e validade semântica; guarda a representação canônica;
 *  - Fase B (dentro da transação): a ponta relida tem de ter exatamente essa representação canônica.
 * Anterior adulterado, inválido ou de esquema não suportado: `ErroDeCadeia`. Ponta trocada entre as
 * fases, anterior ausente ou de outra versão: `ConflitoDeCadeia`. A gênese não tem anterior.
 *
 * Cenários A–D: os mesmos da sonda da análise, em que a gravação ERA aceita sobre a ponta inválida.
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
  type ArmazemLedger,
  type RegistroLedger,
  type TransacaoLedger,
} from '../../src/ledger';
import { cadeiaBase, clonar, fechamentoApos, T } from './apoioEsquema2';

const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;

/** Armazém em memória: leituras contadas, transação tudo-ou-nada e gancho entre as fases. */
class Armazem implements ArmazemLedger {
  dados = new Map<string, unknown>();
  leituras: number[] = [];
  transacoesAbertas = 0;
  transacoesConfirmadas = 0;
  gravacoes = 0;
  /** roda ao abrir a transação: DEPOIS da Fase A, antes da Fase B */
  aoAbrirTransacao?: () => void;
  constructor(registros: RegistroLedger[] = []) {
    for (const r of registros) this.dados.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
  }
  async ler(cadeia: string, seq: number) {
    await Promise.resolve();
    this.leituras.push(seq);
    return (this.dados.get(chave(cadeia, seq)) ?? null) as RegistroLedger | null;
  }
  async transacao<R>(corpo: (tx: TransacaoLedger) => R): Promise<R> {
    await Promise.resolve();
    this.transacoesAbertas++;
    this.aoAbrirTransacao?.();
    const rascunho = new Map(this.dados);
    const tx: TransacaoLedger = {
      ponta: (cadeia) => {
        let melhor: RegistroLedger | null = null;
        for (const v of rascunho.values()) {
          const r = v as RegistroLedger;
          if (
            r?.cabecalho?.cadeia === cadeia &&
            (!melhor || r.cabecalho.seq > melhor.cabecalho.seq)
          )
            melhor = r;
        }
        return melhor;
      },
      ler: (cadeia, seq) => (rascunho.get(chave(cadeia, seq)) ?? null) as RegistroLedger | null,
      adicionar: (r) => {
        const k = chave(r.cabecalho.cadeia, r.cabecalho.seq);
        if (rascunho.has(k)) throw new Error(`ConstraintError: chave ${k} repetida`);
        rascunho.set(k, r);
        this.gravacoes++;
      },
    };
    const resultado = corpo(tx); // se lançar, o rascunho é descartado: nada é confirmado
    this.dados = rascunho;
    this.transacoesConfirmadas++;
    return resultado;
  }
  foto(): string {
    return JSON.stringify([...this.dados.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}

/** um resultado (sem referências) gravado logo depois de `anterior` */
const resultadoApos = (anterior: RegistroLedger | null, n = (anterior?.cabecalho.seq ?? 0) + 1) =>
  criarRegistro(
    {
      tipo: 'resultado',
      cadeia: anterior?.cabecalho.cadeia ?? 'A',
      criadoEm: T(n),
      corpo: { decisao: null, resultado: { casa: n, fora: 0, registradoEm: T(n) } },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    anterior,
  );

/** refaz o hash de uma cópia alterada do registro (o hash confere com o conteúdo novo) */
async function comHashRefeito(r: RegistroLedger, alterar: (c: RegistroLedger) => void) {
  const c = clonar(r);
  alterar(c);
  c.hash = await hashDoRegistro(c.cabecalho, c.corpo);
  return c;
}

/**
 * Grava o seq 4 sobre uma ponta (seq 3) forjada por `forjar`, montando o registro novo sobre a ponta
 * FORJADA, como faria um produtor que lê a ponta gravada. Devolve o erro e o estado do armazém.
 */
async function gravarSobrePonta(forjar: (ponta: RegistroLedger) => Promise<RegistroLedger>) {
  const base = await cadeiaBase();
  const ponta = await forjar(base[2]);
  const armazem = new Armazem([base[0], base[1], ponta]);
  const antes = armazem.foto();
  const novo = await resultadoApos(ponta);
  const erro = await anexar(armazem, novo).catch((e: unknown) => e);
  return { armazem, erro, antes, ponta };
}

/** recusada na FASE A: nenhuma transação aberta, armazém intacto */
function recusadaNaFaseA(r: Awaited<ReturnType<typeof gravarSobrePonta>>, padrao: RegExp) {
  expect(r.erro).toBeInstanceOf(ErroDeCadeia);
  expect(r.erro).not.toBeInstanceOf(ConflitoDeCadeia);
  expect(r.erro).not.toBeInstanceOf(TypeError);
  expect((r.erro as Error).message).toMatch(/registro anterior \(seq 3\)/);
  expect((r.erro as Error).message).toMatch(padrao);
  expect(r.armazem.transacoesAbertas).toBe(0);
  expect(r.armazem.gravacoes).toBe(0);
  expect(r.armazem.foto()).toBe(r.antes);
}

describe('cenários A–D: ponta inválida não recebe gravação (ErroDeCadeia na Fase A)', () => {
  it('A. conteúdo alterado com o campo hash antigo (hash diverge do conteúdo)', async () => {
    const r = await gravarSobrePonta(async (p) => {
      const x = clonar(p);
      (x.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
      return x;
    });
    recusadaNaFaseA(r, /foi alterado \(o hash recalculado do conteúdo não é o gravado\)/);
  });

  it('B. corpo incompatível com o tipo, hash refeito (consistente)', async () => {
    const r = await gravarSobrePonta((p) =>
      comHashRefeito(p, (x) => (x.corpo = { motivo: null } as never)),
    );
    recusadaNaFaseA(r, /é inválido \(corpo incompatível com o tipo "resultado"/);
  });

  it('C. data de criação inválida, hash refeito', async () => {
    const r = await gravarSobrePonta((p) =>
      comHashRefeito(p, (x) => (x.cabecalho.criadoEm = '2026-13-45T99:00:00Z')),
    );
    recusadaNaFaseA(r, /é inválido \(criadoEm não é uma data ISO/);
  });

  it('D. esquema não suportado (99), hash refeito', async () => {
    const r = await gravarSobrePonta((p) => comHashRefeito(p, (x) => (x.cabecalho.esquema = 99)));
    recusadaNaFaseA(r, /é de um esquema não suportado/);
  });

  it('tipo fora do esquema (resultado com esquema 2), hash refeito: inválido na forma', async () => {
    const r = await gravarSobrePonta((p) => comHashRefeito(p, (x) => (x.cabecalho.esquema = 2)));
    recusadaNaFaseA(r, /é inválido \(registro malformado: tipo desconhecido\)/);
  });

  it('a verificação da cadeia continua acusando a ponta nos quatro casos (nada foi escondido)', async () => {
    for (const forjar of [
      async (p: RegistroLedger) => {
        const x = clonar(p);
        (x.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
        return x;
      },
      (p: RegistroLedger) => comHashRefeito(p, (x) => (x.corpo = { motivo: null } as never)),
      (p: RegistroLedger) => comHashRefeito(p, (x) => (x.cabecalho.criadoEm = 'x')),
      (p: RegistroLedger) => comHashRefeito(p, (x) => (x.cabecalho.esquema = 99)),
    ]) {
      const r = await gravarSobrePonta(forjar);
      const lista = [...r.armazem.dados.values()] as RegistroLedger[];
      expect(lista).toHaveLength(3); // o seq 4 não foi gravado
      expect((await verificarCadeia(lista)).estado).not.toBe('integra');
    }
  });
});

describe('registro anterior: forma e identidade (Fase A)', () => {
  it('lixo no lugar do anterior: ErroDeCadeia "registro malformado", sem TypeError', async () => {
    for (const lixo of [{}, { corpo: {} }, 'texto', 42, [], true]) {
      const base = await cadeiaBase();
      const armazem = new Armazem(base);
      armazem.dados.set(chave('A', 3), lixo);
      const erro = await anexar(armazem, await resultadoApos(base[2])).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroDeCadeia);
      expect(erro).not.toBeInstanceOf(TypeError);
      expect((erro as Error).message).toMatch(
        /registro anterior \(seq 3\) é inválido \(registro malformado/,
      );
      expect(armazem.transacoesAbertas).toBe(0);
    }
  });

  it('o armazém devolve, para (A, 3), um registro de outra posição: ErroDeCadeia', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    armazem.dados.set(chave('A', 3), base[1]); // na posição 3, o registro 2
    const erro = await anexar(armazem, await resultadoApos(base[2])).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/não é o dessa cadeia e posição/);
  });

  it('o armazém devolve, para (A, 3), um registro de OUTRA cadeia: ErroDeCadeia', async () => {
    const base = await cadeiaBase();
    const outra = await cadeiaBase('B');
    const armazem = new Armazem(base);
    armazem.dados.set(chave('A', 3), outra[2]);
    const erro = await anexar(armazem, await resultadoApos(base[2])).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroDeCadeia);
    expect((erro as Error).message).toMatch(/não é o dessa cadeia e posição/);
  });

  it('anterior AUSENTE no armazém: ConflitoDeCadeia (montado sobre outra ponta: reler)', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem([base[0], base[1]]); // o seq 3 não está gravado
    const erro = await anexar(armazem, await resultadoApos(base[2])).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/registro anterior \(seq 3\) não está no armazém/);
    expect(armazem.transacoesAbertas).toBe(0);
  });

  it('anterior gravado é OUTRA versão (o novo foi montado sobre outra): ConflitoDeCadeia', async () => {
    const base = await cadeiaBase();
    const outraVersao = await comHashRefeito(base[2], (x) => {
      (x.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 7;
    });
    const armazem = new Armazem([base[0], base[1], outraVersao]);
    const erro = await anexar(armazem, await resultadoApos(base[2])).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(/prevHash não é o hash do registro anterior gravado/);
  });
});

describe('controles legítimos', () => {
  it('a gênese não tem anterior: nenhuma leitura, gravada e íntegra', async () => {
    const armazem = new Armazem();
    await anexar(armazem, await resultadoApos(null));
    expect(armazem.leituras).toEqual([]);
    expect(armazem.transacoesConfirmadas).toBe(1);
    expect((await verificarCadeia([...armazem.dados.values()] as RegistroLedger[])).estado).toBe(
      'integra',
    );
  });

  it('ponta legítima: lê o anterior (seq 3), grava e a cadeia fica íntegra', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    await anexar(armazem, await resultadoApos(base[2]));
    expect(armazem.leituras).toEqual([3]);
    expect(armazem.transacoesConfirmadas).toBe(1);
    const lista = [1, 2, 3, 4].map((s) => armazem.dados.get(chave('A', s)) as RegistroLedger);
    expect((await verificarCadeia(lista)).estado).toBe('integra');
  });

  it('referência e anterior: as referências são lidas primeiro, depois o anterior', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    const c = await criarRegistro(
      {
        tipo: 'correcao',
        cadeia: 'A',
        criadoEm: T(4),
        corpo: { motivo: 'placar digitado errado', novo: { casa: 2, fora: 1 } },
        corrige: { seq: 2, hash: base[1].hash },
        versaoMotor: 'teste',
        politicas: { x: 1 },
      },
      base[2],
    );
    await anexar(armazem, c);
    expect(armazem.leituras).toEqual([2, 3]);
  });

  it('o anterior é um FECHAMENTO válido (esquema 2): a gravação seguinte é aceita', async () => {
    const base = await cadeiaBase();
    const f = await fechamentoApos(base[2], base);
    const armazem = new Armazem([...base, f]); // semeado: o fechamento não é escrito pelo Ledger
    await anexar(armazem, await resultadoApos(f));
    expect(armazem.transacoesConfirmadas).toBe(1);
    const lista = [1, 2, 3, 4, 5].map((s) => armazem.dados.get(chave('A', s)) as RegistroLedger);
    expect((await verificarCadeia(lista)).estado).toBe('integra');
  });

  it('...e o fechamento continua NÃO podendo ser gravado', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    await expect(anexar(armazem, await fechamentoApos(base[2], base))).rejects.toThrow(
      /somente leitura/,
    );
    expect(armazem.transacoesAbertas).toBe(0);
  });
});

describe('concorrência e comparação canônica (Fase B)', () => {
  it('a ponta muda de conteúdo ENTRE as fases (mesmo campo hash): ConflitoDeCadeia, nada gravado', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    const novo = await resultadoApos(base[2]);
    let fotoAoAbrir = '';
    armazem.aoAbrirTransacao = () => {
      armazem.aoAbrirTransacao = undefined;
      const x = clonar(base[2]);
      (x.corpo as unknown as { resultado: { casa: number } }).resultado.casa = 99;
      armazem.dados.set(chave('A', 3), x);
      fotoAoAbrir = armazem.foto();
    };
    const erro = await anexar(armazem, novo).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect((erro as Error).message).toMatch(
      /a ponta \(seq 3\) mudou entre a verificação e a gravação/,
    );
    expect(armazem.transacoesConfirmadas).toBe(0);
    expect(armazem.foto()).toBe(fotoAoAbrir); // rollback: nada foi gravado
    // reverificar (como faz quem recebe um conflito) agora recusa de vez, na Fase A
    const depois = await anexar(armazem, novo).catch((e: unknown) => e);
    expect(depois).toBeInstanceOf(ErroDeCadeia);
    expect((depois as Error).message).toMatch(/registro anterior \(seq 3\) foi alterado/);
  });

  it('a ponta é trocada por uma cópia IDÊNTICA (outro objeto) entre as fases: aceita', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    armazem.aoAbrirTransacao = () => armazem.dados.set(chave('A', 3), clonar(base[2]));
    await anexar(armazem, await resultadoApos(base[2]));
    expect(armazem.transacoesConfirmadas).toBe(1);
    expect(armazem.gravacoes).toBe(1);
  });

  it('outro escritor grava o seq 4 entre as fases: ConflitoDeCadeia; reler e recriar resolve', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    const meu = await resultadoApos(base[2]);
    const dele = await criarRegistro(
      {
        tipo: 'exclusao',
        cadeia: 'A',
        criadoEm: T(4),
        corpo: { motivo: null },
        versaoMotor: 'teste',
        politicas: { x: 1 },
      },
      base[2],
    );
    armazem.aoAbrirTransacao = () => {
      armazem.aoAbrirTransacao = undefined;
      armazem.dados.set(chave('A', 4), dele);
    };
    const erro = await anexar(armazem, meu).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.transacoesConfirmadas).toBe(0);
    // releitura da ponta (o seq 4 dele) e nova tentativa
    await anexar(armazem, await resultadoApos(dele));
    const lista = [1, 2, 3, 4, 5].map((s) => armazem.dados.get(chave('A', s)) as RegistroLedger);
    expect((await verificarCadeia(lista)).estado).toBe('integra');
  });

  it('20 escritores concorrentes sobre a mesma cadeia: íntegra, sem lacuna, com disputa real', async () => {
    const base = await cadeiaBase();
    const armazem = new Armazem(base);
    let conflitos = 0;
    const escritor = async (): Promise<void> => {
      for (let i = 0; i < 500; i++) {
        let ponta: RegistroLedger | null = null;
        for (const v of armazem.dados.values()) {
          const r = v as RegistroLedger;
          if (!ponta || r.cabecalho.seq > ponta.cabecalho.seq) ponta = r;
        }
        try {
          await anexar(armazem, await resultadoApos(ponta));
          return;
        } catch (e) {
          if (!(e instanceof ConflitoDeCadeia)) throw e;
          conflitos++;
        }
      }
      throw new Error('escritor esgotou as tentativas');
    };
    await Promise.all(Array.from({ length: 20 }, escritor));
    const lista = Array.from(
      { length: 23 },
      (_, i) => armazem.dados.get(chave('A', i + 1)) as RegistroLedger,
    );
    expect(lista.every(Boolean)).toBe(true);
    expect((await verificarCadeia(lista)).estado).toBe('integra');
    expect(conflitos).toBeGreaterThan(0);
  });
});

describe('Fase B: a verificação do anterior tem de ser a deste registro', () => {
  /** transação controlada: ponta = seq 3 da base, `adicionar` contado */
  async function preparar() {
    const base = await cadeiaBase();
    const novo = await resultadoApos(base[2]);
    const verificadas = await verificarReferencias(new Armazem(base), novo);
    const chamadas = { adicionar: 0 };
    const tx: TransacaoLedger = {
      ponta: () => base[2],
      ler: () => null,
      adicionar: () => void chamadas.adicionar++,
    };
    return { base, novo, verificadas, tx, chamadas };
  }

  it('a verificação legítima: aceita', async () => {
    const { novo, verificadas, tx, chamadas } = await preparar();
    expect(() => anexarNaTransacao(tx, novo, verificadas)).not.toThrow();
    expect(chamadas.adicionar).toBe(1);
  });

  it('sem `anterior`, com anterior de outro seq ou de outro hash: "não foram verificadas"', async () => {
    const { novo, verificadas, tx, chamadas } = await preparar();
    const a = verificadas.anterior!;
    const forjadas = [
      { ...verificadas, anterior: undefined },
      { ...verificadas, anterior: null },
      { ...verificadas, anterior: { ...a, seq: 2 } },
      { ...verificadas, anterior: { ...a, hash: 'f'.repeat(64) } },
      { ...verificadas, anterior: { seq: a.seq, hash: a.hash } },
    ];
    for (const f of forjadas)
      expect(() => anexarNaTransacao(tx, novo, f as never)).toThrow(/não foram verificadas/);
    expect(chamadas.adicionar).toBe(0);
  });

  it('a representação canônica forjada numa CÓPIA da autorização: recusada como não emitida', async () => {
    const { novo, verificadas, tx, chamadas } = await preparar();
    const forjada = { ...verificadas, anterior: { ...verificadas.anterior!, canonico: '{}' } };
    // a cópia nem chega à comparação canônica: não foi emitida pela Fase A (ErroDeCadeia, não conflito)
    expect(() => anexarNaTransacao(tx, novo, forjada as never)).toThrow(ErroDeCadeia);
    expect(() => anexarNaTransacao(tx, novo, forjada as never)).toThrow(/não foi emitida/);
    expect(chamadas.adicionar).toBe(0);
  });

  it('gênese com um `anterior` que não é null: "não foram verificadas"', async () => {
    const g = await resultadoApos(null);
    const verificadas = await verificarReferencias(new Armazem(), g);
    expect(verificadas.anterior).toBeNull();
    const base = await cadeiaBase();
    const outra = await verificarReferencias(new Armazem(base), await resultadoApos(base[2]));
    const tx: TransacaoLedger = { ponta: () => null, ler: () => null, adicionar: () => undefined };
    expect(() =>
      anexarNaTransacao(tx, g, { ...verificadas, anterior: outra.anterior } as never),
    ).toThrow(/não foram verificadas/);
    expect(() => anexarNaTransacao(tx, g, verificadas)).not.toThrow();
  });
});
