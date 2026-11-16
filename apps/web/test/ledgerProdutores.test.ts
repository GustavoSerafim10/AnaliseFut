/**
 * O contrato do Ledger (validacao.ts) contra os objetos REALMENTE produzidos pelo motor e pelo app:
 * nada é inventado para satisfazer a validação. Onde o produtor real foge do contrato, o teste
 * documenta a divergência (marcada "DIVERGÊNCIA") para decisão, sem esconder e sem mudar o produtor.
 */
import { describe, expect, it } from 'vitest';
import {
  analisarV4,
  autorizarStake,
  calcularTravas,
  criarRegistro,
  impressaoDaDecisao,
  motivoCorpoIncompativel,
  reproduzirComMotorAtual,
  resumirSaidaDoMotor,
  serializarCanonico,
  verificarCadeia,
  type CorpoLedger,
  type TravasBanca,
} from '@pe/engine';
import { derivar } from '../src/dados';
import { inicioIso, isoLocal, num, rascunhoNovo, type Rascunho } from '../src/estado';
import {
  registrarAposta,
  travasDoHistorico,
  type ApostaFeita,
  type ResultadoJogo,
} from '../src/historico';

const AGORA = '2099-10-26T12:00:00-03:00';
const base: Rascunho = {
  ...rascunhoNovo(),
  jogo: { casa: 'Flamengo', fora: 'Vasco', competicao: 'X', data: '2099-10-26', hora: '20:00' },
  casas: ['1win'],
  odds: [
    { casa: '1win', mercado: 'total', lado: 'over', linha: 1.5, odd: 1.4, periodo: 'FT' },
    { casa: '1win', mercado: 'total', lado: 'under', linha: 1.5, odd: 3, periodo: 'FT' },
    { casa: '1win', mercado: 'total', lado: 'over', linha: 2.5, odd: 1.9, periodo: 'FT' },
    { casa: '1win', mercado: 'total', lado: 'under', linha: 2.5, odd: 1.9, periodo: 'FT' },
  ],
} as Rascunho;
const d = derivar(base);

const T0 = '2026-11-13T15:00:00-03:00';
const STAKE_PADRAO = autorizarStake({ p: 0.55, odd: 2, fracaoKelly: 0.25, dq: 'A', banca: 1000 });
const TRAVAS_PADRAO = calcularTravas(1000, [], T0);
const APOSTA_PADRAO = { odd: 2, casa: '1win', feitaEm: T0 };

/** o corpo de uma aposta registrada com as peças dadas */
const corpoAposta = (p: {
  aposta?: unknown;
  stake?: unknown;
  travas?: unknown;
}): Record<string, unknown> => ({
  decisao: null,
  aposta: p.aposta ?? APOSTA_PADRAO,
  stakeAutorizada: p.stake ?? STAKE_PADRAO,
  travas: p.travas ?? TRAVAS_PADRAO,
});
const valida = (tipo: 'aposta_registrada' | 'resultado' | 'decisao', corpo: unknown) =>
  motivoCorpoIncompativel({ tipo, seq: 2 }, corpo);

