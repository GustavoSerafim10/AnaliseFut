/**
 * Jogo de EXEMPLO (endereço #demo): odds fictícias de Pinnacle, Bet365 e Superbet e as
 * estatísticas reais de Flamengo × Atlético-MG digitadas como correção. Serve para ver o site
 * funcionando antes de ter prints; nada do exemplo é salvo no aparelho.
 */
import type { OddLine } from '@pe/schemas';
import { isoLocal, rascunhoNovo, type Rascunho } from './estado';

export const ehExemplo = () => location.hash.startsWith('#demo');

/** "#demo/analise" → "analise" */
export const abaDoExemplo = () => location.hash.split('/')[1] || 'analise';

export function rascunhoExemplo(): Rascunho {
  // jogo daqui a 3 h; todas as casas coletadas agora, no mesmo minuto
  const inicio = isoLocal(new Date(Date.now() + 3 * 3_600_000));
  const coleta = isoLocal(new Date());
  const odd = (
    casa: string,
    mercado: OddLine['mercado'],
    lado: string,
    o: number,
    extra: Partial<OddLine> = {},
  ): OddLine => ({
    casa,
    mercado,
    lado,
    odd: o,
    periodo: 'FT',
    horarioColeta: coleta,
    fonte: 'manual',
    ...extra,
  });
  const ou = (casa: string, linha: number, over: number, under: number) => [
    odd(casa, 'total', 'over', over, { linha }),
    odd(casa, 'total', 'under', under, { linha }),
  ];
  return {
    ...rascunhoNovo(),
    jogo: {
      casa: 'Flamengo',
      fora: 'Atlético-MG',
      competicao: 'Exemplo',
      data: inicio.slice(0, 10),
      hora: inicio.slice(11, 16),
    },
    casas: ['Pinnacle', 'Bet365', 'Superbet'],
    odds: [
      odd('Pinnacle', '1X2', '1', 1.33),
      odd('Pinnacle', '1X2', 'X', 5.4),
      odd('Pinnacle', '1X2', '2', 10.5),
      ...ou('Pinnacle', 2.5, 1.71, 2.22),
      odd('Pinnacle', 'ambas', 'sim', 2.14),
      odd('Pinnacle', 'ambas', 'nao', 1.75),
      odd('Bet365', '1X2', '1', 1.3),
      odd('Bet365', '1X2', 'X', 5.25),
      odd('Bet365', '1X2', '2', 10),
      ...ou('Bet365', 2.5, 1.66, 2.2),
      odd('Bet365', 'ambas', 'sim', 2.1),
      odd('Bet365', 'ambas', 'nao', 1.7),
      odd('Superbet', '1X2', '1', 1.32),
      odd('Superbet', '1X2', 'X', 5.1),
      odd('Superbet', '1X2', '2', 9.5),
      // a Superbet ficou para trás no over: é aqui que a V4.0 encontra o preço
      ...ou('Superbet', 2.5, 1.84, 1.96),
      odd('Superbet', 'ambas', 'sim', 2.05),
      odd('Superbet', 'ambas', 'nao', 1.72),
    ],
    correcoes: {
      'partidas.casa': 31,
      'partidas.fora': 31,
      'golsMarcados.casa': 62,
      'golsMarcados.fora': 42,
      'golsSofridos.casa': 25,
      'golsSofridos.fora': 35,
      'xg.casa': 1.8,
      'xg.fora': 1.4,
      'chutesNoAlvo.casa': 5.7,
      'chutesNoAlvo.fora': 5.0,
      'escanteios.casa': 6.1,
      'escanteios.fora': 5.3,
      'cartoesAmarelos.casa': 2.1,
      'cartoesAmarelos.fora': 1.6,
    },
    banca: '1000',
  };
}
