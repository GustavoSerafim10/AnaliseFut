/**
 * Seção 19 — varredura completa: todo mercado enviado recebe margem, P_market, P_modelo,
 * P_final e EV, ou o motivo explícito do descarte. Agrupa por tese (1 instrumento por tese).
 */
import { descreverAposta } from './descricao';
import type { Estatistica } from './contagens';
import { blend, oddJusta, W_MAX_NIVEL3 } from './gates';
import { fracaoEmRisco, probEfetiva } from './liquidacao';
import {
  criarLiquidador,
  criarModelo,
  distribuicaoModelo,
  faltaNoModelo,
  type Liquidador,
  type ModeloPlacar,
} from './mercados';
import { chaveGrupo, type ResultadoPrecificacao } from './precificacao';
import type { LinhaOdd, NomesTimes } from './tipos';

export const MARGEM_MAXIMA = 0.1;

type EixoTese = 'casa' | 'fora' | 'mais' | 'menos';
export type IdTese =
  'casa_domina' | 'fora_resiste' | 'jogo_aberto' | 'jogo_fechado' | `${Estatistica}_${EixoTese}`;

export const NOMES_TESE: Record<IdTese, string> = {
  casa_domina: 'Mandante domina (supremacia da casa)',
  fora_resiste: 'Favorito da casa não vence com folga / visitante resiste',
  jogo_aberto: 'Jogo aberto (mais gols)',
  jogo_fechado: 'Jogo fechado (menos gols)',
  escanteios_casa: 'Mandante com mais escanteios que o visitante',
  escanteios_fora: 'Visitante equilibra os escanteios',
  escanteios_mais: 'Muitos escanteios',
  escanteios_menos: 'Poucos escanteios',
  cartoes_casa: 'Mandante mais faltoso (mais cartões)',
  cartoes_fora: 'Visitante mais faltoso (mais cartões)',
  cartoes_mais: 'Jogo com muitos cartões',
  cartoes_menos: 'Jogo com poucos cartões',
};

export interface Avaliacao {
  chave: string;
  linha: LinhaOdd;
  descricao: string;
  nivel: 1 | 2 | 3;
  margem: number;
  metodoDevig: string;
  pMercado: number;
  pModelo: number;
  pFinal: number;
  w: number | null;
  oddJusta: number;
  melhorOdd: number;
  casaMelhorOdd: string;
  horarioColeta?: string;
  /** fração da aposta em risco (≠ 1 com push / meios resultados) */
  emRisco: number;
  ev: number;
  /** P_final − P_market (informativo) */
  edgePP: number;
  tese: IdTese;
  representanteDaTese: boolean;
  outliers: string[];
  liq: Liquidador;
}

export interface Descarte {
  chave: string;
  descricao: string;
  motivo: string;
  casa?: string;
  margem?: number;
  pMercado?: number;
  pModelo?: number;
  ev?: number;
}

export interface ResultadoVarredura {
  /** válidas, ordenadas por EV (maior primeiro) */
  avaliadas: Avaliacao[];
  top5: Avaliacao[];
  descartados: Descarte[];
  instrumentoPorTese: Partial<Record<IdTese, Avaliacao>>;
  avisosLado: string[];
}

/**
 * Tese pela direção em que a aposta "torce": derivada da probabilidade em relação à
 * supremacia S = λc − λf e ao total T = λc + λf. Eixo dominante decide (empate → supremacia).
 */
export function teseDe(liq: Liquidador, m: ModeloPlacar): IdTese {
  // nível 3: mesma ideia, nos λ da estatística (escanteios/cartões) em vez dos de gols
  const estat =
    liq.tipo === 'contagem' || liq.tipo === 'primeira_contagem' ? liq.estatistica : null;
  const { casa, fora } = estat ? m.contagens[estat]! : m.lambdas;
  const S = casa - fora;
  const T = casa + fora;
  const h = 0.1;
  const p = (s: number, t: number) => {
    const l = { casa: Math.max(0.01, (t + s) / 2), fora: Math.max(0.01, (t - s) / 2) };
    const mod = estat
      ? criarModelo(m.lambdas, m.rho, m.fracao1T, { ...m.contagens, [estat]: l })
      : criarModelo(l, m.rho, m.fracao1T);
    return probEfetiva(distribuicaoModelo(liq, mod));
  };
  const dS = p(S + h, T) - p(S - h, T);
  const dT = p(S, T + h) - p(S, T - h);
  if (estat) {
    if (Math.abs(dS) >= Math.abs(dT)) return dS >= 0 ? `${estat}_casa` : `${estat}_fora`;
    return dT >= 0 ? `${estat}_mais` : `${estat}_menos`;
  }
  if (Math.abs(dS) >= Math.abs(dT)) return dS >= 0 ? 'casa_domina' : 'fora_resiste';
  return dT >= 0 ? 'jogo_aberto' : 'jogo_fechado';
}

