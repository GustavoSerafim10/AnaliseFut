/**
 * CÓPIA CANÔNICA DOS REGISTROS LIDOS DO ARMAZÉM: o conteúdo validado na Fase A é exatamente aquele cuja
 * representação canônica é capturada e conferida na Fase B.
 *
 * Cada valor devolvido pelo armazém (`armazem.ler` na Fase A; `tx.ponta` e `tx.ler` na Fase B) é LIDO
 * UMA VEZ (`serializarCanonico`), virado em dados puros e congelado; forma, identidade, esquema, hash,
 * semântica e a captura canônica são feitos sobre essa cópia. Um getter ou Proxy que muda de valor não
 * consegue fazer a Fase A validar um conteúdo e capturar outro, nem fazer a Fase B comparar um
 * conteúdo diferente do que conferiu. Um getter que lança vira erro do Ledger.
 *
 * Os dois PAPÉIS são exercitados igualmente:
 *  - REFERÊNCIA: o registro 4 (resultado) aponta para a decisão do seq 1 (`armazem.ler` / `tx.ler`);
 *  - ANTERIOR: o registro 4 encadeia no seq 3 (`armazem.ler` na Fase A, `tx.ponta` na Fase B).
 * `adicionados` registra TODA chamada a `tx.adicionar`, mesmo as desfeitas pelo rollback: "nada
 * gravado" significa que a gravação nem foi tentada.
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
import { cadeiaBase, clonar, T } from './apoioEsquema2';

const chave = (cadeia: string, seq: number) => `${cadeia}#${seq}`;

type Papel = 'referencia' | 'anterior';
const PAPEIS: Papel[] = ['referencia', 'anterior'];
/** o seq lido em cada papel: a decisão apontada (1) ou o registro anterior (3) */
const ALVO: Record<Papel, number> = { referencia: 1, anterior: 3 };

/**
 * Armazém em memória com GANCHOS no que é devolvido: `faseA` troca o valor de `armazem.ler`; `faseB`
 * troca o de `tx.ponta` e `tx.ler`. Os dados guardados continuam os registros puros.
 */
