/**
 * Prompt de análise pré-live A1–A4 (claude.ts): estrutura, origem exata de cada probabilidade,
 * amplitude entre operadores (disponível e indisponível), unidades e preservação do motor.
 */
import {
  ajustarLambdaModelo,
  criarLiquidador,
  criarModelo,
  DISPERSAO,
  distribuicaoModelo,
  FRACAO_1T,
  matrizContagem,
  matrizPlacares,
  pmfContagem,
  poissonPmf,
  resolverCasa,
  RHO_PADRAO,
  type AvaliacaoV4,
  type Liquidador,
  type LinhaOdd,
} from '@pe/engine';
import { describe, expect, it } from 'vitest';
import {
  amplitudeDoCandidato,
  descricaoLambda,
  estadoDoLambda,
  INDISPONIVEL,
  montarPromptClaude,
  ORIGEM_INDISPONIVEL,
  origemPModelo,
} from '../src/claude';
import { derivar, type Derivado } from '../src/dados';
import { rascunhoExemplo } from '../src/exemplo';

const base = () => {
  const r = rascunhoExemplo();
  return { r, d: derivar(r) };
};
/** candidato com EV > 0 do exemplo (Mais de 2,5 @ 1,84 na Superbet, R1 Pinnacle) */
const candidato = (d: Derivado) => d.v4!.top5.find((a) => a.ev > 0)!;
const secao = (texto: string, de: string, ate: string) =>
  texto.slice(texto.indexOf(de), ate ? texto.indexOf(ate) : undefined);
const liqDe = (l: Partial<LinhaOdd>): Liquidador => {
  const r = criarLiquidador({ casa: 'x', periodo: 'FT', odd: 1.9, ...l } as LinhaOdd);
  if (!r.ok) throw new Error(r.motivo);
  return r.liq;
};
const ehOver25 = (o: LinhaOdd) => o.mercado === 'total' && o.periodo === 'FT' && o.linha === 2.5;
/**
 * Troca a Bet365 do exemplo por duas marcas de um mesmo operador (todas as linhas copiadas, para
 * os mercados ficarem completos) e muda o Mais/Menos de 2,5 de cada uma.
 */
function duasMarcas(
  d: Derivado,
  marcas: [string, string],
  over25: [{ over: number; under: number }, { over: number; under: number }],
  mudarHorario?: (iso?: string) => string | undefined,
): Derivado {
  const bet365 = d.oddsValidas.filter((o) => o.casa === 'Bet365');
  const copia = (nome: string, k: 0 | 1) =>
    bet365.map((o) => {
      const odd = ehOver25(o) ? (o.lado === 'over' ? over25[k].over : over25[k].under) : o.odd;
      return {
        ...o,
        casa: nome,
        odd,
        horarioColeta: k === 1 && mudarHorario ? mudarHorario(o.horarioColeta) : o.horarioColeta,
      };
    });
  return {
    ...d,
    oddsValidas: [
      ...d.oddsValidas.filter((o) => o.casa !== 'Bet365'),
      ...copia(marcas[0], 0),
      ...copia(marcas[1], 1),
    ],
  };
}

describe('estrutura e regras', () => {
  it('V4 primeiro, lista informativa por último, pedido no fim — nesta ordem', () => {
    const { r, d } = base();
    const t = montarPromptClaude(r, d);
    const ordem = [
      'REGRAS',
      '1 · DECISÃO OFICIAL V4.0',
      '2 · ORIGEM DA VANTAGEM',
      '3 · ENTRADAS DO MODELO',
      '4 · INCERTEZA E QUALIDADE',
      '5 · CONTEXTO',
      '6 · LISTA "MELHORES ENTRADAS" — EXCLUSIVAMENTE INFORMATIVA, SEM RECOMENDAÇÃO DE STAKE',
      'PEDIDO DE ANÁLISE',
    ].map((s) => t.indexOf(s));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });
  it('regras aprovadas: ±10% é parâmetro, filtro inativo, lista sem stake, proibido estimar', () => {
    const { r, d } = base();
    const t = montarPromptClaude(r, d);
    expect(t).toContain(
      'A faixa de ±10% do λ é um parâmetro fixo do sistema, NÃO um intervalo de confiança.',
    );
    expect(t).toContain(
      '- Faixa de ±10% no λ: parâmetro fixo do sistema; NÃO é intervalo de confiança nem incerteza estimada pela amostra',
    );
    expect(t).toContain('O filtro de discordância do modelo está INATIVO');
    expect(t).toContain('NÃO é recomendação de aposta nem de stake');
    expect(t).toContain(`"${ORIGEM_INDISPONIVEL}" ou "${INDISPONIVEL}", repita isso: não estime`);
  });
});

