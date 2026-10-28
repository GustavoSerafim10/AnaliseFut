/**
 * Cruzamento de fontes (SofaScore × SuperScore): valor de cada fonte lado a lado,
 * divergência > 15% destacada, valor escolhido declarado, e montagem das estatísticas
 * que entram no λ do modelo.
 */
import type { Estatistica, EstatisticasTime, StatsContagem, Time } from '@pe/engine';
import {
  CAMPOS_STATS,
  DEF_CAMPO,
  type CampoStat,
  type FonteStats,
  type LeituraStats,
} from './estatisticas';

export const LIMITE_DIVERGENCIA_FONTES = 0.15;

/** Fonte preferida quando as duas divergem (contagens do SofaScore; xG do SuperScore). */
const PREFERENCIA: Partial<Record<CampoStat, FonteStats>> = {
  xg: 'superscore',
  xgot: 'superscore',
  golsEvitados: 'superscore',
};

export interface ValorConsolidado {
  porFonte: Partial<Record<FonteStats, number>>;
  valor?: number;
  fonte?: FonteStats | 'média' | 'manual';
  divergente: boolean;
  avisos: string[];
}

export type TabelaConsolidada = Partial<Record<CampoStat, Record<Time, ValorConsolidado>>>;

/** chave `${campo}.${time}` → valor digitado pelo usuário (prevalece sobre o OCR) */
export type Correcoes = Record<string, number>;

export function consolidar(
  leituras: Partial<Record<FonteStats, LeituraStats | null>>,
  correcoes: Correcoes = {},
): TabelaConsolidada {
  const tabela: TabelaConsolidada = {};
  for (const def of CAMPOS_STATS) {
    const porTime = {} as Record<Time, ValorConsolidado>;
    let algum = false;
    for (const time of ['casa', 'fora'] as const) {
      const porFonte: ValorConsolidado['porFonte'] = {};
      const avisos: string[] = [];
      for (const f of ['sofascore', 'superscore'] as const) {
        const v = leituras[f]?.campos[def.campo];
        const n = v?.[time];
        if (n !== undefined) {
          porFonte[f] = n;
          avisos.push(...(v?.avisos ?? []).map((a) => `${f}: ${a}`));
        }
      }
      const manual = correcoes[`${def.campo}.${time}`];
      const vals = Object.values(porFonte);
      let divergente = false;
      let valor: number | undefined;
      let fonte: ValorConsolidado['fonte'];
      if (vals.length === 2) {
        const [a, b] = vals;
        const base = Math.max(Math.abs(a), Math.abs(b));
        divergente = base > 0 && Math.abs(a - b) / base > LIMITE_DIVERGENCIA_FONTES;
        if (divergente) {
          fonte = PREFERENCIA[def.campo] ?? 'sofascore';
          valor = porFonte[fonte];
          avisos.push(`fontes divergem > 15% (${a} × ${b}): usando ${fonte}, conferir`);
        } else {
          valor = (a + b) / 2;
          fonte = 'média';
        }
      } else if (vals.length === 1) {
        fonte = Object.keys(porFonte)[0] as FonteStats;
        valor = vals[0];
      }
      if (manual !== undefined) {
        valor = manual;
        fonte = 'manual';
      }
      if (valor !== undefined || vals.length) algum = true;
      porTime[time] = { porFonte, valor, fonte, divergente, avisos };
    }
    if (algum) tabela[def.campo] = porTime;
  }
  checarConsistencia(tabela);
  return tabela;
}

const val = (t: TabelaConsolidada, c: CampoStat, time: Time) => t[c]?.[time]?.valor;

function checarConsistencia(t: TabelaConsolidada): void {
  for (const time of ['casa', 'fora'] as const) {
    const p = val(t, 'partidas', time);
    if (!p) continue;
    const pares: [CampoStat, CampoStat][] = [
      ['golsPorJogo', 'golsMarcados'],
      ['golsSofridosPorJogo', 'golsSofridos'],
    ];
    for (const [media, total] of pares) {
      const m = val(t, media, time);
      const tot = val(t, total, time);
      if (m === undefined || tot === undefined) continue;
      if (Math.abs(m - tot / p) > 0.15) {
        t[media]![time].avisos.push(
          `inconsistente: ${DEF_CAMPO[total].rotulo} ${tot} ÷ ${p} jogos = ${(tot / p).toFixed(2)}, mas a média lida é ${m}`,
        );
      }
    }
  }
}

export interface EstatisticasModelo {
  stats: EstatisticasTime | null;
  declaracoes: string[];
  faltando: string[];
}

