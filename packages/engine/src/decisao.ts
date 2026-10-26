/**
 * Pipeline V3.3 (seção 1) e decisão (seções 22–23). NO BET é o padrão:
 * só vira BET depois de passar por todos os portões.
 */
import { ajustarLambdaModelo, type ContextoLambda } from './ajustesLambda';
import {
  EV_MINIMO_BASE,
  EV_SANIDADE,
  blend,
  evMinimo,
  pesoModelo,
  priceGate,
  type PriceGate,
} from './gates';
import { calcularStake, type Stake } from './kelly';
import { ajustarLambdaMercado, observacoesParaLambda, type LambdaMercado } from './lambdaMarket';
import { criarModelo, FRACAO_1T } from './mercados';
import {
  placaresMaisProvaveis,
  probabilidades1X2,
  RHO_PADRAO,
  type PlacarProvavel,
  type Prob1X2,
} from './poisson';
import { precificar } from './precificacao';
import { analisarSensibilidade, type ResultadoSensibilidade } from './sensibilidade';
import type { DQ, Lambdas, LinhaOdd } from './tipos';
import { varrerMercados, type Avaliacao, type ResultadoVarredura } from './varredura';

export type Decisao = 'BET' | 'WATCHLIST' | 'INVESTIGAR' | 'NO_BET' | 'EXCLUIDO';

export const ROTULO_DECISAO: Record<Decisao, string> = {
  BET: '🟢 BET',
  WATCHLIST: '🟡 WATCHLIST',
  INVESTIGAR: '🔍 INVESTIGAR',
  NO_BET: '⛔ NO BET',
  EXCLUIDO: 'EXCLUÍDO (não é pré-live)',
};

export type Confianca = 'Muito Alta' | 'Alta' | 'Média' | 'Baixa' | 'Muito Baixa';
export type Risco = '🟢' | '🟡' | '🟠' | '🔴';

export const CASAS_REFERENCIA = ['pinnacle', 'betfair'];
export const DIVERGENCIA_ALERTA = 0.08;
export const DIVERGENCIA_MAXIMA = 0.15;
const RECOLETA_MINUTOS = 30;

export interface ContextoAnalise extends ContextoLambda {
  mercadoMuitoLiquido?: boolean;
  mercadoPoucoLiquido?: boolean;
  escalacaoIncerta?: boolean;
  modelosDivergentes?: boolean;
  lambdaLargo?: boolean;
  priorNeutro?: boolean;
}

/** Checklist do red team (seção 18), marcado pelo usuário. */
export interface RedTeam {
  argumentos: string[];
  atacaPremissa: boolean;
  sobreviveu: boolean;
}

export interface EntradaAnalise {
  jogo: { casa: string; fora: string; inicio: string };
  /** ISO; padrão = agora */
  agora?: string;
  dq: DQ;
  lambdaModelo: Lambdas;
  linhas: LinhaOdd[];
  rho?: number;
  fracao1T?: number;
  contexto?: ContextoAnalise;
  redTeam?: RedTeam;
  banca?: number;
}

export interface Previsao {
  p1x2: { modelo: Prob1X2; mercado: Prob1X2 | null; final: Prob1X2 };
  over25: { modelo: number; mercado: number | null; final: number };
  placares: PlacarProvavel[];
}

export interface MelhorEntrada extends Avaliacao {
  evMinimo: number | null;
  priceGate: PriceGate | null;
  stake: Stake | null;
}

export interface ResultadoAnalise {
  decisao: Decisao;
  rotulo: string;
  motivos: string[];
  gatilho?: string;
  avisos: string[];
  dq: { informada: DQ; efetiva: DQ; motivos: string[] };
  w: number | null;
  lambdaMercado: LambdaMercado | null;
  lambdaModelo: { original: Lambdas; ajustado: Lambdas; ajustes: string[] };
  previsao: Previsao | null;
  varredura: ResultadoVarredura | null;
  melhor: MelhorEntrada | null;
  sensibilidade: ResultadoSensibilidade | null;
  confianca: Confianca;
  risco: Risco;
}

