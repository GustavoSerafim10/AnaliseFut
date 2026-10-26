import { escolherMetodo } from '../src/devig';
import { probEfetiva } from '../src/liquidacao';
import { criarLiquidador, criarModelo, distribuicaoModelo } from '../src/mercados';
import type { Lambdas, LinhaOdd, Periodo, TipoMercado, Time } from '../src/tipos';

/** Odds reais da 1win, Villa × Viking (21/10/2026, 09:30). */
export const HORARIO_VILLA = '2026-10-21T09:30:00-03:00';
export const INICIO_VILLA = '2026-10-21T16:00:00-03:00';

export function oddsVillaViking(casa = '1win', horarioColeta = HORARIO_VILLA): LinhaOdd[] {
  const l = (
    mercado: TipoMercado,
    lado: string,
    odd: number,
    linha?: number,
    time?: Time,
  ): LinhaOdd => ({ casa, mercado, lado, odd, linha, time, periodo: 'FT', horarioColeta });
  return [
    l('1X2', '1', 1.24),
    l('1X2', 'X', 6.5),
    l('1X2', '2', 11.2),
    l('total', 'under', 3.55, 2.5),
    l('total', 'over', 1.29, 2.5),
    l('total', 'under', 2.09, 3.5),
    l('total', 'over', 1.73, 3.5),
    l('total', 'under', 1.51, 4.5),
    l('total', 'over', 2.54, 4.5),
    l('total_time', 'under', 4.34, 1.5, 'casa'),
    l('total_time', 'over', 1.21, 1.5, 'casa'),
    l('total_time', 'under', 2.22, 2.5, 'casa'),
    l('total_time', 'over', 1.65, 2.5, 'casa'),
    l('total_time', 'under', 1.51, 3.5, 'casa'),
    l('total_time', 'over', 2.55, 3.5, 'casa'),
    l('total_time', 'under', 2.4, 0.5, 'fora'),
    l('total_time', 'over', 1.57, 0.5, 'fora'),
    l('total_time', 'under', 1.27, 1.5, 'fora'),
    l('total_time', 'over', 3.72, 1.5, 'fora'),
    l('AH', 'casa', 1.61, -1.5),
    l('AH', 'fora', 2.24, 1.5),
    l('ambas', 'sim', 1.62),
    l('ambas', 'nao', 2.2),
  ];
}

interface OpcoesSinteticas {
  casa?: string;
  margem?: number;
  horarioColeta?: string;
  rho?: number;
}

/**
 * Aplica a margem do mesmo jeito que o motor a remove: proporcional, ou pela potência
 * (p^c com Σ p^c = 1 + margem) quando o mercado tem favorito < 1,40 ou azarão > 8,00.
 */
function aplicarMargem(probs: number[], margem: number): number[] {
  const prop = probs.map((p) => 1 / (p * (1 + margem)));
  if (escolherMetodo(prop) === 'proporcional') return prop;
  let lo = 0.01;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const c = (lo + hi) / 2;
    if (probs.reduce((s, p) => s + p ** c, 0) > 1 + margem) lo = c;
    else hi = c;
  }
  return probs.map((p) => 1 / p ** ((lo + hi) / 2));
}

/**
 * Odds "sintéticas" de uma casa que precifica exatamente pelo λ dado,
 * com margem e arredondamento a 2 casas (como num print).
 */
export function oddsSinteticas(lambdas: Lambdas, o: OpcoesSinteticas = {}): LinhaOdd[] {
  const casa = o.casa ?? '1win';
  const margem = o.margem ?? 0.055;
  const horarioColeta = o.horarioColeta ?? HORARIO_VILLA;
  const modelo = criarModelo(lambdas, o.rho);
  const linhas: LinhaOdd[] = [];
  const mk = (
    mercado: TipoMercado,
    lados: string[],
    extra: { linha?: number; linhas?: number[]; time?: Time; periodo?: Periodo } = {},
  ) => {
    const grupo = lados.map((lado, i): LinhaOdd => ({
      casa,
      mercado,
      lado,
      linha: extra.linhas ? extra.linhas[i] : extra.linha,
      time: extra.time,
      periodo: extra.periodo ?? 'FT',
      odd: 0,
      horarioColeta,
    }));
    const probs = grupo.map((l) => {
      const r = criarLiquidador(l);
      if (!r.ok) throw new Error(r.motivo);
      return probEfetiva(distribuicaoModelo(r.liq, modelo));
    });
    // DC: lados se sobrepõem (somam 2), margem aplicada lado a lado
    const odds =
      mercado === 'DC' ? probs.map((p) => 1 / (p * (1 + margem))) : aplicarMargem(probs, margem);
    grupo.forEach((l, i) => (l.odd = Math.max(1.01, Math.round(odds[i] * 100) / 100)));
    linhas.push(...grupo);
  };
  mk('1X2', ['1', 'X', '2']);
  mk('DC', ['1X', '12', 'X2']);
  mk('DNB', ['1', '2']);
  for (const L of [1.5, 2.5, 3.5, 4.5]) mk('total', ['over', 'under'], { linha: L });
  for (const L of [0.5, 1.5, 2.5, 3.5])
    mk('total_time', ['over', 'under'], { linha: L, time: 'casa' });
  for (const L of [0.5, 1.5, 2.5]) mk('total_time', ['over', 'under'], { linha: L, time: 'fora' });
  for (const L of [-2.5, -2, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.5])
    mk('AH', ['casa', 'fora'], { linhas: [L, -L] });
  mk('ambas', ['sim', 'nao']);
  mk('1X2', ['1', 'X', '2'], { periodo: '1T' });
  for (const L of [0.5, 1.5]) mk('total', ['over', 'under'], { linha: L, periodo: '1T' });
  return linhas;
}