class ArmazemComGanchos implements ArmazemLedger {
  dados = new Map<string, RegistroLedger>();
  adicionados: RegistroLedger[] = [];
  transacoesConfirmadas = 0;
  faseA?: (seq: number, r: RegistroLedger) => unknown;
  faseB?: (seq: number, r: RegistroLedger, via: 'ponta' | 'ler') => unknown;
  /** roda ao abrir a transação: DEPOIS da Fase A, antes da Fase B */
  aoAbrirTransacao?: () => void;
  constructor(registros: readonly RegistroLedger[]) {
    for (const r of registros) this.dados.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
  }
  async ler(cadeia: string, seq: number): Promise<RegistroLedger | null> {
    await Promise.resolve();
    const r = this.dados.get(chave(cadeia, seq)) ?? null;
    return (r && this.faseA ? this.faseA(seq, r) : r) as RegistroLedger | null;
  }
  async transacao<R>(corpo: (tx: TransacaoLedger) => R): Promise<R> {
    await Promise.resolve();
    this.aoAbrirTransacao?.();
    const rascunho = new Map(this.dados);
    const devolver = (r: RegistroLedger | null, via: 'ponta' | 'ler') =>
      (r && this.faseB ? this.faseB(r.cabecalho.seq, r, via) : r) as RegistroLedger | null;
    const tx: TransacaoLedger = {
      ponta: (cadeia) => {
        let melhor: RegistroLedger | null = null;
        for (const r of rascunho.values())
          if (r.cabecalho.cadeia === cadeia && (!melhor || r.cabecalho.seq > melhor.cabecalho.seq))
            melhor = r;
        return devolver(melhor, 'ponta');
      },
      ler: (cadeia, seq) => devolver(rascunho.get(chave(cadeia, seq)) ?? null, 'ler'),
      adicionar: (r) => {
        this.adicionados.push(r);
        rascunho.set(chave(r.cabecalho.cadeia, r.cabecalho.seq), r);
      },
    };
    const resultado = corpo(tx); // se lançar, o rascunho é descartado (rollback)
    this.dados = rascunho;
    this.transacoesConfirmadas++;
    return resultado;
  }
  foto(): string {
    return JSON.stringify([...this.dados.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
  lista(cadeia = 'A'): RegistroLedger[] {
    return [...this.dados.values()]
      .filter((r) => r.cabecalho.cadeia === cadeia)
      .sort((a, b) => a.cabecalho.seq - b.cabecalho.seq);
  }
}

/** base [decisão 1, aposta 2, resultado 3] e o registro 4: um resultado que aponta para a decisão 1 */
async function cenario() {
  const base = await cadeiaBase();
  const novo = await criarRegistro(
    {
      tipo: 'resultado',
      cadeia: 'A',
      criadoEm: T(4),
      corpo: {
        decisao: { seq: 1, hash: base[0].hash },
        resultado: { casa: 0, fora: 0, registradoEm: T(4) },
      },
      versaoMotor: 'teste',
      politicas: { x: 1 },
    },
    base[2],
  );
  return { base, novo, armazem: new ArmazemComGanchos(base) };
}

type Objeto = Record<string, unknown>;

/** uma alteração do conteúdo de um registro gravado: o caminho e o valor ADULTERADO */
interface Alteracao {
  nome: string;
  caminho: string[];
  valor: (r: RegistroLedger) => unknown;
}
const corpoDe = (r: RegistroLedger) => r.corpo as unknown as Objeto;
const ALTERACOES: Record<Papel, Alteracao[]> = {
  referencia: [
    {
      nome: 'corpo',
      caminho: ['corpo'],
      valor: (r) => ({ ...corpoDe(r), impressao: 'adulterada' }),
    },
    { nome: 'aninhado', caminho: ['corpo', 'snapshot', 'contexto'], valor: () => ({ x: 1 }) },
    { nome: 'cabeçalho', caminho: ['cabecalho', 'criadoEm'], valor: () => T(50) },
  ],
  anterior: [
    {
      nome: 'corpo',
      caminho: ['corpo'],
      valor: (r) => ({
        ...corpoDe(r),
        resultado: { ...(corpoDe(r).resultado as Objeto), casa: 99 },
      }),
    },
    { nome: 'aninhado', caminho: ['corpo', 'resultado', 'casa'], valor: () => 99 },
    { nome: 'cabeçalho', caminho: ['cabecalho', 'criadoEm'], valor: () => T(50) },
  ],
};

/** o objeto que contém a última chave do caminho, numa cópia de `raiz` */
function paiDe(raiz: Objeto, caminho: string[]): Objeto {
  let pai = raiz;
  for (const k of caminho.slice(0, -1)) pai = pai[k] as Objeto;
  return pai;
}

/** o registro com o valor do caminho TROCADO (o campo `hash` continua o gravado: é adulteração) */
function adulterado(r: RegistroLedger, a: Alteracao): RegistroLedger {
  const raiz = clonar(r) as unknown as Objeto;
  paiDe(raiz, a.caminho)[a.caminho.at(-1)!] = a.valor(r);
  return raiz as unknown as RegistroLedger;
}

/** a ordem dos valores devolvidos pelo getter ao longo das leituras */
type Ordem = 'valido-primeiro' | 'adulterado-primeiro';
const ORDENS: Ordem[] = ['valido-primeiro', 'adulterado-primeiro'];

/**
 * Cópia de `r` com um GETTER no caminho: nas `trocaApos` primeiras leituras devolve um dos valores
 * (o válido ou o adulterado, conforme a ordem) e daí em diante o outro. Conta as leituras.
 */
function comGetter(r: RegistroLedger, a: Alteracao, ordem: Ordem, trocaApos: number) {
  const raiz = clonar(r) as unknown as Objeto;
  const pai = paiDe(raiz, a.caminho);
  const k = a.caminho.at(-1)!;
  const original = pai[k];
  const trocado = a.valor(r);
  let leituras = 0;
  Object.defineProperty(pai, k, {
    enumerable: true,
    configurable: true,
    get: () => {
      const antes = ++leituras <= trocaApos;
      return (ordem === 'valido-primeiro') === antes ? original : trocado;
    },
  });
  return { obj: raiz as unknown as RegistroLedger, leituras: () => leituras };
}

/** Proxy sobre a cópia de `r` cujo `corpo` muda de valor como o getter de `comGetter` */
function proxyVariavel(r: RegistroLedger, ordem: Ordem, trocaApos: number) {
  const corpoAdulterado = ALTERACOES.referencia[0].valor(r); // só o corpo trocado (qualquer conteúdo)
  let leituras = 0;
  const alvo = clonar(r);
  const obj = new Proxy(alvo, {
    get(t, k, receptor) {
      if (k !== 'corpo') return Reflect.get(t, k, receptor) as unknown;
      const antes = ++leituras <= trocaApos;
      return (ordem === 'valido-primeiro') === antes ? t.corpo : corpoAdulterado;
    },
  });
  return { obj, leituras: () => leituras };
}

/** o anexo é recusado com erro do Ledger e NADA é gravado (nem tentado, nem confirmado) */
async function recusado(armazem: ArmazemComGanchos, novo: RegistroLedger): Promise<Error> {
  const antes = armazem.foto();
  const erro = await anexar(armazem, novo).catch((e: unknown) => e);
  expect(
    erro instanceof ErroDeCadeia || erro instanceof ConflitoDeCadeia,
    `recusa crua: ${String(erro)}`,
  ).toBe(true);
  expect(armazem.adicionados).toHaveLength(0);
  expect(armazem.transacoesConfirmadas).toBe(0);
  expect(armazem.foto()).toBe(antes);
  return erro as Error;
}

/** o anexo é aceito, grava a cópia de `novo` e a cadeia continua íntegra */
async function aceito(armazem: ArmazemComGanchos, novo: RegistroLedger) {
  await anexar(armazem, novo);
  expect(armazem.adicionados).toHaveLength(1);
  const gravado = armazem.dados.get('A#4')!;
  expect(serializarCanonico(gravado)).toBe(serializarCanonico(novo));
  expect(Object.isFrozen(gravado)).toBe(true);
  expect(Object.isFrozen(gravado.corpo)).toBe(true);
  expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
}

const TROCAS = Array.from({ length: 13 }, (_, i) => i); // 0..12: cada ponto de troca possível

describe.each(PAPEIS)('papel %s: FASE A lê o registro UMA vez e valida o que captura', (papel) => {
  const alvo = ALVO[papel];
  describe.each(ALTERACOES[papel].map((a) => [a.nome, a] as const))('getter no %s', (_, a) => {
    it.each(ORDENS)(
      'getter dinâmico (%s) na Fase A, a Fase B devolve o conteúdo adulterado: SEMPRE recusado, uma leitura',
      async (ordem) => {
        for (const trocaApos of TROCAS) {
          const { base, novo, armazem } = await cenario();
          const g = comGetter(base[alvo - 1], a, ordem, trocaApos);
          armazem.faseA = (seq, r) => (seq === alvo ? g.obj : r);
          // a Fase B devolve o conteúdo ADULTERADO (o que o getter devolve "do outro lado")
          armazem.faseB = (seq, r) => (seq === alvo ? adulterado(r, a) : r);
          const erro = await recusado(armazem, novo);
          // o original foi lido UMA vez: a validação e a captura são da mesma cópia
          expect(g.leituras(), `${ordem}, troca após ${trocaApos}`).toBe(1);
          // a cópia lida era a válida? então a Fase A passou e a Fase B acusou a diferença
          const copiaValida = (ordem === 'valido-primeiro') === trocaApos >= 1;
          expect(erro, `${ordem}, troca após ${trocaApos}`).toBeInstanceOf(
            copiaValida ? ConflitoDeCadeia : ErroDeCadeia,
          );
        }
      },
    );
  });

  it.each(ORDENS)(
    'Proxy com comportamento variável (%s) na Fase A: SEMPRE recusado, uma leitura',
    async (ordem) => {
      for (const trocaApos of TROCAS) {
        const { base, novo, armazem } = await cenario();
        const p = proxyVariavel(base[alvo - 1], ordem, trocaApos);
        armazem.faseA = (seq, r) => (seq === alvo ? p.obj : r);
        armazem.faseB = (seq, r) => (seq === alvo ? adulterado(r, ALTERACOES.referencia[0]) : r);
        await recusado(armazem, novo);
        expect(p.leituras(), `${ordem}, troca após ${trocaApos}`).toBe(1);
      }
    },
  );

  it.each(ALTERACOES[papel].map((a) => [a.nome, a] as const))(
    'a representação AUTORIZADA é a da cópia VALIDADA (getter no %s, em cada ponto de troca)',
    async (_, a) => {
      for (const ordem of ORDENS)
        for (const trocaApos of TROCAS) {
          const { base, novo, armazem } = await cenario();
          const g = comGetter(base[alvo - 1], a, ordem, trocaApos);
          armazem.faseA = (seq, r) => (seq === alvo ? g.obj : r);
          const v = await verificarReferencias(armazem, novo).catch((e: unknown) => e);
          const copiaValida = (ordem === 'valido-primeiro') === trocaApos >= 1;
          if (!copiaValida) {
            // a cópia é a adulterada: a validação (hash recalculado) a recusa
            expect(v, `${ordem}, troca após ${trocaApos}`).toBeInstanceOf(ErroDeCadeia);
            continue;
          }
          expect(v).not.toBeInstanceOf(Error);
          const verificadas = v as Awaited<ReturnType<typeof verificarReferencias>>;
          const canonico =
            papel === 'referencia' ? verificadas.itens[0].canonico : verificadas.anterior!.canonico;
          // a representação capturada é exatamente a do registro válido...
          expect(canonico).toBe(serializarCanonico(base[alvo - 1]));
          // ...e é conteúdo VALIDADO: o hash recalculado dela é o gravado
          const lido = JSON.parse(canonico) as RegistroLedger;
          expect(await hashDoRegistro(lido.cabecalho, lido.corpo)).toBe(lido.hash);
          expect(g.leituras()).toBe(1);
        }
    },
  );

  it('conteúdo alterado DEPOIS da captura (o objeto lido é mudado): a autorização não muda; a Fase B recusa', async () => {
    const { base, novo, armazem } = await cenario();
    const lidoNaFaseA = clonar(base[alvo - 1]);
    armazem.faseA = (seq, r) => (seq === alvo ? lidoNaFaseA : r);
    const verificadas = await verificarReferencias(armazem, novo);
    const capturado = () =>
      papel === 'referencia' ? verificadas.itens[0].canonico : verificadas.anterior!.canonico;
    const antes = capturado();
    // o armazém altera o MESMO objeto que devolveu, e passa a devolvê-lo na Fase B
    (lidoNaFaseA.cabecalho as { criadoEm: string }).criadoEm = T(50);
    armazem.faseB = (seq, r) => (seq === alvo ? lidoNaFaseA : r);
    expect(capturado()).toBe(antes);
    expect(capturado()).toBe(serializarCanonico(base[alvo - 1]));
    const erro = await armazem
      .transacao((tx) => anexarNaTransacao(tx, novo, verificadas))
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflitoDeCadeia);
    expect(armazem.adicionados).toHaveLength(0);
  });
});

describe.each(PAPEIS)('papel %s: FASE B lê UMA vez e compara a cópia', (papel) => {
  const alvo = ALVO[papel];
  describe.each(ALTERACOES[papel].map((a) => [a.nome, a] as const))('getter no %s', (_, a) => {
    it.each(ORDENS)(
      'conteúdo muda DURANTE a leitura na Fase B (%s): decide pela única leitura, nada além do autorizado',
      async (ordem) => {
        for (const trocaApos of TROCAS) {
          const { base, novo, armazem } = await cenario();
          const g = comGetter(base[alvo - 1], a, ordem, trocaApos);
          const vias: string[] = [];
          armazem.faseB = (seq, r, via) => {
            if (seq !== alvo) return r;
            vias.push(via);
            return g.obj;
          };
          const copiaValida = (ordem === 'valido-primeiro') === trocaApos >= 1;
          if (copiaValida) await aceito(armazem, novo);
          else
            expect(
              await recusado(armazem, novo),
              `${ordem}, troca após ${trocaApos}`,
            ).toBeInstanceOf(ConflitoDeCadeia);
          expect(g.leituras(), `${ordem}, troca após ${trocaApos}`).toBe(1);
          // a referência é relida por `tx.ler`; o anterior chega como a PONTA; uma leitura só
          expect(vias).toEqual([papel === 'referencia' ? 'ler' : 'ponta']);
        }
      },
    );
  });

  it.each(ORDENS)('Proxy com comportamento variável (%s) na Fase B: uma leitura', async (ordem) => {
    for (const trocaApos of TROCAS) {
      const { base, novo, armazem } = await cenario();
      const p = proxyVariavel(base[alvo - 1], ordem, trocaApos);
      armazem.faseB = (seq, r) => (seq === alvo ? p.obj : r);
      const copiaValida = (ordem === 'valido-primeiro') === trocaApos >= 1;
      if (copiaValida) await aceito(armazem, novo);
      else expect(await recusado(armazem, novo)).toBeInstanceOf(ConflitoDeCadeia);
      expect(p.leituras()).toBe(1);
    }
  });

  it.each(ALTERACOES[papel].map((a) => [a.nome, a] as const))(
    'mutação ENTRE a Fase A e a Fase B (%s adulterado no armazém): ConflitoDeCadeia, nada gravado',
    async (_, a) => {
      const { base, novo, armazem } = await cenario();
      armazem.aoAbrirTransacao = () =>
        armazem.dados.set(chave('A', alvo), adulterado(base[alvo - 1], a));
      const erro = await anexar(armazem, novo).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ConflitoDeCadeia);
      expect(armazem.adicionados).toHaveLength(0);
      expect(armazem.transacoesConfirmadas).toBe(0);
    },
  );
});

/** um getter/Proxy que LANÇA; o `lancado` é o valor lançado */
const LANCADOS: [string, () => unknown][] = [
  ['Error', () => new Error('getter explodiu')],
  ['TypeError', () => new TypeError('revogado')],
  ['valor que não é Error', () => 'texto lançado'],
];

function comGetterQueLanca(r: RegistroLedger, caminho: string[], lancado: () => unknown) {
  const raiz = clonar(r) as unknown as Objeto;
  Object.defineProperty(paiDe(raiz, caminho), caminho.at(-1)!, {
    enumerable: true,
    get: () => {
      throw lancado();
    },
  });
  return raiz as unknown as RegistroLedger;
}

const proxyQueLanca = (r: RegistroLedger, lancado: () => unknown) =>
  new Proxy(clonar(r), {
    ownKeys() {
      throw lancado();
    },
  });

describe.each(PAPEIS)('papel %s: exceções viram erro do Ledger, nada gravado', (papel) => {
  const alvo = ALVO[papel];
  const caminhos = ALTERACOES[papel].map((a) => a.caminho);
  for (const fase of ['A', 'B'] as const)
    describe(`Fase ${fase}`, () => {
      it.each(LANCADOS)(
        'getter que lança %s (corpo, aninhado, cabeçalho): ErroDeCadeia',
        async (_, lancado) => {
          for (const caminho of caminhos) {
            const { base, novo, armazem } = await cenario();
            const obj = comGetterQueLanca(base[alvo - 1], caminho, lancado);
            if (fase === 'A') armazem.faseA = (seq, r) => (seq === alvo ? obj : r);
            else armazem.faseB = (seq, r) => (seq === alvo ? obj : r);
            const erro = await recusado(armazem, novo);
            expect(erro, caminho.join('.')).toBeInstanceOf(ErroDeCadeia);
            expect(erro.message).toMatch(/não serializável/);
          }
        },
      );

      it.each(LANCADOS)('Proxy que lança %s: ErroDeCadeia', async (_, lancado) => {
        const { base, novo, armazem } = await cenario();
        const obj = proxyQueLanca(base[alvo - 1], lancado);
        if (fase === 'A') armazem.faseA = (seq, r) => (seq === alvo ? obj : r);
        else armazem.faseB = (seq, r) => (seq === alvo ? obj : r);
        expect(await recusado(armazem, novo)).toBeInstanceOf(ErroDeCadeia);
      });

      it('a própria LEITURA do armazém que falha: ErroDeCadeia; os erros do Ledger passam como estão', async () => {
        const casos: [unknown, typeof ErroDeCadeia | typeof ConflitoDeCadeia][] = [
          [new Error('disco'), ErroDeCadeia],
          ['texto', ErroDeCadeia],
          [new ConflitoDeCadeia('outro escritor'), ConflitoDeCadeia],
          [new ErroDeCadeia('armazém corrompido'), ErroDeCadeia],
        ];
        for (const [lancado, esperado] of casos) {
          const { novo, armazem } = await cenario();
          const lancar = (seq: number, r: RegistroLedger) => {
            if (seq === alvo) throw lancado;
            return r;
          };
          if (fase === 'A') armazem.faseA = lancar;
          else armazem.faseB = lancar;
          const erro = await recusado(armazem, novo);
          expect(erro, String(lancado)).toBeInstanceOf(esperado);
          // o conflito legítimo continua conflito (não vira erro genérico)
          if (esperado === ConflitoDeCadeia) expect(erro).toBe(lancado);
        }
      });
    });
});

describe('o registro NOVO na Fase B: o tipo é lido dentro do tratamento de erros', () => {
  async function autorizado() {
    const c = await cenario();
    return { ...c, verificadas: await verificarReferencias(c.armazem, c.novo) };
  }
  const naTransacao = (
    armazem: ArmazemComGanchos,
    novo: unknown,
    verificadas: Awaited<ReturnType<typeof verificarReferencias>>,
  ) =>
    armazem
      .transacao((tx) => anexarNaTransacao(tx, novo as RegistroLedger, verificadas))
      .catch((e: unknown) => e);

  it.each(LANCADOS)(
    'getter de `cabecalho` que lança %s: ErroDeCadeia, nada gravado',
    async (_, lancado) => {
      const { novo, armazem, verificadas } = await autorizado();
      const r = comGetterQueLanca(novo, ['cabecalho'], lancado);
      const erro = await naTransacao(armazem, r, verificadas);
      expect(erro).toBeInstanceOf(ErroDeCadeia);
      expect((erro as Error).message).toMatch(/recusado: o registro novo/);
      expect(armazem.adicionados).toHaveLength(0);
    },
  );

  it('getter de `cabecalho.tipo` que lança, e Proxy que lança em qualquer leitura: ErroDeCadeia', async () => {
    const { novo, armazem, verificadas } = await autorizado();
    const r1 = comGetterQueLanca(novo, ['cabecalho', 'tipo'], () => new Error('x'));
    expect(await naTransacao(armazem, r1, verificadas)).toBeInstanceOf(ErroDeCadeia);
    const r2 = new Proxy(clonar(novo), {
      get() {
        throw new Error('proxy');
      },
    });
    expect(await naTransacao(armazem, r2, verificadas)).toBeInstanceOf(ErroDeCadeia);
    expect(armazem.adicionados).toHaveLength(0);
  });

  it('null e undefined no lugar do registro: ErroDeCadeia (não TypeError)', async () => {
    const { armazem, verificadas } = await autorizado();
    for (const v of [null, undefined]) {
      const erro = await naTransacao(armazem, v, verificadas);
      expect(erro, String(v)).toBeInstanceOf(ErroDeCadeia);
    }
    expect(armazem.adicionados).toHaveLength(0);
  });

  it('tipo que é um objeto cuja conversão para texto LANÇA (toPrimitive, toString, valueOf): ErroDeCadeia de mensagem fixa', async () => {
    const lanca = () => {
      throw new Error('conversão maliciosa');
    };
    const tipos: [string, object][] = [
      ['Symbol.toPrimitive', { [Symbol.toPrimitive]: lanca }],
      ['toString e valueOf', { toString: lanca, valueOf: lanca }],
      ['sem protótipo', Object.create(null) as object],
    ];
    for (const [nome, tipo] of tipos) {
      const { novo, armazem, verificadas } = await autorizado();
      const r = clonar(novo) as unknown as { cabecalho: Objeto };
      Object.defineProperty(r.cabecalho, 'tipo', { enumerable: true, get: () => tipo });
      const erro = await naTransacao(armazem, r, verificadas);
      expect(erro, nome).toBeInstanceOf(ErroDeCadeia);
      expect((erro as Error).message, nome).toBe(
        'recusado: o tipo do registro não é permitido para escrita (somente leitura nesta versão ou desconhecido; a escrita ainda não está habilitada)',
      );
      expect(armazem.adicionados, nome).toHaveLength(0);
      expect(armazem.transacoesConfirmadas, nome).toBe(0);
    }
  });

  it('um ConflitoDeCadeia lançado na leitura do tipo continua ConflitoDeCadeia', async () => {
    const { novo, armazem, verificadas } = await autorizado();
    const conflito = new ConflitoDeCadeia('conflito');
    const r = comGetterQueLanca(novo, ['cabecalho', 'tipo'], () => conflito);
    expect(await naTransacao(armazem, r, verificadas)).toBe(conflito);
    expect(armazem.adicionados).toHaveLength(0);
  });

  it('o tipo é lido UMA vez, e a autorização (WeakMap) continua exigida', async () => {
    const { novo, armazem, verificadas } = await autorizado();
    let leituras = 0;
    const r = clonar(novo) as unknown as { cabecalho: Objeto };
    const tipo = r.cabecalho.tipo;
    Object.defineProperty(r.cabecalho, 'tipo', {
      enumerable: true,
      get: () => (leituras++, tipo),
    });
    // sem a autorização emitida pela Fase A: recusado, mesmo com os campos certos
    const copiaDaAutorizacao = { ...verificadas } as typeof verificadas;
    expect(await naTransacao(armazem, r, copiaDaAutorizacao)).toBeInstanceOf(ErroDeCadeia);
    expect(armazem.adicionados).toHaveLength(0);
    leituras = 0;
    await armazem.transacao((tx) =>
      anexarNaTransacao(tx, r as unknown as RegistroLedger, verificadas),
    );
    // uma leitura para o tipo e uma para o vínculo canônico; nenhuma depois disso
    expect(leituras).toBe(2);
    expect(armazem.adicionados).toHaveLength(1);
    expect(serializarCanonico(armazem.adicionados[0])).toBe(serializarCanonico(novo));
  });
});

describe('cadeias legítimas continuam funcionando', () => {
  it('armazém de dados puros: grava o registro 4, cópia congelada, cadeia íntegra', async () => {
    const { novo, armazem } = await cenario();
    await aceito(armazem, novo);
  });

  it('armazém que devolve getters e Proxies ESTÁVEIS nas duas fases (os dois papéis): grava', async () => {
    const { novo, armazem } = await cenario();
    const estavel = (r: RegistroLedger): RegistroLedger => {
      const o = clonar(r) as unknown as Objeto;
      const corpo = o.corpo;
      Object.defineProperty(o, 'corpo', { enumerable: true, get: () => corpo });
      return new Proxy(o, {}) as unknown as RegistroLedger;
    };
    armazem.faseA = (_, r) => estavel(r);
    armazem.faseB = (_, r) => estavel(r);
    await aceito(armazem, novo);
  });

  it('gênese e uma cadeia inteira gravada pela porta, lendo sempre por getters estáveis', async () => {
    const base = await cadeiaBase();
    const armazem = new ArmazemComGanchos([]);
    const estavel = (r: RegistroLedger) => {
      const o = clonar(r) as unknown as Objeto;
      const cab = o.cabecalho;
      Object.defineProperty(o, 'cabecalho', { enumerable: true, get: () => cab });
      return o;
    };
    armazem.faseA = (_, r) => estavel(r);
    armazem.faseB = (_, r) => estavel(r);
    for (const r of base) await anexar(armazem, r);
    expect(armazem.adicionados).toHaveLength(3);
    expect(armazem.lista().map((r) => r.hash)).toEqual(base.map((r) => r.hash));
    expect((await verificarCadeia(armazem.lista())).estado).toBe('integra');
  });
});