export function varrerMercados(
  precos: ResultadoPrecificacao,
  modelo: ModeloPlacar,
  w: number | null,
  nomes: NomesTimes,
  /** matriz do λ_market: referência para checar lado invertido */
  modeloMercado?: ModeloPlacar,
): ResultadoVarredura {
  const descartados: Descarte[] = precos.descartes.map((d) => ({
    chave: d.chave,
    casa: d.casa,
    descricao: descreverAposta(d.linha, nomes),
    motivo: d.motivo,
  }));
  const avaliadas: Avaliacao[] = [];
  // nível 3 (escanteios/cartões): o modelo pesa no máximo 0,30 no blend (seção 12)
  const w3 = w === null ? null : Math.min(w, W_MAX_NIVEL3);

  for (const s of precos.selecoes) {
    const descricao = descreverAposta(s.linha, nomes);
    const r = criarLiquidador(s.linha);
    if (!r.ok) {
      descartados.push({
        chave: s.chave,
        descricao,
        motivo: r.motivo,
        margem: s.margem,
        pMercado: s.pMercado,
      });
      continue;
    }
    const falta = faltaNoModelo(r.liq, modelo);
    if (falta) {
      descartados.push({
        chave: s.chave,
        descricao,
        motivo: falta,
        margem: s.margem,
        pMercado: s.pMercado,
      });
      continue;
    }
    const d = distribuicaoModelo(r.liq, modelo);
    const pModelo = probEfetiva(d);
    const emRisco = fracaoEmRisco(d);
    const wSel = r.nivel === 3 ? w3 : w;
    const pFinal = wSel === null ? s.pMercado : blend(pModelo, s.pMercado, wSel);
    const ev = emRisco * (pFinal * s.melhor.odd - 1);

    if (s.margem > MARGEM_MAXIMA) {
      descartados.push({
        chave: s.chave,
        descricao,
        motivo: `margem ${(s.margem * 100).toFixed(1)}% > 10%: só informação`,
        margem: s.margem,
        pMercado: s.pMercado,
        pModelo,
        ev,
      });
      continue;
    }

    avaliadas.push({
      chave: s.chave,
      linha: s.linha,
      descricao,
      nivel: r.nivel,
      margem: s.margem,
      metodoDevig: s.metodo,
      pMercado: s.pMercado,
      pModelo,
      pFinal,
      w: wSel,
      oddJusta: oddJusta(pFinal),
      melhorOdd: s.melhor.odd,
      casaMelhorOdd: s.melhor.casa,
      horarioColeta: s.melhor.horarioColeta,
      emRisco,
      ev,
      edgePP: pFinal - s.pMercado,
      tese: teseDe(r.liq, modelo),
      representanteDaTese: false,
      outliers: s.outliers,
      liq: r.liq,
    });
  }

  avaliadas.sort((a, b) => b.ev - a.ev || b.pFinal - a.pFinal);

  // 1 instrumento por tese: maior EV; empate → maior probabilidade (menor variância)
  const instrumentoPorTese: Partial<Record<IdTese, Avaliacao>> = {};
  for (const a of avaliadas) {
    if (!instrumentoPorTese[a.tese]) {
      instrumentoPorTese[a.tese] = a;
      a.representanteDaTese = true;
    }
  }

  // Regra 0.10: odd menor = lado mais provável. Se o modelo discorda muito, o lado pode estar trocado.
  const avisosLado: string[] = [];
  const porGrupo = new Map<string, Avaliacao[]>();
  for (const a of avaliadas) {
    // nível 3 não tem λ de mercado para comparar: a sanidade da margem cobre a leitura
    if (a.nivel === 3) continue;
    const g = chaveGrupo(a.linha);
    porGrupo.set(g, [...(porGrupo.get(g) ?? []), a]);
  }
  for (const [g, lados] of porGrupo) {
    if (lados.length !== 2) continue;
    const [fav, outro] = lados[0].pMercado >= lados[1].pMercado ? lados : [lados[1], lados[0]];
    // compara com o PRÓPRIO mercado (λ ajustado em todas as linhas da casa): lado trocado na
    // leitura deixa a casa incoerente consigo mesma. Sem λ_market, cai para o modelo.
    const ref = modeloMercado ?? modelo;
    const pRef = (a: Avaliacao) => probEfetiva(distribuicaoModelo(a.liq, ref));
    if (pRef(fav) < 0.5 && pRef(outro) - pRef(fav) >= (modeloMercado ? 0.2 : 0.1)) {
      avisosLado.push(
        `${g}: as odds favorecem "${fav.descricao}" mas o resto do mercado indica ${(pRef(outro) * 100).toFixed(0)}% para o outro lado — conferir se o lado/odd não foi invertido na leitura`,
      );
    }
  }

  return { avaliadas, top5: avaliadas.slice(0, 5), descartados, instrumentoPorTese, avisosLado };
}
