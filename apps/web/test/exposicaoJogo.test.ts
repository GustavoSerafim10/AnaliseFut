/**
 * Teto de 2% por jogo: o que está comprometido no evento, identificado por data + times (e não
 * pelo id da análise), contando só apostas REGISTRADAS ("Entrei"), nunca entradas exibidas.
 */
import { describe, expect, it } from 'vitest';
import { derivar } from '../src/dados';
import { rascunhoNovo, type Rascunho } from '../src/estado';
import {
  apostasFeitas,
  chavesRegistradasNoJogo,
  exposicaoNoJogo,
  registrarAposta,
  salvarNoHistorico,
  travasDoHistorico,
  type EntradaHistorico,
} from '../src/historico';
import { valorDeMultiplasNoJogo, type Multipla } from '../src/multiplas';

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
const NOW = '2099-10-26T12:00:00-03:00';

const jogoDe = (casa: string, fora: string, data = '2099-10-26'): Rascunho => ({
  ...base,
  jogo: { ...base.jogo, casa, fora, data },
});
const aposta = (i: number, valor = 10, casa = '1win') => ({
  odd: 1.9,
  casa,
  valor,
  feitaEm: '2099-10-26T10:00:00-03:00',
  entrada: {
    linha: base.odds[i],
    descricao: `aposta ${i}`,
    odd: 1.9,
    casa,
    ev: 0.02,
    pFinal: 0.55,
  },
});
/** registra como a tela faz: a 1ª na análise, as seguintes como irmãs */
function registrar(
  lista: EntradaHistorico[],
  r: Rascunho,
  ap: ReturnType<typeof aposta>,
  id?: string,
) {
  return registrarAposta(lista, { ...r, idHistorico: id }, d, ap);
}
const expostoJogo = (lista: EntradaHistorico[], r: Rascunho, multi = 0) =>
  travasDoHistorico(
    lista,
    1000,
    NOW,
    [],
    { casa: r.jogo.casa, fora: r.jogo.fora, data: r.jogo.data },
    multi,
  ).expostoJogo;

describe('exposição por jogo: o que conta', () => {
  it('sem apostas registradas, nada comprometido', () => {
    expect(expostoJogo([], base)).toBe(0);
  });

  it('uma aposta de R$ 10 numa banca de R$ 1000 = 1% do jogo', () => {
    const { lista } = registrar([], base, aposta(0), 'a');
    expect(expostoJogo(lista, base)).toBeCloseTo(0.01, 12);
  });

  it('apostas irmãs (mercados diferentes do mesmo jogo) somam', () => {
    const p = registrar([], base, aposta(0), 'a');
    const { lista } = registrar(p.lista, base, aposta(3), p.id);
    expect(lista).toHaveLength(2);
    expect(expostoJogo(lista, base)).toBeCloseTo(0.02, 12);
  });

  it('análises repetidas do MESMO jogo (ids diferentes) somam, sem depender do id', () => {
    const a = registrar([], base, aposta(0), 'analise-1');
    const b = registrar(a.lista, base, aposta(3, 15), 'analise-2');
    expect(b.lista.map((e) => e.id).sort()).toEqual(['analise-1', 'analise-2']);
    expect(expostoJogo(b.lista, base)).toBeCloseTo(0.025, 12);
  });

  it('nome com acento, caixa, FC, ou mandante e visitante trocados: continua o mesmo jogo', () => {
    const a = registrar([], base, aposta(0), 'a');
    for (const variante of [
      jogoDe('FLAMENGO', 'vasco'),
      jogoDe('Flamengo FC', 'Vasco'),
      jogoDe('Vasco', 'Flamengo'),
      jogoDe(' Flamengo ', 'Vasco SC'),
    ])
      expect(expostoJogo(a.lista, variante)).toBeCloseTo(0.01, 12);
  });

  it('outro jogo, outra data ou só um time em comum NÃO entram', () => {
    const a = registrar([], base, aposta(0), 'a');
    expect(expostoJogo(a.lista, jogoDe('Flamengo', 'Botafogo'))).toBe(0);
    expect(expostoJogo(a.lista, jogoDe('Palmeiras', 'Vasco'))).toBe(0);
    expect(expostoJogo(a.lista, jogoDe('Flamengo', 'Vasco', '2099-10-27'))).toBe(0);
  });

  it('jogos diferentes têm cada um o seu saldo (o outro jogo não consome este)', () => {
    const a = registrar([], base, aposta(0, 20), 'a');
    const b = registrar(a.lista, jogoDe('Palmeiras', 'Santos'), aposta(0, 20), 'b');
    expect(expostoJogo(b.lista, base)).toBeCloseTo(0.02, 12);
    expect(expostoJogo(b.lista, jogoDe('Palmeiras', 'Santos'))).toBeCloseTo(0.02, 12);
  });

  it('análise só salva, sem o botão "Entrei", não reserva exposição', () => {
    const { lista } = salvarNoHistorico([], { ...base, idHistorico: 'a' }, d);
    expect(lista).toHaveLength(1);
    expect(apostasFeitas(lista)).toHaveLength(0);
    expect(expostoJogo(lista, base)).toBe(0);
  });

  it('aposta sem valor em R$ não conta (não há exposição medida)', () => {
    const semValor = { ...aposta(0), valor: undefined } as unknown as ReturnType<typeof aposta>;
    const { lista } = registrar([], base, semValor, 'a');
    expect(expostoJogo(lista, base)).toBe(0);
  });

  it('sem o jogo informado, as travas não trazem exposição por jogo (comportamento antigo)', () => {
    const { lista } = registrar([], base, aposta(0), 'a');
    expect(travasDoHistorico(lista, 1000, NOW).expostoJogo).toBeUndefined();
  });
});