describe('StakeAutorizada: saída real de autorizarStake', () => {
  it('toda combinação de pedidos válidos passa (entradas razoáveis, 3 DQ, com e sem banca e folgas)', () => {
    let n = 0;
    for (const p of [0.05, 0.2, 0.5, 0.55, 0.8, 0.99])
      for (const odd of [1.2, 1.5, 2, 3.4, 10])
        for (const dq of ['A', 'B', 'C'] as const)
          for (const banca of [undefined, 1000])
            for (const folgaJogo of [undefined, 0.02, 0])
              for (const folgaDia of [undefined, 0.06, 0]) {
                const s = autorizarStake({
                  p,
                  odd,
                  fracaoKelly: 0.25,
                  dq,
                  banca,
                  folgaJogo,
                  folgaDia,
                  reducoes: [0.5],
                });
                expect(
                  valida('aposta_registrada', corpoAposta({ stake: s })),
                  JSON.stringify(s),
                ).toBeNull();
                n++;
              }
    expect(n).toBe(6 * 5 * 3 * 2 * 3 * 3);
  });

  it('recusas legítimas passam: DQ D/E, sem vantagem, teto zero (autorizada=false com motivo)', () => {
    for (const s of [
      autorizarStake({ p: 0.55, odd: 2, fracaoKelly: 0.25, dq: 'D', banca: 1000 }),
      autorizarStake({ p: 0.4, odd: 2, fracaoKelly: 0.25, dq: 'A', banca: 1000 }),
      autorizarStake({ p: 0.55, odd: 2, fracaoKelly: 0.25, dq: 'A', teto: 0 }),
    ]) {
      expect(s.autorizada).toBe(false);
      expect(valida('aposta_registrada', corpoAposta({ stake: s }))).toBeNull();
    }
  });

  it('DIVERGÊNCIA: recusa por pedido inválido ecoa o valor inválido (teto negativo, fração negativa)', () => {
    // autorizarStake devolve zero(...) com o teto/fração INVÁLIDOS do pedido; o contrato do Ledger
    // exige ≥ 0. Origem: kelly.ts (`zero()` repete tetoEf/fracao sem limitar a zero).
    const teto = autorizarStake({ p: 0.5, odd: 2, fracaoKelly: 0.25, dq: 'A', teto: -1 });
    expect(teto).toMatchObject({ autorizada: false, teto: -1 });
    expect(valida('aposta_registrada', corpoAposta({ stake: teto }))).toMatch(/teto/);
    const fracao = autorizarStake({ p: 0.5, odd: 2, fracaoKelly: -0.25, dq: 'A' });
    expect(fracao.fracaoKelly).toBeLessThan(0);
    expect(valida('aposta_registrada', corpoAposta({ stake: fracao }))).toMatch(/fracaoKelly/);
  });

  it('pedido com p/odd não finitos vira zero com campos finitos: passa', () => {
    for (const [p, odd] of [
      [Number.NaN, 2],
      [0.5, Number.NaN],
      [Number.POSITIVE_INFINITY, 2],
      [0.5, 0.5],
      [0, 2],
    ] as const) {
      const s = autorizarStake({ p, odd, fracaoKelly: 0.25, dq: 'A', banca: 1000 });
      expect(valida('aposta_registrada', corpoAposta({ stake: s })), `${p}/${odd}`).toBeNull();
    }
  });
});

describe('TravasBanca: saída real de calcularTravas e do histórico', () => {
  const apostaBanca = (
    feitaEm: string,
    stake: number,
    lucro?: number,
    apuradaEm?: string,
  ): { feitaEm: string; stake: number; lucro?: number; apuradaEm?: string } => ({
    feitaEm,
    stake,
    lucro,
    apuradaEm,
  });
  const cenarios: Record<string, ReturnType<typeof apostaBanca>[]> = {
    'sem apostas': [],
    'uma ganha': [apostaBanca('2026-11-10T12:00:00-03:00', 10, 0.9, '2026-11-10T20:00:00-03:00')],
    'drawdown de 20%': [
      apostaBanca('2026-11-10T12:00:00-03:00', 250, -1, '2026-11-10T20:00:00-03:00'),
    ],
    'drawdown de 30% (pausa)': [
      apostaBanca('2026-11-10T12:00:00-03:00', 400, -1, '2026-11-10T20:00:00-03:00'),
    ],
    'cinco perdas no dia': Array.from({ length: 5 }, (_, i) =>
      apostaBanca(`2026-11-13T1${i}:00:00-03:00`, 10, -1, `2026-11-13T1${i}:30:00-03:00`),
    ),
    'banca zerada e negativa': [
      apostaBanca('2026-11-10T12:00:00-03:00', 1000, -1, '2026-11-10T20:00:00-03:00'),
      apostaBanca('2026-11-11T12:00:00-03:00', 10, -1, '2026-11-11T20:00:00-03:00'),
    ],
    'datas sem deslocamento': [apostaBanca('2026-11-10T12:00:00', 400, -1, '2026-11-10T20:00:00')],
  };
  for (const [nome, apostas] of Object.entries(cenarios))
    for (const agora of [T0, '2026-11-13T15:00:00Z'])
      it(`${nome} (agora ${agora.slice(-6)})`, () => {
        const t = calcularTravas(1000, apostas, agora);
        expect(
          valida('aposta_registrada', corpoAposta({ travas: t })),
          JSON.stringify(t),
        ).toBeNull();
      });

  it('as travas do histórico real, com o jogo (expostoJogo) e com uma aposta registrada', () => {
    const apostaFeita: ApostaFeita = {
      odd: 1.9,
      casa: '1win',
      valor: 10,
      feitaEm: '2099-10-26T10:00:00-03:00',
      entrada: {
        linha: base.odds[0],
        descricao: 'aposta 0',
        odd: 1.9,
        casa: '1win',
        ev: 0.02,
        pFinal: 0.55,
      },
    };
    const { lista } = registrarAposta([], { ...base, idHistorico: undefined }, d, apostaFeita);
    const t: TravasBanca = travasDoHistorico(lista, 1000, AGORA, [], {
      casa: base.jogo.casa,
      fora: base.jogo.fora,
      data: base.jogo.data,
    });
    expect(t.expostoJogo).toBeCloseTo(0.01, 12);
    expect(valida('aposta_registrada', corpoAposta({ travas: t }))).toBeNull();
    // a aposta que o app guardou (a mesma que iria ao Ledger) também passa
    expect(lista[0].aposta).toBeDefined();
    expect(valida('aposta_registrada', corpoAposta({ aposta: lista[0].aposta }))).toBeNull();
  });
});