describe('origem exata de cada probabilidade', () => {
  it('P_true copia o fonteP do motor, literalmente', () => {
    const { r, d } = base();
    const a = candidato(d);
    expect(montarPromptClaude(r, d)).toContain(`— origem: ${a.fonteP}`);
  });
  it('fonteP vazio → ORIGEM INDISPONÍVEL, sem inventar', () => {
    const { r, d } = base();
    const top5 = d.v4!.top5.map((a, i) => (i === 0 ? { ...a, fonteP: '' } : a));
    const t = montarPromptClaude(r, { ...d, v4: { ...d.v4!, top5 } });
    expect(t).toContain(
      `· P_true ${(top5[0].pTrue * 100).toFixed(1).replace('.', ',')}% — origem: ${ORIGEM_INDISPONIVEL}`,
    );
  });
  it('P_modelo ausente → DADO INDISPONÍVEL; presente diz o modelo e o λ usados', () => {
    const { r, d } = base();
    expect(montarPromptClaude(r, d)).toContain(
      'origem: Poisson com ajuste Dixon-Coles (jogo todo), λ do modelo com: λ movido em direção ao λ do mercado pela regra 9.4',
    );
    const top5 = d.v4!.top5.map((a) => (a.ev > 0 ? { ...a, pModelo: null } : a));
    const t = montarPromptClaude(r, { ...d, v4: { ...d.v4!, top5 } });
    expect(t).toContain(`· P_modelo: ${INDISPONIVEL} (sem modelo para este mercado)`);
  });
  it('sem liquidador ou sem λ: ORIGEM INDISPONÍVEL', () => {
    const { d } = base();
    expect(origemPModelo(d, null)).toBe(ORIGEM_INDISPONIVEL);
    expect(
      origemPModelo({ ...d, lambda: null }, liqDe({ mercado: 'total', lado: 'over', linha: 2.5 })),
    ).toBe(ORIGEM_INDISPONIVEL);
  });
  it('sem V4 (pendências): decisão indisponível, com as pendências', () => {
    const { r, d } = base();
    const t = montarPromptClaude(r, { ...d, v4: null, pendenciasV4: ['Jogo: preencher a hora'] });
    expect(t).toContain(`- Decisão: ${INDISPONIVEL} (pendências: Jogo: preencher a hora)`);
  });
});