describe('registros repetidos não contam em dobro', () => {
  it('a mesma aposta (casa + mercado + seleção) registrada de novo é ignorada', () => {
    const a = registrar([], base, aposta(0), 'a');
    const de_novo = registrar(a.lista, base, aposta(0), a.id);
    expect(de_novo.lista).toBe(a.lista);
    expect(de_novo.lista).toHaveLength(1);
    expect(expostoJogo(de_novo.lista, base)).toBeCloseTo(0.01, 12);
    expect(travasDoHistorico(de_novo.lista, 1000, NOW).expostoHoje).toBeCloseTo(0.01, 12);
  });

  it('com a casa escrita de outro jeito ("1WIN") continua sendo a mesma aposta', () => {
    const a = registrar([], base, aposta(0), 'a');
    const de_novo = registrar(a.lista, base, aposta(0, 10, '1WIN'), a.id);
    expect(de_novo.lista).toHaveLength(1);
  });

  it('repetir uma irmã também é ignorado', () => {
    const a = registrar([], base, aposta(0), 'a');
    const b = registrar(a.lista, base, aposta(3), a.id);
    const c = registrar(b.lista, base, aposta(3, 99), a.id);
    expect(c.lista).toHaveLength(2);
    expect(expostoJogo(c.lista, base)).toBeCloseTo(0.02, 12);
  });

  it('o mesmo mercado em OUTRO jogo é outra aposta', () => {
    const a = registrar([], base, aposta(0), 'a');
    const b = registrar(a.lista, jogoDe('Palmeiras', 'Santos'), aposta(0), 'b');
    expect(b.lista).toHaveLength(2);
  });
});

describe('o dia conta TODAS as apostas registradas, inclusive as do jogo aberto', () => {
  it('teto diário parcialmente consumido por jogos diferentes', () => {
    let lista: EntradaHistorico[] = [];
    lista = registrar(lista, base, aposta(0, 10), 'a').lista;
    lista = registrar(lista, jogoDe('Palmeiras', 'Santos'), aposta(0, 20), 'b').lista;
    lista = registrar(lista, jogoDe('Gremio', 'Inter'), aposta(0, 30), 'c').lista;
    const t = travasDoHistorico(lista, 1000, NOW);
    expect(t.expostoHoje).toBeCloseTo(0.06, 12);
  });

  it('a aposta da análise aberta entra no dia (antes era ignorada e só as irmãs contavam)', () => {
    const a = registrar([], base, aposta(0, 10), 'a');
    const b = registrar(a.lista, base, aposta(3, 10), a.id);
    // a lista inteira, sem tirar a análise aberta: as duas apostas contam
    expect(travasDoHistorico(b.lista, 1000, NOW).expostoHoje).toBeCloseTo(0.02, 12);
    // o jeito antigo (filtrar a análise aberta) deixava só a irmã e subestimava
    expect(
      travasDoHistorico(
        b.lista.filter((e) => e.id !== 'a'),
        1000,
        NOW,
      ).expostoHoje,
    ).toBeCloseTo(0.01, 12);
  });
});