describe('aposta: o que o formulário "Entrei nessa aposta" produz', () => {
  // FormAposta.tsx: { odd, casa: casa.trim(), valor: num(valor), feitaEm: isoLocal(new Date()) }
  const comoOFormulario = (odd: string, casa: string, valor: string): ApostaFeita => ({
    odd: num(odd)!,
    casa: casa.trim(),
    valor: num(valor),
    feitaEm: isoLocal(new Date()),
  });

  it('com valor, com valor decimal em vírgula e sem valor (unidades)', () => {
    for (const [odd, casa, valor] of [
      ['1,90', '1win', '10'],
      ['2.05', ' Bet365 ', '12,50'],
      ['1.5', 'Betano', ''],
    ] as const)
      expect(
        valida('aposta_registrada', corpoAposta({ aposta: comoOFormulario(odd, casa, valor) })),
        `${odd}/${casa}/${valor}`,
      ).toBeNull();
  });

  it('a data do formulário (isoLocal, fuso fixo -03:00) é aceita em qualquer hora do dia', () => {
    for (const h of [0, 3, 12, 23]) {
      const feitaEm = isoLocal(new Date(2026, 10, 13, h, 59));
      expect(
        valida('aposta_registrada', corpoAposta({ aposta: { ...APOSTA_PADRAO, feitaEm } })),
      ).toBeNull();
    }
  });

  it('odd <= 1 e casa vazia não saem do formulário (ele os impede), e o Ledger os recusa', () => {
    expect(
      valida('aposta_registrada', corpoAposta({ aposta: { ...APOSTA_PADRAO, odd: 1 } })),
    ).toMatch(/odd/);
    expect(
      valida('aposta_registrada', corpoAposta({ aposta: { ...APOSTA_PADRAO, casa: ' ' } })),
    ).toMatch(/casa/);
  });
});