describe('P2 — o modelo de cada tipo de mercado', () => {
  it('escanteios: modelo de contagem (binomial negativa), nunca Poisson/Dixon-Coles', () => {
    const { d } = base();
    const o = origemPModelo(d, liqDe({ mercado: 'escanteios_total', lado: 'over', linha: 9.5 }));
    expect(
      o.startsWith(
        'modelo de contagem (binomial negativa por time, times independentes, variância = 1,25 × média; λ de escanteios ',
      ),
    ).toBe(true);
    expect(o).toContain('sem checagem contra o mercado');
    expect(o).not.toMatch(/Poisson|Dixon-Coles/);
  });
  it('cartões: modelo de contagem com o λ de cartões amarelos', () => {
    const { d } = base();
    const o = origemPModelo(d, liqDe({ mercado: 'cartoes_total', lado: 'over', linha: 3.5 }));
    expect(
      o.startsWith(
        'modelo de contagem (binomial negativa por time, times independentes, variância = 1,6 × média; λ de cartões amarelos ',
      ),
    ).toBe(true);
    expect(o).not.toMatch(/Poisson|Dixon-Coles/);
  });
  it('1º escanteio: chance de nenhum e divisão proporcional aos λ de escanteios', () => {
    const { d } = base();
    const o = origemPModelo(d, liqDe({ mercado: 'primeiro_escanteio', lado: 'casa' }));
    expect(
      o.startsWith(
        'modelo de contagem (binomial negativa por time, times independentes, variância = 1,25 × média): chance de nenhum',
      ),
    ).toBe(true);
    expect(o).not.toMatch(/Poisson|Dixon-Coles/);
  });
  it('contagem sem o λ da estatística: ORIGEM INDISPONÍVEL', () => {
    const { d } = base();
    expect(
      origemPModelo(
        { ...d, contagens: {} },
        liqDe({ mercado: 'escanteios_total', lado: 'over', linha: 9.5 }),
      ),
    ).toBe(ORIGEM_INDISPONIVEL);
  });
  it('gols por tempo: Poisson independente, sem Dixon-Coles', () => {
    const { d } = base();
    const o = origemPModelo(
      d,
      liqDe({ mercado: 'total', periodo: '1T', lado: 'over', linha: 0.5 }),
    );
    expect(
      o.startsWith(
        'Poisson independente do 1º tempo (sem Dixon-Coles; λ do jogo × fração do 1º tempo)',
      ),
    ).toBe(true);
  });
  it('na seção 2, candidato de escanteios mostra o modelo de contagem', () => {
    const { r, d } = base();
    const liq = liqDe({ mercado: 'escanteios_total', lado: 'over', linha: 9.5 });
    const top5 = d.v4!.top5.map((a) => (a.ev > 0 ? { ...a, liq } : a));
    const s2 = secao(
      montarPromptClaude(r, { ...d, v4: { ...d.v4!, top5 } }),
      '2 · ORIGEM',
      '3 · ENTRADAS',
    );
    expect(s2).toMatch(/P_modelo .* — origem: modelo de contagem \(binomial negativa/);
    expect(s2).not.toMatch(/Dixon-Coles/);
  });
});

describe('P2 — cada texto corresponde à conta que distribuicaoModelo executa', () => {
  // o mesmo modelo que a V4 monta: λ do apoio, ρ e fração do 1º tempo padrão, λ de contagem
  const modeloDoApoio = (d: Derivado) =>
    criarModelo(
      d.resultado!.lambdaModelo.ajustado,
      RHO_PADRAO,
      FRACAO_1T,
      Object.fromEntries(Object.entries(d.contagens).map(([e, c]) => [e, c!.lambdas])),
    );
  it('placar do jogo todo: matriz Dixon-Coles (difere da Poisson independente)', () => {
    const { d } = base();
    const { casa, fora } = d.resultado!.lambdaModelo.ajustado;
    // Mais de 1,5: inclui o 1-1, que o Dixon-Coles altera (no Mais de 2,5 as correções do
    // 0-0, 1-0, 0-1 e 1-1 se anulam e o resultado é o mesmo da Poisson independente)
    const liq = liqDe({ mercado: 'total', lado: 'over', linha: 1.5 });
    const p = distribuicaoModelo(liq, modeloDoApoio(d)).ganho;
    const acima = (m: number[][]) =>
      m.reduce((s, l, i) => s + l.reduce((t, x, j) => t + (i + j > 1 ? x : 0), 0), 0);
    expect(p).toBeCloseTo(acima(matrizPlacares(casa, fora, RHO_PADRAO)), 12);
    expect(Math.abs(p - acima(matrizPlacares(casa, fora, 0)))).toBeGreaterThan(1e-6);
    expect(origemPModelo(d, liq).startsWith('Poisson com ajuste Dixon-Coles (jogo todo)')).toBe(
      true,
    );
  });
  it('placar do 1º tempo: Poisson independente com λ × fração do 1º tempo', () => {
    const { d } = base();
    const { casa, fora } = d.resultado!.lambdaModelo.ajustado;
    const liq = liqDe({ mercado: 'total', periodo: '1T', lado: 'over', linha: 0.5 });
    const p = distribuicaoModelo(liq, modeloDoApoio(d)).ganho;
    const zeroZero = poissonPmf(0, casa * FRACAO_1T) * poissonPmf(0, fora * FRACAO_1T);
    // a matriz do motor é truncada e renormalizada: diferença da ordem de 1e-9
    expect(p).toBeCloseTo(1 - zeroZero, 7);
    expect(
      origemPModelo(d, liq).startsWith(
        'Poisson independente do 1º tempo (sem Dixon-Coles; λ do jogo × fração do 1º tempo)',
      ),
    ).toBe(true);
  });
  it('placar do 2º tempo: λ × (1 − fração do 1º tempo)', () => {
    const { d } = base();
    const { casa, fora } = d.resultado!.lambdaModelo.ajustado;
    const liq = liqDe({ mercado: 'total', periodo: '2T', lado: 'over', linha: 0.5 });
    const p = distribuicaoModelo(liq, modeloDoApoio(d)).ganho;
    const f2 = 1 - FRACAO_1T;
    expect(p).toBeCloseTo(1 - poissonPmf(0, casa * f2) * poissonPmf(0, fora * f2), 7);
    expect(origemPModelo(d, liq)).toContain('λ do jogo × (1 − fração do 1º tempo)');
  });
  it('tempos combinados (intervalo/final): liquidador "tempos", Poisson independente por tempo', () => {
    const { d } = base();
    const liq = liqDe({ mercado: 'intervalo_final', lado: '1/1' });
    expect(liq.tipo).toBe('tempos');
    // confronto numérico: 1º e 2º tempos INDEPENDENTES, cada um Poisson sem Dixon-Coles com
    // λ × fração do tempo. O motor monta cada tempo com matrizPlacares(…, ρ = 0, MAX_GOLS_TEMPO),
    // MAX_GOLS_TEMPO = 10 em mercados.ts (não exportada): o mesmo cálculo é refeito aqui.
    const { casa, fora } = d.resultado!.lambdaModelo.ajustado;
    const t1 = matrizPlacares(casa * FRACAO_1T, fora * FRACAO_1T, 0, 10);
    const t2 = matrizPlacares(casa * (1 - FRACAO_1T), fora * (1 - FRACAO_1T), 0, 10);
    let esperado = 0; // intervalo 1 / final 1: mandante à frente no intervalo e vence o jogo
    t1.forEach((l1, c1) =>
      l1.forEach((p1, f1) =>
        t2.forEach((l2, c2) =>
          l2.forEach((p2, f2) => {
            if (c1 > f1 && c1 + c2 > f1 + f2) esperado += p1 * p2;
          }),
        ),
      ),
    );
    const motor = distribuicaoModelo(liq, modeloDoApoio(d)).ganho;
    // o motor pula células com p1 < 1e-12 e p < 1e-15 (mercados.ts, tipo 'tempos'): a soma
    // completa difere na ordem de 1e-12, por isso a precisão de 1e-11
    expect(motor).toBeCloseTo(esperado, 11);
    // fórmula fechada que só vale com tempos independentes: mandante marca nos dois tempos
    const doisTempos = liqDe({ mercado: 'marcar_2_tempos', time: 'casa', lado: 'sim' });
    expect(doisTempos.tipo).toBe('tempos');
    const fechada = (1 - Math.exp(-casa * FRACAO_1T)) * (1 - Math.exp(-casa * (1 - FRACAO_1T)));
    // a matriz do motor vai até 10 gols por tempo e é renormalizada: diferença da ordem de 1e-9
    expect(distribuicaoModelo(doisTempos, modeloDoApoio(d)).ganho).toBeCloseTo(fechada, 7);
    expect(
      origemPModelo(d, liq).startsWith(
        'Poisson independente por tempo (sem Dixon-Coles; λ do jogo × fração de cada tempo; 1º e 2º combinados)',
      ),
    ).toBe(true);
  });
  it('1º e último gol: P(0-0) da matriz Dixon-Coles e divisão pelos λ (a mesma para os dois)', () => {
    const { d } = base();
    const { casa, fora } = d.resultado!.lambdaModelo.ajustado;
    const m = modeloDoApoio(d);
    const p00 = matrizPlacares(casa, fora, RHO_PADRAO)[0][0];
    const esperado = (1 - p00) * (casa / (casa + fora));
    const primeiro = liqDe({ mercado: 'primeiro_gol', lado: 'casa' });
    const ultimo = liqDe({ mercado: 'ultimo_gol', lado: 'casa' });
    expect(distribuicaoModelo(primeiro, m).ganho).toBeCloseTo(esperado, 12);
    expect(distribuicaoModelo(ultimo, m).ganho).toBeCloseTo(esperado, 12);
    expect(
      distribuicaoModelo(liqDe({ mercado: 'primeiro_gol', lado: 'nenhum' }), m).ganho,
    ).toBeCloseTo(p00, 12);
    // o 0-0 é o da matriz Dixon-Coles, não o da Poisson independente
    expect(Math.abs(p00 - Math.exp(-(casa + fora)))).toBeGreaterThan(1e-6);
    expect(origemPModelo(d, primeiro)).toBe(origemPModelo(d, ultimo));
    expect(
      origemPModelo(d, primeiro).startsWith(
        'chance de nenhum gol = P(0-0) da matriz Dixon-Coles do jogo todo; havendo gol, divisão proporcional aos λ',
      ),
    ).toBe(true);
  });
  it('escanteios: matrizContagem com binomial negativa (variância = 1,25 × média)', () => {
    const { d } = base();
    const lc = d.contagens.escanteios!.lambdas;
    const liq = liqDe({ mercado: 'escanteios_total', lado: 'over', linha: 9.5 });
    const p = distribuicaoModelo(liq, modeloDoApoio(d)).ganho;
    const mat = matrizContagem('escanteios', lc);
    const acima = mat.reduce((s, l, i) => s + l.reduce((t, x, j) => t + (i + j > 9 ? x : 0), 0), 0);
    expect(p).toBeCloseTo(acima, 12);
    const pmf = pmfContagem(lc.casa, DISPERSAO.escanteios, 30);
    const media = pmf.reduce((s, x, k) => s + k * x, 0);
    const variancia = pmf.reduce((s, x, k) => s + (k - media) ** 2 * x, 0);
    expect(variancia / media).toBeCloseTo(DISPERSAO.escanteios, 2);
    expect(origemPModelo(d, liq)).toContain(
      'binomial negativa por time, times independentes, variância = 1,25 × média',
    );
  });
  it('cartões: binomial negativa com a dispersão dos cartões (1,6)', () => {
    const { d } = base();
    const liq = liqDe({ mercado: 'cartoes_total', lado: 'over', linha: 3.5 });
    const p = distribuicaoModelo(liq, modeloDoApoio(d)).ganho;
    const mat = matrizContagem('cartoes', d.contagens.cartoes!.lambdas);
    const acima = mat.reduce((s, l, i) => s + l.reduce((t, x, j) => t + (i + j > 3 ? x : 0), 0), 0);
    expect(p).toBeCloseTo(acima, 12);
    expect(origemPModelo(d, liq)).toContain('variância = 1,6 × média');
  });
  it('1º escanteio: P(0 × 0) da matriz de contagem, divisão pelos λ, devolve sem escanteio', () => {
    const { d } = base();
    const lc = d.contagens.escanteios!.lambdas;
    const liq = liqDe({ mercado: 'primeiro_escanteio', lado: 'casa' });
    const dist = distribuicaoModelo(liq, modeloDoApoio(d));
    const p0 = matrizContagem('escanteios', lc)[0][0];
    expect(dist.ganho).toBeCloseTo((1 - p0) * (lc.casa / (lc.casa + lc.fora)), 12);
    expect(dist.push).toBeCloseTo(p0, 12);
    expect(origemPModelo(d, liq)).toContain(
      'chance de nenhum = P(0 × 0) da matriz do jogo todo; havendo, divisão proporcional aos λ; sem nenhum, aposta em mandante ou visitante é devolvida',
    );
  });
});

describe('P6 — peso da mistura na lista', () => {
  const entrada = (linha?: Partial<LinhaOdd>) =>
    ({
      descricao: 'Ganha se: X',
      odd: 1.9,
      casa: 'Bet365',
      chance: 0.56,
      minimo: 1 / 1.9,
      pModelo: 0.58,
      pMercado: 0.55,
      referenciaAfiada: false,
      stake: 0.01,
      linha: linha
        ? ({ casa: 'Bet365', periodo: 'FT', odd: 1.9, ...linha } as LinhaOdd)
        : undefined,
    }) as never;
  const lista = (d: Derivado, e: never) =>
    ({ ...d, entradas: { status: 'ok', entradas: [e], recusadas: [] } as never }) as Derivado;
  it('escanteios e cartões: teto de 0,3 descrito, com o modelo de contagem', () => {
    const { r, d } = base();
    const t = montarPromptClaude(
      r,
      lista(d, entrada({ mercado: 'escanteios_total', lado: 'over', linha: 9.5 })),
    );
    expect(t).toContain(
      `w = o menor entre o peso pela DQ ${d.dq.dq} e 0,3 (teto de escanteios e cartões)`,
    );
    expect(secao(t, '6 · LISTA', 'PEDIDO')).toMatch(/P_modelo 58,0% \(modelo de contagem/);
  });
  it('gols: sem teto, e o modelo de gols', () => {
    const { r, d } = base();
    const t = montarPromptClaude(
      r,
      lista(d, entrada({ mercado: 'total', lado: 'over', linha: 2.5 })),
    );
    expect(t).toContain(`w = peso pela DQ ${d.dq.dq};`);
    expect(t).not.toContain('teto de escanteios');
    expect(secao(t, '6 · LISTA', 'PEDIDO')).toMatch(
      /P_modelo 58,0% \(Poisson com ajuste Dixon-Coles/,
    );
  });
  it('sem a linha da entrada: peso e origem indisponíveis', () => {
    const { r, d } = base();
    const t = montarPromptClaude(r, lista(d, entrada()));
    expect(t).toContain(`com w: ${ORIGEM_INDISPONIVEL}; P_modelo 58,0% (${ORIGEM_INDISPONIVEL})`);
  });
});

describe('P3 — o que aconteceu com o λ (9.4 e 16.3)', () => {
  const comAjuste = (
    d: Derivado,
    original: { casa: number; fora: number },
    aj: { lambdas: { casa: number; fora: number }; ajustes: string[] },
  ): Derivado => ({
    ...d,
    resultado: {
      ...d.resultado!,
      lambdaModelo: { original, ajustado: aj.lambdas, ajustes: aj.ajustes },
    },
  });
  it('exemplo real: a 9.4 moveu o λ', () => {
    const { d } = base();
    expect(estadoDoLambda(d)).toEqual({ tipo: 'ajustes', itens: ['9.4'] });
  });
  it('sem λ do mercado (só o 1X2 coletado): checagem 9.4 NÃO executada', () => {
    const r = rascunhoExemplo();
    const so1x2 = { ...r, odds: r.odds.filter((o) => o.mercado === '1X2') };
    const d = derivar(so1x2);
    expect(d.resultado).not.toBeNull();
    expect(d.resultado!.lambdaMercado).toBeNull();
    expect(estadoDoLambda(d)).toMatchObject({ tipo: 'nao-executada' });
    // a causa é o erro que o próprio motor gravou em dq.motivos, citado literalmente
    expect(descricaoLambda(d)).toBe(
      'λ bruto do modelo (checagem 9.4 NÃO executada: o motor não ajustou o λ do mercado: "λ_market exige várias linhas sem margem (1X2 + totais e/ou gols por time). Nunca uma linha só.")',
    );
  });
  it('sem λ do mercado e sem o motivo gravado: NÃO executada, motivo indisponível', () => {
    const { d } = base();
    const original = d.lambda!.lambdas;
    const semMotivo: Derivado = {
      ...d,
      resultado: {
        ...d.resultado!,
        lambdaMercado: null,
        dq: { ...d.resultado!.dq, motivos: [] },
        lambdaModelo: { original, ajustado: original, ajustes: [] },
      },
    };
    expect(descricaoLambda(semMotivo)).toBe(
      `λ bruto do modelo (checagem 9.4 NÃO executada; motivo ${INDISPONIVEL})`,
    );
  });
  it('jogo já iniciado (caminho real do motor): a causa vem do motivo gravado', () => {
    const r = rascunhoExemplo();
    const passado = { ...r, jogo: { ...r.jogo, data: '2020-01-01' } };
    const d = derivar(passado);
    expect(d.resultado!.decisao).toBe('EXCLUIDO');
    expect(descricaoLambda(d)).toBe(
      'λ bruto do modelo (checagem 9.4 NÃO executada: jogo iniciado ou encerrado (a análise de apoio só roda pré-live))',
    );
  });
  it('EXCLUIDO sem o motivo do motor: NÃO executada, motivo indisponível (não presume)', () => {
    const { d } = base();
    const original = d.lambda!.lambdas;
    const excluido: Derivado = {
      ...d,
      resultado: {
        ...d.resultado!,
        decisao: 'EXCLUIDO',
        motivos: [],
        lambdaMercado: null,
        lambdaModelo: { original, ajustado: original, ajustes: [] },
      },
    };
    expect(descricaoLambda(excluido)).toBe(
      `λ bruto do modelo (checagem 9.4 NÃO executada; motivo ${INDISPONIVEL})`,
    );
  });
  it('sem a análise de apoio (caminho real: hora não preenchida): cita as pendências', () => {
    const r = rascunhoExemplo();
    const semHora = { ...r, jogo: { ...r.jogo, hora: '' } };
    const d = derivar(semHora);
    expect(d.lambda).not.toBeNull();
    expect(d.resultado).toBeNull();
    expect(d.pendencias.length).toBeGreaterThan(0);
    expect(descricaoLambda(d)).toBe(
      `λ bruto do modelo (checagem 9.4 NÃO executada: a análise de apoio não rodou; pendências: ${d.pendencias.join('; ')})`,
    );
  });
  it('sem a análise de apoio e sem pendências registradas: motivo indisponível', () => {
    const { d } = base();
    expect(descricaoLambda({ ...d, resultado: null, pendencias: [] })).toBe(
      `λ bruto do modelo (checagem 9.4 NÃO executada; motivo ${INDISPONIVEL})`,
    );
  });
  it('16.3 (texto real do motor): supremacia trocada, não "9.4"', () => {
    const { d } = base();
    const original = { casa: 1.3, fora: 1.0 };
    const aj = ajustarLambdaModelo(
      original,
      { casa: 1.8, fora: 0.8 },
      { favoritoLigaMaisForte: true },
    );
    expect(aj.ajustes).toHaveLength(1);
    const d16 = comAjuste(d, original, aj);
    expect(estadoDoLambda(d16)).toEqual({ tipo: 'ajustes', itens: ['16.3'] });
    expect(descricaoLambda(d16)).toContain('regra 16.3');
    expect(descricaoLambda(d16)).not.toContain('regra 9.4');
  });
  it('divergência mantida por fato concreto (texto real): o λ não mudou', () => {
    const { d } = base();
    const original = { casa: 2.5, fora: 0.5 };
    const aj = ajustarLambdaModelo(
      original,
      { casa: 1.5, fora: 1.0 },
      {
        explicacaoDivergencia: 'goleiro titular fora',
      },
    );
    expect(aj.lambdas).toEqual(original);
    const dm = comAjuste(d, original, aj);
    expect(estadoDoLambda(dm)).toEqual({ tipo: 'ajustes', itens: ['divergencia-mantida'] });
    expect(descricaoLambda(dm)).toContain('mantida por fato concreto (9.4, sem mover o λ)');
  });
  it('checagem executada sem ajuste', () => {
    const { d } = base();
    const original = { casa: 1.6, fora: 1.0 };
    const aj = ajustarLambdaModelo(original, { casa: 1.6, fora: 1.0 });
    expect(aj.ajustes).toEqual([]);
    expect(descricaoLambda(comAjuste(d, original, aj))).toBe(
      'λ do modelo (checagem 9.4 executada, sem ajuste)',
    );
  });
  it('texto de ajuste desconhecido ou números incoerentes: ORIGEM INDISPONÍVEL', () => {
    const { d } = base();
    const o = { casa: 1.6, fora: 1.0 };
    expect(
      descricaoLambda(comAjuste(d, o, { lambdas: o, ajustes: ['ajuste novo qualquer'] })),
    ).toContain(ORIGEM_INDISPONIVEL);
    expect(
      descricaoLambda(comAjuste(d, o, { lambdas: { casa: 1.7, fora: 1.0 }, ajustes: [] })),
    ).toContain(ORIGEM_INDISPONIVEL);
  });
});

describe('amplitude entre operadores (descritiva)', () => {
  it('disponível: 3 operadores, mesma remoção de margem da V4 (P_true da Pinnacle bate)', () => {
    const { d } = base();
    const a = candidato(d);
    const amp = amplitudeDoCandidato(d, a);
    expect(amp.disponivel).toBe(true);
    if (!amp.disponivel) return;
    expect(amp.operadores).toHaveLength(3);
    const pinnacle = amp.operadores.find((o) => o.operador === 'Pinnacle')!;
    expect(pinnacle.pJusta).toBeCloseTo(a.pTrue, 12);
    expect(amp.posicaoMelhor).toBe('abaixo');
  });
  it('no 1X2 (3 lados, Shin na V4) o preço justo da Pinnacle também é o P_true da V4', () => {
    const { d } = base();
    const a1x2 = d.v4!.avaliadas.find((a) => a.linha.mercado === '1X2' && a.nivel === 'R1')!;
    expect(a1x2.fonteP).toMatch(/shin/);
    const pinnacle = amplitudeDoCandidato(d, a1x2).casas.find((c) => c.casa === 'Pinnacle')!;
    expect(pinnacle.pJusta).toBeCloseTo(a1x2.pTrue, 12);
  });
  it('indisponível com menos de 3 operadores', () => {
    const { d } = base();
    const a = candidato(d);
    const amp = amplitudeDoCandidato(
      { ...d, oddsValidas: d.oddsValidas.filter((o) => o.casa !== 'Bet365') },
      a,
    );
    expect(amp).toMatchObject({ disponivel: false });
    if (!amp.disponivel) expect(amp.motivo).toMatch(/só 2 operador\(es\)/);
  });
  it('indisponível quando uma cotação não tem horário de coleta', () => {
    const { d } = base();
    const a = candidato(d);
    const amp = amplitudeDoCandidato(
      {
        ...d,
        oddsValidas: d.oddsValidas.map((o) =>
          o.casa === 'Bet365' ? { ...o, horarioColeta: undefined } : o,
        ),
      },
      a,
    );
    expect(amp).toMatchObject({ disponivel: false });
    if (!amp.disponivel) expect(amp.motivo).toMatch(/sem horário de coleta: Bet365/);
  });
  it('indisponível quando um operador inteiro foi coletado a mais de 10 min da melhor odd', () => {
    const { d } = base();
    const a = candidato(d);
    const mais30 = (iso?: string) =>
      iso ? new Date(Date.parse(iso) + 30 * 60_000).toISOString() : iso;
    const amp = amplitudeDoCandidato(
      {
        ...d,
        oddsValidas: d.oddsValidas.map((o) =>
          o.casa === 'Bet365' ? { ...o, horarioColeta: mais30(o.horarioColeta) } : o,
        ),
      },
      a,
    );
    expect(amp).toMatchObject({ disponivel: false });
    if (!amp.disponivel) expect(amp.motivo).toMatch(/a mais de 10 min da melhor odd: Bet365/);
  });
  it('seleção sem preços completos: indisponível, e o prompt não estima', () => {
    const { r, d } = base();
    const a = candidato(d);
    const semSelecao = { ...a, chave: 'inexistente' } as AvaliacaoV4;
    expect(amplitudeDoCandidato(d, semSelecao)).toMatchObject({ disponivel: false });
    const t = montarPromptClaude(r, { ...d, v4: { ...d.v4!, top5: [semSelecao] } });
    expect(t).toContain(
      `Amplitude entre operadores [descritivo, não entra na decisão]: ${INDISPONIVEL}`,
    );
    expect(t).toContain(`Preço justo por casa: ${INDISPONIVEL}`);
  });
  it('disponível no texto: faixa e posição da melhor odd', () => {
    const { r, d } = base();
    expect(montarPromptClaude(r, d)).toMatch(
      /Amplitude entre operadores \[descritivo, não entra na decisão\]: \d+,\d% a \d+,\d%; a melhor odd está ABAIXO da faixa dos outros operadores/,
    );
  });
});

describe('P1 — operador pela identidade real (operatorId)', () => {
  it('o registro tem as duas marcas de cada operador', () => {
    expect(resolverCasa('Betsul').operatorId).toBe(resolverCasa('CasaDeApostas').operatorId);
    expect(resolverCasa('Betfair Exchange').operatorId).toBe(
      resolverCasa('Betfair Sportsbook').operatorId,
    );
    expect(resolverCasa('Betsul').displayName).not.toBe(resolverCasa('CasaDeApostas').displayName);
  });
  it('Betsul/CasaDeApostas: um operador só, rótulo das duas marcas, melhor odd na 2ª marca achada', () => {
    const { d } = base();
    const a = candidato(d);
    const dm = duasMarcas(
      d,
      ['Betsul', 'CasaDeApostas'],
      [
        { over: 1.84, under: 2.2 },
        { over: 1.95, under: 1.8 },
      ],
    );
    const amp = amplitudeDoCandidato(dm, { ...a, casaMelhorOdd: 'CasaDeApostas', melhorOdd: 1.95 });
    expect(amp.disponivel).toBe(true);
    if (!amp.disponivel) return;
    expect(amp.operadores).toHaveLength(3);
    expect(amp.operadores.map((o) => o.operador)).toContain('Betsul/CasaDeApostas');
    // antes: o operador era achado pelo nome da 1ª marca e a posição caía em "dentro"
    expect(amp.posicaoMelhor).toBe('abaixo');
  });
  it('o operador da melhor odd fica fora da faixa das outras', () => {
    const { d } = base();
    const a = candidato(d);
    // CasaDeApostas acima dos outros; a Betsul (mesmo operador) mais acima ainda: se o
    // operador entrasse na faixa, a posição viraria "dentro"
    const dm = duasMarcas(
      d,
      ['Betsul', 'CasaDeApostas'],
      [
        { over: 1.55, under: 2.45 },
        { over: 1.6, under: 2.35 },
      ],
    );
    const amp = amplitudeDoCandidato(dm, { ...a, casaMelhorOdd: 'CasaDeApostas', melhorOdd: 1.6 });
    expect(amp).toMatchObject({ disponivel: true, posicaoMelhor: 'acima' });
  });
  it('Betfair Exchange/Betfair Sportsbook: um operador, identificado pela marca da melhor odd', () => {
    const { d } = base();
    const a = candidato(d);
    const dm = duasMarcas(
      d,
      ['Betfair Exchange', 'Betfair Sportsbook'],
      [
        { over: 1.84, under: 2.2 },
        { over: 1.95, under: 1.8 },
      ],
    );
    const amp = amplitudeDoCandidato(dm, {
      ...a,
      casaMelhorOdd: 'Betfair Sportsbook',
      melhorOdd: 1.95,
    });
    expect(amp.disponivel).toBe(true);
    if (!amp.disponivel) return;
    expect(amp.operadores).toHaveLength(3);
    expect(amp.operadores.map((o) => o.operador)).toContain('Betfair Exchange/Betfair Sportsbook');
    expect(amp.posicaoMelhor).toBe('abaixo');
  });
  it('casa da melhor odd fora do registro: posição INDISPONÍVEL, nunca "dentro"', () => {
    const { r, d } = base();
    const a = candidato(d);
    const desconhecida = d.oddsValidas
      .filter((o) => o.casa === 'Bet365')
      .map((o) => ({ ...o, casa: 'CasaQualquerXYZ' }));
    const dx = { ...d, oddsValidas: [...d.oddsValidas, ...desconhecida] };
    const ax = {
      ...a,
      casaMelhorOdd: 'CasaQualquerXYZ',
      melhorOdd: desconhecida.find(ehOver25)!.odd,
    };
    const ax2 = desconhecida.find((o) => ehOver25(o) && o.lado === 'over')!;
    const amp = amplitudeDoCandidato(dx, { ...ax, melhorOdd: ax2.odd });
    expect(amp).toMatchObject({ disponivel: true, posicaoMelhor: null });
    if (amp.disponivel) expect(amp.motivoPosicao).toMatch(/não está no registro de operadores/);
    const t = montarPromptClaude(r, {
      ...dx,
      v4: { ...dx.v4!, top5: [{ ...ax, melhorOdd: ax2.odd }] },
    });
    expect(t).toContain(`posição da melhor odd: ${INDISPONIVEL}`);
    expect(t).not.toContain('dentro da faixa');
  });
  it('cotação da melhor odd não encontrada: posição INDISPONÍVEL', () => {
    const { d } = base();
    const a = candidato(d);
    const amp = amplitudeDoCandidato(d, { ...a, melhorOdd: 9.99 });
    expect(amp).toMatchObject({ disponivel: true, posicaoMelhor: null });
  });
});

describe('P4 — janela aplicada a cada cotação', () => {
  it('marca fora da janela não entra na mediana do operador, mesmo com a outra marca dentro', () => {
    const { r, d } = base();
    const a = candidato(d);
    const mais30 = (iso?: string) =>
      iso ? new Date(Date.parse(iso) + 30 * 60_000).toISOString() : undefined;
    const dm = duasMarcas(
      d,
      ['Betsul', 'CasaDeApostas'],
      [
        { over: 1.84, under: 2.2 },
        { over: 1.4, under: 3.2 },
      ],
      mais30,
    );
    const amp = amplitudeDoCandidato(dm, a);
    expect(amp.disponivel).toBe(true);
    if (!amp.disponivel) return;
    const cda = amp.operadores.find((o) => o.operatorId === resolverCasa('Betsul').operatorId)!;
    const betsul = amp.casas.find((c) => c.casa === 'Betsul')!;
    expect(cda.operador).toBe('Betsul');
    expect(cda.pJusta).toBe(betsul.pJusta);
    expect(amp.excluidas).toEqual(['CasaDeApostas']);
    const t = montarPromptClaude(r, { ...dm, v4: { ...dm.v4!, top5: [a] } });
    expect(t).toContain('fora da janela de 10 min, excluídas da mediana: CasaDeApostas');
    expect(t).toMatch(/CasaDeApostas: \d+,\d% \(\d\d:\d\d, fora da janela\)/);
  });
});

describe('unidades', () => {
  it('odds e odd mínima em cotação decimal; probabilidades em %', () => {
    const { r, d } = base();
    const t = montarPromptClaude(r, d);
    const a = candidato(d);
    expect(t).toContain(`odd mínima ${a.oddMinima!.toFixed(2).replace('.', ',')}`);
    expect(t).not.toMatch(/odd mínima \d+,\d%/);
    expect(t).toContain(`@ ${a.melhorOdd.toFixed(2).replace('.', ',')} (${a.casaMelhorOdd})`);
  });
  it('lista: acerto mínimo em %, com a odd efetiva decimal de onde vem', () => {
    const { r, d } = base();
    const entrada = {
      descricao: 'Ganha se: X',
      odd: 1.9,
      casa: 'Bet365',
      chance: 0.56,
      minimo: 1 / 1.9,
      pModelo: 0.58,
      pMercado: 0.55,
      referenciaAfiada: false,
      stake: 0.01,
    } as never;
    const t = montarPromptClaude(r, {
      ...d,
      entradas: { status: 'ok', entradas: [entrada], recusadas: [] } as never,
    });
    expect(t).toContain('acerto mínimo exigido pela odd: 52,6% (= 1 ÷ odd efetiva 1,90)');
    expect(t).toContain('mediana de todas as casas, incluindo a da melhor odd');
    // a lista é informativa: nenhuma stake vai para o texto
    expect(secao(t, '6 · LISTA', 'PEDIDO DE ANÁLISE')).not.toMatch(/stake \d|1,0%|R\$/);
  });
});

describe('entradas do modelo × contexto', () => {
  it('estatística que não entra no cálculo vai só para o CONTEXTO', () => {
    const { r, d } = base();
    const posse = {
      ...d.tabela.xg!,
      casa: { ...d.tabela.xg!.casa, valor: 61 },
      fora: { ...d.tabela.xg!.fora, valor: 39 },
    };
    const t = montarPromptClaude(r, { ...d, tabela: { ...d.tabela, posse } });
    expect(secao(t, '3 · ENTRADAS DO MODELO', '4 · INCERTEZA')).not.toMatch(/Posse/);
    expect(secao(t, '5 · CONTEXTO', '6 · LISTA')).toMatch(/Posse.*61 × 39/);
  });
  it('as do modelo ficam na seção 3, com λ bruto, λ do apoio e a origem', () => {
    const { r, d } = base();
    const s3 = secao(montarPromptClaude(r, d), '3 · ENTRADAS DO MODELO', '4 · INCERTEZA');
    expect(s3).toMatch(/xG/);
    expect(s3).toMatch(/Partidas/);
    expect(s3).toMatch(
      /λ bruto: \d+,\d+ × \d+,\d+ · λ usado pelo apoio da V4: \d+,\d+ × \d+,\d+ · origem: λ do modelo com: λ movido/,
    );
    expect(s3).toContain('Período e competição: NÃO INFORMADO');
  });
});

describe('preservação: o prompt não altera nada do motor', () => {
  it('montar o prompt não muda o rascunho nem o resultado derivado', () => {
    const { r, d } = base();
    const antesR = JSON.stringify(r);
    const antesD = JSON.stringify(d);
    montarPromptClaude(r, d);
    expect(JSON.stringify(r)).toBe(antesR);
    expect(JSON.stringify(d)).toBe(antesD);
  });
  it('a decisão V4 e a lista são as mesmas com e sem o prompt', () => {
    const { r } = base();
    const d1 = derivar(r);
    montarPromptClaude(r, d1);
    const d2 = derivar(r);
    expect(d2.v4!.decisao).toBe(d1.v4!.decisao);
    expect(d2.v4!.top5.map((a) => [a.chave, a.pTrue, a.ev])).toEqual(
      d1.v4!.top5.map((a) => [a.chave, a.pTrue, a.ev]),
    );
    expect(JSON.stringify(d2.entradas)).toBe(JSON.stringify(d1.entradas));
  });
});