describe('múltiplas que incluem o jogo', () => {
  const perna = (jogo: string, inicio = '2099-10-26T20:00:00-03:00') => ({
    jogo,
    inicio,
    linha: base.odds[0],
    descricao: 'x',
    odd: 1.5,
    casa: '1win',
    chanceGreen: 0.7,
    ev: 0.02,
    temEstimativa: true,
  });
  const multipla = (valor: number | undefined, ...jogos: string[]): Multipla => ({
    id: `m-${jogos.join('-')}`,
    criadaEm: '2099-10-26T09:00:00-03:00',
    odd: 3,
    casa: '1win',
    valor,
    pernas: jogos.map((j) => perna(j)),
  });
  const jogo = { casa: 'Flamengo', fora: 'Vasco', data: '2099-10-26' };

  it('o valor todo do bilhete conta no jogo de cada perna (limite superior conservador)', () => {
    const lista = [multipla(10, 'Flamengo × Vasco', 'Palmeiras × Santos')];
    expect(valorDeMultiplasNoJogo(lista, jogo)).toBe(10);
    expect(
      valorDeMultiplasNoJogo(lista, { casa: 'Palmeiras', fora: 'Santos', data: '2099-10-26' }),
    ).toBe(10);
  });

  it('múltipla de outros jogos, sem valor ou de outra data não conta', () => {
    expect(
      valorDeMultiplasNoJogo([multipla(10, 'Gremio × Inter', 'Palmeiras × Santos')], jogo),
    ).toBe(0);
    expect(valorDeMultiplasNoJogo([multipla(undefined, 'Flamengo × Vasco')], jogo)).toBe(0);
    expect(
      valorDeMultiplasNoJogo(
        [
          {
            ...multipla(10, 'Flamengo × Vasco'),
            pernas: [perna('Flamengo × Vasco', '2099-10-27T20:00:00-03:00')],
          },
        ],
        jogo,
      ),
    ).toBe(0);
  });

  it('variação de nome na perna ainda é o mesmo jogo, e soma com as apostas simples', () => {
    const a = registrar([], base, aposta(0, 10), 'a');
    const m = valorDeMultiplasNoJogo([multipla(10, 'FLAMENGO × vasco')], jogo);
    expect(m).toBe(10);
    expect(expostoJogo(a.lista, base, m)).toBeCloseTo(0.02, 12);
  });

  it('o dia conta a múltipla uma vez só (não uma por perna)', () => {
    const extras = [{ feitaEm: '2099-10-26T09:00:00-03:00', stake: 10 }];
    expect(travasDoHistorico([], 1000, NOW, extras).expostoHoje).toBeCloseTo(0.01, 12);
  });
});

describe('exposicaoNoJogo (banca zerada ou inválida)', () => {
  it('banca zero: qualquer aposta no jogo vira exposição total (conservador)', () => {
    const a = registrar([], base, aposta(0), 'a');
    expect(
      exposicaoNoJogo(a.lista, { casa: 'Flamengo', fora: 'Vasco', data: '2099-10-26' }, 0, 0),
    ).toBe(1);
    expect(exposicaoNoJogo([], { casa: 'Flamengo', fora: 'Vasco', data: '2099-10-26' }, 0, 0)).toBe(
      0,
    );
  });
});

describe('chaves já registradas no jogo (a lista não as conta de novo)', () => {
  it('traz casa#seleção das apostas do evento, em qualquer análise dele, e só dele', () => {
    const a = registrar([], base, aposta(0), 'analise-1');
    const b = registrar(a.lista, jogoDe('Flamengo FC', 'vasco'), aposta(3), 'analise-2');
    const c = registrar(b.lista, jogoDe('Palmeiras', 'Santos'), aposta(2), 'outro');
    const chaves = chavesRegistradasNoJogo(c.lista, {
      casa: 'Flamengo',
      fora: 'Vasco',
      data: '2099-10-26',
    });
    expect(chaves).toHaveLength(2);
    expect(chaves.every((k) => k.startsWith('1win#'))).toBe(true);
  });

  it('análise salva sem "Entrei" não gera chave', () => {
    const { lista } = salvarNoHistorico([], { ...base, idHistorico: 'a' }, d);
    expect(
      chavesRegistradasNoJogo(lista, { casa: 'Flamengo', fora: 'Vasco', data: '2099-10-26' }),
    ).toEqual([]);
  });
});
