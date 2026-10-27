/**
 * Ponta a ponta com os prints reais de Flamengo × Atlético-MG (Brasileirão, 26/10/2026):
 * OCR das estatísticas e das odds → cruzamento → λ → DQ → motor → análise escrita.
 */
import {
  analisarJogo,
  analisarV4,
  avaliarDQ,
  calcularLambdaContagem,
  calcularLambdaModelo,
  gerarRelatorio,
  relatorioEmTexto,
  type LinhaOdd,
} from '@pe/engine';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  consolidar,
  destaquesComparativos,
  estatisticasContagem,
  estatisticasParaModelo,
  juntarLinhas,
  lerDesfalques,
  lerEstatisticas,
  lerTextoFlashscore,
  parse1winVarios,
} from '../src';

const fx = (nome: string) =>
  readFileSync(new URL(`./fixtures-reais/${nome}`, import.meta.url), 'utf8');
const jogo = { casa: 'Flamengo', fora: 'Atlético-MG' };

const sofa = lerEstatisticas(
  fx('sofascore-comparacao-1.txt') + '\n' + fx('sofascore-comparacao-2.txt'),
  'sofascore',
  jogo,
);
const sup = lerEstatisticas(
  ['superscore-media-1.txt', 'superscore-media-2.txt', 'superscore-media-3.txt'].map(fx).join('\n'),
  'superscore',
  jogo,
);
// única correção manual: o "42" do Atlético que o OCR leu como "yp"
const tabela = consolidar({ sofascore: sofa, superscore: sup }, { 'golsMarcados.fora': 42 });
const mc = estatisticasParaModelo(tabela, 'casa');
const mf = estatisticasParaModelo(tabela, 'fora');
const lambda = calcularLambdaModelo(mc.stats!, mf.stats!);
// nível 3: cartões lidos dos dois times; escanteios do Flamengo ficaram ilegíveis ("ss")
const cartoes = calcularLambdaContagem(
  'cartoes',
  estatisticasContagem(tabela, 'casa', 'cartoes')!,
  estatisticasContagem(tabela, 'fora', 'cartoes')!,
);
const semEscanteios = estatisticasContagem(tabela, 'casa', 'escanteios');
const desfalques = lerDesfalques(fx('superscore-desfalques.txt'), jogo).desfalques;
const flash = lerTextoFlashscore(
  `Notícias da partida e forma atual
No Maracanã, o Flamengo soma 36 pontos em 15 jogos como mandante, com 11 vitórias, três empates e apenas uma derrota.
Em 15 jogos fora de casa, o Atlético conquistou apenas 15 pontos, com quatro vitórias, três empates e oito derrotas.
Duelo direto histórico
O Flamengo está invicto há cinco confrontos contra o Atlético pelo Brasileirão.`,
  jogo,
);
const odds = juntarLinhas(
  parse1winVarios(
    [
      '1win-principal-1.txt',
      '1win-totais-handicap.txt',
      '1win-handicap-ambas.txt',
      '1win-totais-por-time.txt',
      '1win-principal-3.txt',
      '1win-handicap-1t.txt',
      '1win-escanteios.txt',
      '1win-cartoes.txt',
    ].map(fx),
    { jogo, data: '2026-10-26', horarioPadrao: '2026-10-26T16:13:00-03:00' },
  ).linhas,
).linhas;

const dq = avaliarDQ({
  jogosMin: Math.min(mc.stats!.jogos, mf.stats!.jogos),
  temXg: true,
  temChutes: true,
  fontesStats: 3,
  desfalquesConhecidos: desfalques.length > 0,
  ligaTop: true,
  escalacaoProvavel: false,
});
const resultado = analisarJogo({
  jogo: { ...jogo, inicio: '2026-10-26T20:00:00-03:00' },
  agora: '2026-10-26T16:30:00-03:00',
  dq: dq.dq,
  lambdaModelo: lambda.lambdas,
  lambdasContagem: { cartoes: cartoes.lambdas },
  linhas: odds as LinhaOdd[],
  contexto: { priorNeutro: true },
  banca: 1000,
});
const rel = gerarRelatorio({
  resultado,
  jogo,
  destaquesStats: destaquesComparativos(tabela, jogo),
  contexto: flash.trechos,
  desfalques,
  dqMotivos: dq.motivos,
});

describe('Flamengo × Atlético-MG — análise completa com prints reais', () => {
  it('monta tudo e chega a uma decisão do protocolo', () => {
    console.log(
      `\nλ modelo ${lambda.lambdas.casa.toFixed(2)} × ${lambda.lambdas.fora.toFixed(2)} · λ mercado ${resultado.lambdaMercado?.casa.toFixed(2)} × ${resultado.lambdaMercado?.fora.toFixed(2)} · ${odds.length} odds · DQ ${dq.dq}→${resultado.dq.efetiva}\n\n` +
        relatorioEmTexto(rel),
    );
    expect(odds.length).toBeGreaterThan(80);
    expect(resultado.lambdaMercado).not.toBeNull();
    expect(['BET', 'WATCHLIST', 'INVESTIGAR', 'NO_BET']).toContain(resultado.decisao);
    // uma casa só → DQ no máximo C
    expect(resultado.dq.efetiva).toBe('C');
    // lição 3 de novo: o modelo encolhe o favorito; o "valor" no azarão é barrado pela divergência
    expect(resultado.decisao).toBe('NO_BET');
    expect(resultado.melhor?.tese).toBe('fora_resiste');
    // odds lidas corretamente não geram falso alarme de lado invertido
    expect(resultado.avisos.filter((a) => a.includes('invertido'))).toEqual([]);
  });
  it('nível 3: cartões entram no modelo; escanteios sem o dado dos dois times ficam de fora', () => {
    expect(semEscanteios).toBeNull();
    const v = resultado.varredura!;
    const cartoesAvaliados = v.avaliadas.filter((a) => a.linha.mercado.startsWith('cartoes'));
    expect(cartoesAvaliados.length).toBeGreaterThan(0);
    expect(cartoesAvaliados.every((a) => a.nivel === 3 && a.w !== null && a.w <= 0.3)).toBe(true);
    expect(
      v.descartados.some(
        (x) => x.chave.startsWith('escanteios_total') && x.motivo.includes('sem estatísticas'),
      ),
    ).toBe(true);
  });
  it('V4.0 com só a 1win: mercado principal fica R4 (sem referência), cartões como nicho R3', () => {
    const v4 = analisarV4({
      jogo: { ...jogo, inicio: '2026-10-26T20:00:00-03:00' },
      agora: '2026-10-26T16:30:00-03:00',
      linhas: odds as LinhaOdd[],
      ligaPrincipal: true,
      apoio: {
        lambdas: resultado.lambdaModelo.ajustado,
        contagens: { cartoes: cartoes.lambdas },
        dq: resultado.dq.efetiva,
        w: resultado.w,
        jogosMin: Math.min(mc.stats!.jogos, mf.stats!.jogos),
        priorNeutro: true,
      },
      banca: 1000,
    });
    console.log(`\nV4.0: ${v4.rotulo} · ${v4.motivos.join(' · ')}`);
    expect(v4.referencia.nivel).toBe('R3');
    expect(v4.avaliadas.every((a) => a.nivelMercado === 3)).toBe(true);
    expect(v4.descartados.some((d) => d.motivo.includes('liga principal sem referência'))).toBe(
      true,
    );
    expect(v4.decisao).not.toBe('BET');
  });
});