/** Monta o que entra no λ (9.2) a partir da tabela consolidada, declarando cada escolha. */
export function estatisticasParaModelo(t: TabelaConsolidada, time: Time): EstatisticasModelo {
  const declaracoes: string[] = [];
  const faltando: string[] = [];
  const jogos = val(t, 'partidas', time);
  const gm = val(t, 'golsMarcados', time);
  const gs = val(t, 'golsSofridos', time);
  // total ÷ partidas é mais preciso que a média (1 casa decimal), salvo quando não bate com
  // ela: aí o total é que veio errado ("gols marcados 4" em 32 jogos com 1,1 por jogo)
  const porJogo = (total: number | undefined, campoMedia: CampoStat, nome: string) => {
    const media = val(t, campoMedia, time);
    if (!jogos || total === undefined) return media;
    const conta = total / jogos;
    if (media !== undefined && Math.abs(conta - media) > 0.15) {
      declaracoes.push(
        `${nome}/jogo = ${media} (média lida): ${total} ÷ ${jogos} = ${conta.toFixed(2)} não bate, total ignorado`,
      );
      return media;
    }
    declaracoes.push(`${nome}/jogo = ${total} ÷ ${jogos} = ${conta.toFixed(2)}`);
    return conta;
  };
  const golsPro = porJogo(gm, 'golsPorJogo', 'gols pró');
  const golsContra = porJogo(gs, 'golsSofridosPorJogo', 'gols contra');

  if (!jogos) faltando.push('partidas');
  if (golsPro === undefined) faltando.push('gols marcados');
  if (golsContra === undefined) faltando.push('gols sofridos');
  if (!jogos || golsPro === undefined || golsContra === undefined)
    return { stats: null, declaracoes, faltando };

  const xg = val(t, 'xg', time);
  const chutesNoAlvo = val(t, 'chutesNoAlvo', time);
  const grandesChances = val(t, 'grandesChances', time);
  const defesas = val(t, 'defesasGoleiro', time);
  let chutesNoAlvoContra: number | undefined;
  if (defesas !== undefined) {
    chutesNoAlvoContra = defesas + golsContra;
    declaracoes.push(
      `chutes no alvo contra/jogo (derivado) = defesas do goleiro ${defesas} + gols sofridos ${golsContra.toFixed(2)} = ${chutesNoAlvoContra.toFixed(2)}`,
    );
  }
  if (xg === undefined) faltando.push('xG');
  return {
    stats: {
      jogos,
      golsPro,
      golsContra,
      xg,
      chutesNoAlvo,
      chutesNoAlvoContra,
      grandesChances,
    },
    declaracoes,
    faltando,
  };
}

/** Escanteios a favor (e cedidos) ou cartões amarelos por jogo, para o modelo nível 3. */
export function estatisticasContagem(
  t: TabelaConsolidada,
  time: Time,
  estatistica: Estatistica,
): StatsContagem | null {
  const jogos = val(t, 'partidas', time);
  const favor = val(t, estatistica === 'escanteios' ? 'escanteios' : 'cartoesAmarelos', time);
  if (!jogos || favor === undefined) return null;
  const contra = estatistica === 'escanteios' ? val(t, 'escanteiosContra', time) : undefined;
  return { jogos, favor, contra };
}

/** Frases comparativas para a análise escrita. */
export function destaquesComparativos(
  t: TabelaConsolidada,
  nomes: { casa: string; fora: string },
): string[] {
  const linhas: string[] = [];
  const f = (x: number) => x.toFixed(1).replace('.', ',');
  const comp = (campo: CampoStat, frase: (c: string, f: string) => string) => {
    const c = val(t, campo, 'casa');
    const fo = val(t, campo, 'fora');
    if (c !== undefined && fo !== undefined) linhas.push(frase(f(c), f(fo)));
  };
  comp('xg', (c, fo) => `xG por jogo: ${nomes.casa} ${c} × ${fo} ${nomes.fora}.`);
  comp(
    'golsPorJogo',
    (c, fo) => `Gols marcados por jogo: ${nomes.casa} ${c} × ${fo} ${nomes.fora}.`,
  );
  comp(
    'golsSofridosPorJogo',
    (c, fo) => `Gols sofridos por jogo: ${nomes.casa} ${c} × ${fo} ${nomes.fora}.`,
  );
  comp(
    'chutesNoAlvo',
    (c, fo) => `Chutes no alvo por jogo: ${nomes.casa} ${c} × ${fo} ${nomes.fora}.`,
  );
  comp(
    'grandesChances',
    (c, fo) => `Grandes chances criadas por jogo: ${nomes.casa} ${c} × ${fo} ${nomes.fora}.`,
  );
  comp('escanteios', (c, fo) => `Escanteios por jogo: ${nomes.casa} ${c} × ${fo} ${nomes.fora}.`);
  comp(
    'cartoesAmarelos',
    (c, fo) => `Cartões amarelos por jogo: ${nomes.casa} ${c} × ${fo} ${nomes.fora}.`,
  );
  const js = (time: Time) => val(t, 'jogosSemSofrer', time);
  const pc = val(t, 'partidas', 'casa');
  if (js('casa') !== undefined && pc)
    linhas.push(`${nomes.casa} não sofreu gols em ${js('casa')} de ${pc} jogos.`);
  const pf = val(t, 'partidas', 'fora');
  if (js('fora') !== undefined && pf)
    linhas.push(`${nomes.fora} não sofreu gols em ${js('fora')} de ${pf} jogos.`);
  for (const time of ['casa', 'fora'] as const) {
    const xg = val(t, 'xg', time);
    const g = val(t, 'golsPorJogo', time);
    if (xg !== undefined && g !== undefined && Math.abs(g - xg) >= 0.3) {
      linhas.push(
        `${nomes[time]} marca ${f(g)} por jogo com xG de ${f(xg)}: ${g > xg ? 'acima do esperado (possível regressão)' : 'abaixo do esperado (pode melhorar)'}.`,
      );
    }
  }
  return linhas;
}