describe('resultado: o que o formulário de resultado produz', () => {
  // AbaHistorico.tsx: placar = par(casa, fora) com num(); casa/fora = placar?.casa ?? NaN
  const par = (c: string, f: string) => {
    const a = num(c);
    const b = num(f);
    return a === undefined || b === undefined ? undefined : { casa: a, fora: b };
  };
  const comoOFormulario = (casa: string, fora: string, fechamento = ''): ResultadoJogo => {
    const placar = par(casa, fora);
    return {
      casa: placar?.casa ?? Number.NaN,
      fora: placar?.fora ?? Number.NaN,
      oddFechamento: num(fechamento),
      registradoEm: isoLocal(new Date()),
    };
  };
  const corpoResultado = (resultado: unknown) => ({ decisao: null, resultado });

  it('placar completo e inteiro (o caso normal) passa, com e sem fechamento', () => {
    for (const r of [comoOFormulario('2', '1'), comoOFormulario('0', '0', '1,85')])
      expect(valida('resultado', corpoResultado(r)), JSON.stringify(r)).toBeNull();
  });

  it('intervalo, escanteios e cartões do formulário não atrapalham', () => {
    const r = {
      ...comoOFormulario('3', '1'),
      intervalo: { casa: 1, fora: 0 },
      escanteios: { casa: 7, fora: 4 },
      cartoes: { casa: 2, fora: 3 },
      fechamentoOutros: [2.05, 3.4],
    };
    expect(valida('resultado', corpoResultado(r))).toBeNull();
  });

  it('DIVERGÊNCIA: só o fechamento, sem placar, grava casa/fora = NaN (o app permite e trata)', () => {
    // o botão "Salvar" só exige placar OU fechamento, e historico.ts#registrarResultado guarda
    // "fechamento próprio de cada aposta" com casa/fora NaN de propósito (CLV sem placar).
    const r = comoOFormulario('', '', '1,85');
    expect(Number.isNaN(r.casa) && Number.isNaN(r.fora)).toBe(true);
    expect(valida('resultado', corpoResultado(r))).toMatch(/resultado\.casa/);
  });

  it('DIVERGÊNCIA: o formulário não valida o placar (decimal e negativo passam por num())', () => {
    expect(valida('resultado', corpoResultado(comoOFormulario('1.5', '0')))).toMatch(/casa/);
    expect(valida('resultado', corpoResultado(comoOFormulario('2', '-1')))).toMatch(/fora/);
  });
});

describe('decisao e snapshot: saída real do motor e do derivado do app', () => {
  const entradaV4 = {
    jogo: { casa: base.jogo.casa, fora: base.jogo.fora, inicio: inicioIso(base) },
    agora: AGORA,
    linhas: d.oddsValidas,
    ligaPrincipal: true,
  };

  it('o snapshot com as peças reais do Derivado serializa e passa na validação', async () => {
    const saida = resumirSaidaDoMotor(analisarV4(entradaV4), null);
    const snapshot = {
      odds: d.oddsValidas,
      estatisticas: {
        modeloCasa: d.modeloCasa,
        modeloFora: d.modeloFora,
        contagens: d.contagens,
        lambda: d.lambda,
        dq: d.dqFinal,
      },
      contexto: { jogo: base.jogo, config: base.config },
      prints: {},
    };
    // tudo o que vai ao Ledger tem de ser JSON canônico: nada de NaN, Map, Date, classe
    expect(() => serializarCanonico(snapshot)).not.toThrow();
    const corpo = {
      entradaMotor: { v4: JSON.parse(JSON.stringify(entradaV4)) as unknown, lista: null },
      saida,
      snapshot: JSON.parse(JSON.stringify(snapshot)) as unknown,
      impressao: await impressaoDaDecisao(saida, d.dqFinal.dq),
    };
    expect(valida('decisao', corpo)).toBeNull();
  });

  it('um registro de decisão real é criado, verificado e REPRODUZIDO pelo motor atual', async () => {
    const saida = resumirSaidaDoMotor(analisarV4(entradaV4), null);
    const corpo = {
      entradaMotor: { v4: JSON.parse(JSON.stringify(entradaV4)) as unknown, lista: null },
      saida,
      snapshot: { odds: d.oddsValidas, estatisticas: {}, contexto: {}, prints: {} },
      impressao: await impressaoDaDecisao(saida, 'A'),
    } as unknown as CorpoLedger;
    const registro = await criarRegistro(
      { tipo: 'decisao', cadeia: 'A', criadoEm: AGORA, corpo },
      null,
    );
    expect((await verificarCadeia([registro])).estado).toBe('integra');
    expect((await reproduzirComMotorAtual(registro)).situacao).toBe('reproduzida');
  });

  it('o motor entrega a saída como objeto simples, mesmo parcial (sem V4 e sem lista)', () => {
    for (const saida of [
      resumirSaidaDoMotor(null, null),
      resumirSaidaDoMotor(analisarV4(entradaV4), null),
    ])
      expect(
        valida('decisao', {
          entradaMotor: { v4: null, lista: null },
          saida,
          snapshot: { odds: [], estatisticas: {}, contexto: {}, prints: {} },
          impressao: 'x',
        }),
      ).toBeNull();
  });
});