const ORDEM_DQ: DQ[] = ['A', 'B', 'C', 'D', 'E'];
const piorDQ = (a: DQ, b: DQ): DQ => (ORDEM_DQ.indexOf(a) >= ORDEM_DQ.indexOf(b) ? a : b);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function ajustarDQ(dq: DQ, linhas: LinhaOdd[]): { dq: DQ; motivos: string[] } {
  const motivos: string[] = [];
  const casas = new Set(linhas.map((l) => l.casa.trim().toLowerCase()));
  let r = dq;
  if (casas.size === 0) {
    motivos.push('sem odds → DQ E');
    return { dq: 'E', motivos };
  }
  if (casas.size === 1 && (r === 'A' || r === 'B')) {
    r = 'C';
    motivos.push('odds de uma casa só limitam a DQ em C');
  }
  if (r === 'A' && ![...casas].some((c) => CASAS_REFERENCIA.some((ref) => c.includes(ref)))) {
    r = 'B';
    motivos.push('DQ A exige casa referência (Pinnacle/Betfair)');
  }
  return { dq: r, motivos };
}

function confiancaDe(dq: DQ, priorNeutro: boolean): Confianca {
  const mapa: Record<DQ, Confianca> = {
    A: 'Alta',
    B: 'Média',
    C: 'Baixa',
    D: 'Muito Baixa',
    E: 'Muito Baixa',
  };
  const c = mapa[dq];
  if (priorNeutro && (c === 'Alta' || c === 'Média')) return 'Baixa';
  return c;
}

function previsaoDe(
  modelo: ReturnType<typeof criarModelo>,
  precos: ReturnType<typeof precificar>,
  w: number | null,
): Previsao {
  const pm = probabilidades1X2(modelo.ft);
  const sel = (chave: string) => precos.selecoes.find((s) => s.chave === chave)?.pMercado;
  const m1 = sel('1X2|FT|-|-|1');
  const mx = sel('1X2|FT|-|-|x');
  const m2 = sel('1X2|FT|-|-|2');
  const mercado1x2 =
    m1 !== undefined && mx !== undefined && m2 !== undefined
      ? { casa: m1, empate: mx, fora: m2 }
      : null;
  const ww = w ?? 0;
  const final1x2 = mercado1x2
    ? {
        casa: blend(pm.casa, mercado1x2.casa, ww),
        empate: blend(pm.empate, mercado1x2.empate, ww),
        fora: blend(pm.fora, mercado1x2.fora, ww),
      }
    : pm;
  let over25Modelo = 0;
  modelo.ft.forEach((linha, i) => linha.forEach((p, j) => (i + j >= 3 ? (over25Modelo += p) : 0)));
  const over25Mercado = sel('total|FT|-|2.5|over') ?? null;
  return {
    p1x2: { modelo: pm, mercado: mercado1x2, final: final1x2 },
    over25: {
      modelo: over25Modelo,
      mercado: over25Mercado,
      final: over25Mercado === null ? over25Modelo : blend(over25Modelo, over25Mercado, ww),
    },
    placares: placaresMaisProvaveis(modelo.ft, 3),
  };
}

export function analisarJogo(e: EntradaAnalise): ResultadoAnalise {
  const rho = e.rho ?? RHO_PADRAO;
  const fracao1T = e.fracao1T ?? FRACAO_1T;
  const ctx = e.contexto ?? {};
  const nomes = { casa: e.jogo.casa, fora: e.jogo.fora };
  const avisos: string[] = [];
  const motivos: string[] = [];

  const inicio = Date.parse(e.jogo.inicio);
  if (!Number.isFinite(inicio)) throw new Error('jogo.inicio inválido (use data/hora ISO 8601)');
  const agora = e.agora ? Date.parse(e.agora) : Date.now();

  const base = {
    dq: { informada: e.dq, efetiva: e.dq, motivos: [] as string[] },
    w: null,
    lambdaMercado: null,
    lambdaModelo: { original: e.lambdaModelo, ajustado: e.lambdaModelo, ajustes: [] },
    previsao: null,
    varredura: null,
    melhor: null,
    sensibilidade: null,
  };

  // Checagem pré-live
  if (agora >= inicio) {
    return {
      ...base,
      decisao: 'EXCLUIDO',
      rotulo: ROTULO_DECISAO.EXCLUIDO,
      motivos: ['jogo iniciado ou encerrado: somente pré-live'],
      avisos,
      confianca: 'Muito Baixa',
      risco: '🔴',
    };
  }

  // Data Quality
  const dqAjuste = ajustarDQ(e.dq, e.linhas);
  let dq = dqAjuste.dq;
  const dqMotivos = [...dqAjuste.motivos];

  // Mercado sem margem + λ_market (âncora obrigatória)
  const precos = precificar(e.linhas);
  const lm = ajustarLambdaMercado(observacoesParaLambda(precos.selecoes), rho);
  const lambdaMercado = 'erro' in lm ? null : lm;
  if ('erro' in lm) {
    dq = piorDQ(dq, 'E');
    dqMotivos.push(`sem base de mercado para λ: ${lm.erro}`);
  } else if (!lm.coerente) {
    avisos.push(
      'linhas do mesmo time implicam λ diferentes em > 0,15: a casa precifica cauda mais larga que a Poisson → λ_market só referência; P_market vem do de-vig de cada mercado',
    );
  }

  // λ_modelo × λ_market (9.4 e 16.3)
  const aj = ajustarLambdaModelo(e.lambdaModelo, lambdaMercado, ctx);
  avisos.push(...aj.alertas);

  const modelo = criarModelo(aj.lambdas, rho, fracao1T);
  const w = pesoModelo(dq, {
    mercadoMuitoLiquido: ctx.mercadoMuitoLiquido,
    escalacaoIncerta: ctx.escalacaoIncerta,
  });
  const modeloMercado = lambdaMercado
    ? criarModelo({ casa: lambdaMercado.casa, fora: lambdaMercado.fora }, rho, fracao1T)
    : undefined;
  const varredura = varrerMercados(precos, modelo, w, nomes, modeloMercado);
  avisos.push(...varredura.avisosLado);
  const previsao = previsaoDe(modelo, precos, w);

  const confianca = confiancaDe(dq, !!ctx.priorNeutro);
  const resultado = (
    decisao: Decisao,
    extra: {
      gatilho?: string;
      melhor?: MelhorEntrada | null;
      sensibilidade?: ResultadoSensibilidade | null;
    } = {},
  ): ResultadoAnalise => ({
    decisao,
    rotulo: ROTULO_DECISAO[decisao],
    motivos,
    gatilho: extra.gatilho,
    avisos,
    dq: { informada: e.dq, efetiva: dq, motivos: dqMotivos },
    w,
    lambdaMercado,
    lambdaModelo: { original: e.lambdaModelo, ajustado: aj.lambdas, ajustes: aj.ajustes },
    previsao,
    varredura,
    melhor: extra.melhor ?? null,
    sensibilidade: extra.sensibilidade ?? null,
    confianca,
    risco:
      dq === 'D' || dq === 'E'
        ? '🔴'
        : decisao === 'BET'
          ? extra.sensibilidade?.classe === 'ROBUSTA'
            ? '🟢'
            : '🟡'
          : '🟠',
  });

  if (dq === 'E') {
    motivos.push('DQ E: sem base para λ ou sem odds confiáveis → NO BET automático');
    return resultado('NO_BET');
  }

  // Uma tese por jogo: o candidato é o instrumento de maior EV
  const c = varredura.avaliadas[0];
  if (!c) {
    motivos.push('nenhum mercado válido após filtro de margem e de-vig');
    return resultado('NO_BET');
  }

  if (c.horarioColeta && inicio - Date.parse(c.horarioColeta) > RECOLETA_MINUTOS * 60_000) {
    avisos.push('odd coletada mais de 30 min antes do início: recoletar antes de entrar');
  }

  const flagsGate = {
    mercadoPoucoLiquido: ctx.mercadoPoucoLiquido,
    escalacaoIncerta: ctx.escalacaoIncerta,
    modelosDivergentes: ctx.modelosDivergentes,
    lambdaLargo: ctx.lambdaLargo,
    odd: c.melhorOdd,
  };
  const evMin = evMinimo(dq, flagsGate);
  const sens = analisarSensibilidade({
    liq: c.liq,
    lambdas: aj.lambdas,
    lambdaMercado,
    rho,
    fracao1T,
    pMercado: c.pMercado,
    w: w ?? 0,
    odd: c.melhorOdd,
  });
  const pg =
    evMin !== null && w !== null
      ? priceGate({
          w,
          pModeloInferior: sens.pModeloInferior,
          pMercado: c.pMercado,
          evMinimo: evMin,
          emRisco: c.emRisco,
        })
      : null;
  const melhor: MelhorEntrada = { ...c, evMinimo: evMin, priceGate: pg, stake: null };
  const comMelhor = (d: Decisao, gatilho?: string) =>
    resultado(d, { gatilho, melhor, sensibilidade: sens });
  const divergencia = Math.abs(c.pModelo - c.pMercado);

  if (c.ev > EV_SANIDADE) {
    motivos.push(`EV ${pct(c.ev)} > 25%: presumir erro (odd, lado ou dado) → conferir`);
    return comMelhor('INVESTIGAR');
  }
  if (divergencia > DIVERGENCIA_MAXIMA) {
    motivos.push(`divergência modelo × mercado de ${pct(divergencia)} > 15 pp`);
    return comMelhor('INVESTIGAR');
  }
  if (c.ev <= 0) {
    motivos.push(`nenhum mercado com EV positivo (melhor: ${c.descricao} ${pct(c.ev)})`);
    return comMelhor('NO_BET');
  }
  if (dq === 'D') {
    const gateC = EV_MINIMO_BASE.C as number;
    if (c.ev >= gateC && sens.classe !== 'FRÁGIL') {
      motivos.push('DQ D nunca vira BET: só previsão');
      return comMelhor('WATCHLIST', 'melhorar os dados (amostra/fontes) até DQ ≥ C e reanalisar');
    }
    motivos.push(`DQ D e EV ${pct(c.ev)} sem tese consistente`);
    return comMelhor('NO_BET');
  }
  if (evMin === null || c.ev < evMin) {
    motivos.push(`EV ${pct(c.ev)} abaixo do gate de ${pct(evMin ?? 0)} (DQ ${dq})`);
    return comMelhor('NO_BET');
  }
  if (divergencia > DIVERGENCIA_ALERTA && !ctx.explicacaoDivergencia) {
    motivos.push(
      `divergência de ${pct(divergencia)} (8–15 pp) sem fato concreto e verificável: provável limitação do modelo, não valor`,
    );
    return comMelhor('NO_BET');
  }
  if (sens.classe === 'FRÁGIL') {
    motivos.push(
      `sensibilidade FRÁGIL (${sens.positivos}/${sens.cenarios.length} cenários com EV > 0)`,
    );
    return comMelhor('NO_BET');
  }
  if (e.redTeam && !e.redTeam.sobreviveu) {
    motivos.push('red team derrubou a tese');
    return comMelhor('NO_BET');
  }
  if (!e.redTeam || e.redTeam.argumentos.length < 3 || !e.redTeam.atacaPremissa) {
    motivos.push(
      'red team pendente: ≥3 argumentos contra, pelo menos 1 atacando a premissa do modelo',
    );
    return comMelhor('WATCHLIST', 'completar o red team');
  }
  if (!c.horarioColeta) {
    motivos.push('odd sem horário de coleta não serve para o price gate');
    return comMelhor('WATCHLIST', 'recoletar a odd com o horário visível');
  }
  if (pg && c.melhorOdd < pg.oddMinima) {
    motivos.push(`PASS: odd ${c.melhorOdd} abaixo da mínima ${pg.oddMinima.toFixed(2)}`);
    return comMelhor('WATCHLIST', `BET somente se odd ≥ ${pg.oddMinima.toFixed(2)}`);
  }

  melhor.stake = calcularStake({
    p: c.pFinal,
    odd: c.melhorOdd,
    dq,
    classe: sens.classe,
    escalacaoIncerta: ctx.escalacaoIncerta,
    banca: e.banca,
  });
  motivos.push(
    `${c.descricao} @ ${c.melhorOdd} (${c.casaMelhorOdd}): EV ${pct(c.ev)} ≥ gate ${pct(evMin)}, sensibilidade ${sens.classe}, red team ok`,
  );
  return comMelhor('BET', pg ? `BET somente se odd ≥ ${pg.oddMinima.toFixed(2)}` : undefined);
}
