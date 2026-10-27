/**
 * Protocolo V4.0 — referência afiada × casa mole.
 * P_true vem da Pinnacle/Betfair sem margem (R1) ou do consenso de 4+ casas (R2); só sem
 * referência entra o modelo V3.3 em blend com o consenso (R3, nichos). Só modelo (R4)
 * nunca vira BET. EV = P_true × melhor odd das casas moles − 1. NO BET é o padrão.
 */
import type { TravasBanca } from './banca';
import { TETO_DIA } from './banca';
import { ROTULO_DECISAO, type Decisao, type RedTeam } from './decisao';
import { descreverAposta } from './descricao';
import { blend, W_MAX_NIVEL3 } from './gates';
import { kellyCheio } from './kelly';
import { fracaoEmRisco, probEfetiva } from './liquidacao';
import {
  criarLiquidador,
  criarModelo,
  distribuicaoModelo,
  faltaNoModelo,
  FRACAO_1T,
  type LambdasContagem,
  type Liquidador,
  type ModeloPlacar,
} from './mercados';
import { RHO_PADRAO } from './poisson';
import { chaveGrupo, mediana, precificar, type PrecoCasa } from './precificacao';
import { analisarSensibilidade, type ResultadoSensibilidade } from './sensibilidade';
import type { DQ, Lambdas, LinhaOdd } from './tipos';
import { NOMES_TESE, teseDe, type IdTese } from './varredura';

export type NivelReferencia = 'R1' | 'R2' | 'R3' | 'R4';
export type Estrategia = 'S1' | 'S2' | 'S3' | 'S4';

export const NOMES_ESTRATEGIA: Record<Estrategia, string> = {
  S1: 'S1 · value contra a referência',
  S2: 'S2 · notícia e timing',
  S3: 'S3 · nicho com modelo próprio',
  S4: 'S4 · promoção/bônus',
};

export const NOMES_REFERENCIA: Record<NivelReferencia, string> = {
  R1: 'R1 · casa afiada (Pinnacle/Betfair) sem margem',
  R2: 'R2 · consenso de 4+ casas sem margem',
  R3: 'R3 · modelo V3.3 + consenso (nicho)',
  R4: 'R4 · só modelo (nunca BET)',
};

export const CASAS_AFIADAS = ['pinnacle', 'betfair'];
/** comissão da Betfair Exchange sobre o lucro, descontada quando a melhor odd é dela */
export const COMISSAO_BETFAIR = 0.065;
export const MIN_CASAS_CONSENSO = 4;
export const EV_INVESTIGAR_V4 = 0.15;
export const DISCORDANCIA_FORTE = 0.1;
export const MARGEM_MAXIMA_REF = 0.1;
export const JANELA_COMPARAVEL_MIN = 10;
export const JOGOS_MIN_NICHO = 6;

export const GATE_V4 = { R1: 0.02, R1_menor: 0.03, R2: 0.035, R3: 0.05 } as const;
export const KELLY_V4: Record<'R1' | 'R2' | 'R3', number> = { R1: 1 / 4, R2: 1 / 6, R3: 1 / 8 };
export const TETO_APOSTA_V4: Record<'R1' | 'R2' | 'R3', number> = {
  R1: 0.02,
  R2: 0.02,
  R3: 0.01,
};

export const ehAfiada = (casa: string) =>
  CASAS_AFIADAS.some((c) => casa.trim().toLowerCase().includes(c));

/** EV mínimo da seção 5. null = R4 (sem BET). */
export function gateV4(
  nivel: NivelReferencia,
  f: { ligaPrincipal: boolean; horasAteJogo: number; odd: number; escalacaoIncerta?: boolean },
): number | null {
  if (nivel === 'R4') return null;
  const base =
    nivel === 'R1'
      ? f.ligaPrincipal && f.horasAteJogo <= 24
        ? GATE_V4.R1
        : GATE_V4.R1_menor
      : nivel === 'R2'
        ? GATE_V4.R2
        : GATE_V4.R3;
  return base + (f.odd > 8 ? 0.03 : f.odd > 4 ? 0.01 : 0) + (f.escalacaoIncerta ? 0.01 : 0);
}

/** Odd que entra no EV: na Betfair Exchange a comissão sai do lucro. */
export function oddEfetiva(casa: string, odd: number): number {
  return casa.trim().toLowerCase().includes('betfair')
    ? 1 + (odd - 1) * (1 - COMISSAO_BETFAIR)
    : odd;
}

/** Motor V3.3 como apoio: filtro, preço dos nichos (R3) e previsão. */
export interface ApoioModelo {
  lambdas: Lambdas;
  contagens?: LambdasContagem;
  dq: DQ;
  /** w do blend pela DQ (V3.3 seção 12) */
  w: number | null;
  /** menor amostra entre os dois times */
  jogosMin?: number;
  rho?: number;
  fracao1T?: number;
  /** vieses conhecidos (16.3 e prior neutro): discordância do modelo é ignorada */
  priorNeutro?: boolean;
  favoritoLigaMaisForte?: boolean;
}

export interface EntradaV4 {
  jogo: { casa: string; fora: string; inicio: string };
  agora?: string;
  linhas: LinhaOdd[];
  /** liga principal (bem coberta): R1 com gate de 2% */
  ligaPrincipal: boolean;
  escalacaoIncerta?: boolean;
  /** entrada motivada por notícia (escalação, lesão) → estratégia S2 */
  noticia?: boolean;
  /** fato concreto e recente que a referência pode não ter */
  fatoNovo?: string;
  apoio?: ApoioModelo;
  /** red team: exigido só quando o preço vem do modelo (R3) */
  redTeam?: RedTeam;
  banca?: number;
  travas?: TravasBanca;
}

export type FiltroModelo = 'concorda' | 'neutro' | 'discorda' | 'no preço' | 'sem modelo';

export interface AvaliacaoV4 {
  chave: string;
  linha: LinhaOdd;
  descricao: string;
  nivel: NivelReferencia;
  estrategia: Estrategia;
  pTrue: number;
  fonteP: string;
  oddJusta: number;
  melhorOdd: number;
  casaMelhorOdd: string;
  oddEfetiva: number;
  horarioColeta?: string;
  horarioReferencia?: string;
  margemReferencia: number;
  casas: number;
  emRisco: number;
  ev: number;
  evMinimo: number | null;
  oddMinima: number | null;
  pModelo: number | null;
  /** consenso das casas sem margem e peso do modelo (usados no R3) */
  pConsenso: number;
  wModelo: number | null;
  filtro: FiltroModelo;
  tese: string;
  nivelMercado: 1 | 2 | 3;
  liq: Liquidador | null;
}

export interface DescarteV4 {
  chave: string;
  descricao: string;
  motivo: string;
}

export interface StakeV4 {
  kellyCheio: number;
  fracaoKelly: number;
  fracaoBanca: number;
  valor?: number;
  ajustes: string[];
}

export interface ResultadoV4 {
  decisao: Decisao;
  rotulo: string;
  motivos: string[];
  gatilho?: string;
  avisos: string[];
  referencia: { nivel: NivelReferencia; afiadas: string[]; moles: string[] };
  avaliadas: AvaliacaoV4[];
  top5: AvaliacaoV4[];
  descartados: DescarteV4[];
  melhor: (AvaliacaoV4 & { stake: StakeV4 | null }) | null;
  sensibilidade: ResultadoSensibilidade | null;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const minutos = (a?: string, b?: string) =>
  a && b ? Math.abs(Date.parse(a) - Date.parse(b)) / 60_000 : null;
const maisRecente = (ps: PrecoCasa[]) =>
  ps
    .map((p) => p.horarioColeta)
    .filter((h): h is string => !!h)
    .sort()
    .at(-1);

export function analisarV4(e: EntradaV4): ResultadoV4 {
  const nomes = { casa: e.jogo.casa, fora: e.jogo.fora };
  const motivos: string[] = [];
  const avisos: string[] = [];
  const descartados: DescarteV4[] = [];
  const inicio = Date.parse(e.jogo.inicio);
  if (!Number.isFinite(inicio)) throw new Error('jogo.inicio inválido (use data/hora ISO 8601)');
  const agora = e.agora ? Date.parse(e.agora) : Date.now();

  const casasNomes = [...new Set(e.linhas.map((l) => l.casa.trim()))];
  const afiadasJogo = casasNomes.filter(ehAfiada);
  const referencia = {
    nivel: (afiadasJogo.length
      ? 'R1'
      : casasNomes.length >= MIN_CASAS_CONSENSO
        ? 'R2'
        : e.apoio
          ? 'R3'
          : 'R4') as NivelReferencia,
    afiadas: afiadasJogo,
    moles: casasNomes.filter((c) => !ehAfiada(c)),
  };
  const vazio = (decisao: Decisao, motivo: string): ResultadoV4 => ({
    decisao,
    rotulo: ROTULO_DECISAO[decisao],
    motivos: [motivo],
    avisos,
    referencia,
    avaliadas: [],
    top5: [],
    descartados,
    melhor: null,
    sensibilidade: null,
  });
  if (agora >= inicio) return vazio('EXCLUIDO', 'jogo iniciado ou encerrado: somente pré-live');
  if (!afiadasJogo.length)
    avisos.push(
      casasNomes.length >= MIN_CASAS_CONSENSO
        ? 'sem Pinnacle/Betfair: P_true pelo consenso das casas (R2), gate mais alto'
        : `sem casa afiada e só ${casasNomes.length} casa(s): mercados principais só com o modelo como apoio (R3); mande a Pinnacle/Betfair ou 4+ casas`,
    );
  const horasAteJogo = (inicio - agora) / 3_600_000;
  if (afiadasJogo.length && horasAteJogo > 24)
    avisos.push(
      'mais de 24 h para o jogo: a referência ainda é linha de abertura, gate do R1 sobe para 3%',
    );

  const precos = precificar(e.linhas, { devig3: 'shin' });
  for (const d of precos.descartes)
    descartados.push({
      chave: d.chave,
      descricao: descreverAposta(d.linha, nomes),
      motivo: d.motivo,
    });

  const ap = e.apoio;
  const modelo: ModeloPlacar | null = ap
    ? criarModelo(ap.lambdas, ap.rho ?? RHO_PADRAO, ap.fracao1T ?? FRACAO_1T, ap.contagens)
    : null;
  const dqOk = !!ap && ap.w !== null && (ap.dq === 'A' || ap.dq === 'B' || ap.dq === 'C');

  const avaliadas: AvaliacaoV4[] = [];
  for (const s of precos.selecoes) {
    const descricao = descreverAposta(s.linha, nomes);
    const descartar = (motivo: string) => descartados.push({ chave: s.chave, descricao, motivo });
    const r = criarLiquidador(s.linha);
    const liq = r.ok ? r.liq : null;
    const nivelMercado = r.nivel;
    const dist =
      liq && modelo && !faltaNoModelo(liq, modelo) ? distribuicaoModelo(liq, modelo) : null;
    const pModelo = dist ? probEfetiva(dist) : null;

    const afiadas = s.precos.filter((p) => ehAfiada(p.casa));
    let nivel: NivelReferencia;
    let pTrue: number;
    let margemRef: number;
    let fonteP: string;
    let candidatos: PrecoCasa[];
    let horarioReferencia: string | undefined;
    let wModelo: number | null = null;
    if (afiadas.length) {
      nivel = 'R1';
      pTrue = mediana(afiadas.map((p) => p.pJusta));
      margemRef = mediana(afiadas.map((p) => p.margem));
      fonteP = `${afiadas.map((p) => p.casa).join('/')} sem margem (${afiadas[0].metodo})`;
      candidatos = s.precos.filter((p) => !ehAfiada(p.casa));
      horarioReferencia = maisRecente(afiadas);
    } else if (s.precos.length >= MIN_CASAS_CONSENSO) {
      nivel = 'R2';
      pTrue = s.pMercado;
      margemRef = s.margem;
      fonteP = `mediana de ${s.precos.length} casas sem margem`;
      candidatos = s.precos;
      // R3 só em nichos e ligas pequenas: em liga principal o modelo encolhe o favorito (16.3)
      // e o "valor" no azarão contra uma casa só é falso (lição 3) → R4
    } else if (pModelo !== null && dqOk && ap && (nivelMercado === 3 || !e.ligaPrincipal)) {
      nivel = 'R3';
      const w = nivelMercado === 3 ? Math.min(ap.w!, W_MAX_NIVEL3) : ap.w!;
      wModelo = w;
      pTrue = blend(pModelo, s.pMercado, w);
      margemRef = s.margem;
      fonteP = `modelo × consenso (w = ${w.toFixed(2)}, ${s.precos.length} casa(s))`;
      candidatos = s.precos;
      if (nivelMercado === 3 && (ap.jogosMin ?? 0) < JOGOS_MIN_NICHO) {
        descartar(`nicho exige ≥${JOGOS_MIN_NICHO} jogos com o dado: só previsão (R4)`);
        continue;
      }
    } else {
      descartar(
        pModelo === null
          ? 'sem referência (afiada ou 4+ casas) e sem modelo para este mercado'
          : !dqOk
            ? 'sem referência e DQ do modelo abaixo de C: só previsão (R4)'
            : 'liga principal sem referência: o modelo não precifica mercado principal (R4, lição 3); mande Pinnacle/Betfair ou 4+ casas',
      );
      continue;
    }

    if (margemRef > MARGEM_MAXIMA_REF) {
      descartar(`margem da referência ${pct(margemRef)} > 10%: só informação`);
      continue;
    }
    if (!candidatos.length) {
      descartar('só a casa de referência tem este mercado: falta casa mole para comparar');
      continue;
    }
    const melhor = candidatos.reduce((a, b) =>
      oddEfetiva(b.casa, b.odd) > oddEfetiva(a.casa, a.odd) ? b : a,
    );
    const gap = minutos(melhor.horarioColeta, horarioReferencia);
    if (nivel === 'R1' && gap !== null && gap > JANELA_COMPARAVEL_MIN) {
      descartar(
        `odds com ${gap.toFixed(0)} min de diferença entre a referência e a ${melhor.casa}: não comparáveis (máx. ${JANELA_COMPARAVEL_MIN})`,
      );
      continue;
    }

    const efetiva = oddEfetiva(melhor.casa, melhor.odd);
    const emRisco = dist ? fracaoEmRisco(dist) : 1;
    const ev = emRisco * (pTrue * efetiva - 1);
    const evMinimo = gateV4(nivel, {
      ligaPrincipal: e.ligaPrincipal,
      horasAteJogo,
      odd: melhor.odd,
      escalacaoIncerta: e.escalacaoIncerta,
    });
    const filtro: FiltroModelo =
      nivel === 'R3'
        ? 'no preço'
        : pModelo === null
          ? 'sem modelo'
          : pModelo - pTrue < -DISCORDANCIA_FORTE
            ? 'discorda'
            : pModelo - pTrue > 0.02
              ? 'concorda'
              : 'neutro';
    const tese: IdTese | null = liq && modelo && pModelo !== null ? teseDe(liq, modelo) : null;
    avaliadas.push({
      chave: s.chave,
      linha: melhor.linha,
      descricao,
      nivel,
      estrategia: nivel === 'R3' ? 'S3' : e.noticia ? 'S2' : 'S1',
      pTrue,
      fonteP,
      oddJusta: 1 / pTrue,
      melhorOdd: melhor.odd,
      casaMelhorOdd: melhor.casa,
      oddEfetiva: efetiva,
      horarioColeta: melhor.horarioColeta,
      horarioReferencia,
      margemReferencia: margemRef,
      casas: s.precos.length,
      emRisco,
      ev,
      evMinimo,
      oddMinima: evMinimo === null ? null : (1 + evMinimo / emRisco) / pTrue,
      pModelo,
      pConsenso: s.pMercado,
      wModelo,
      filtro,
      tese: tese ? NOMES_TESE[tese] : `mercado ${chaveGrupo(s.linha)}`,
      nivelMercado,
      liq,
    });
  }

  // ranking pela folga sobre o próprio gate (R1 a 2% e R3 a 5% não competem pelo EV cru)
  const folga = (a: AvaliacaoV4) => a.ev - (a.evMinimo ?? Infinity);
  avaliadas.sort((a, b) => folga(b) - folga(a) || b.ev - a.ev);
  const base: Omit<ResultadoV4, 'decisao' | 'rotulo' | 'gatilho' | 'melhor' | 'sensibilidade'> = {
    motivos,
    avisos,
    referencia,
    avaliadas,
    top5: avaliadas.slice(0, 5),
    descartados,
  };
  const fim = (
    decisao: Decisao,
    melhor: ResultadoV4['melhor'] = null,
    gatilho?: string,
    sensibilidade: ResultadoSensibilidade | null = null,
  ): ResultadoV4 => ({
    ...base,
    decisao,
    rotulo: ROTULO_DECISAO[decisao],
    gatilho,
    melhor,
    sensibilidade,
  });

  // EV > 15% contra a referência = provável erro: nenhum candidato passa por cima disso
  const suspeita = avaliadas.find((a) => a.ev > EV_INVESTIGAR_V4);
  if (suspeita) {
    motivos.push(
      `EV ${pct(suspeita.ev)} em "${suspeita.descricao.replace('Ganha se: ', '')}" (${suspeita.casaMelhorOdd}) > 15%: presumir erro (odd lida errado, regra de mercado diferente, linha suspensa) → conferir`,
    );
    return fim('INVESTIGAR', { ...suspeita, stake: null });
  }
  const c = avaliadas[0];
  if (!c) {
    motivos.push('nenhum mercado com referência e casa mole para comparar');
    return fim('NO_BET');
  }
  const comC = (d: Decisao, gatilho?: string, sens: ResultadoSensibilidade | null = null) =>
    fim(d, { ...c, stake: null }, gatilho, sens);
  if (c.evMinimo === null || c.ev < c.evMinimo) {
    motivos.push(
      `melhor preço: ${c.descricao.replace('Ganha se: ', '')} @ ${c.melhorOdd} (${c.casaMelhorOdd}) com EV ${pct(c.ev)}, abaixo do gate de ${pct(c.evMinimo ?? 0)} (${c.nivel})`,
    );
    return comC('NO_BET');
  }
  if (!c.horarioColeta || (c.nivel === 'R1' && !c.horarioReferencia)) {
    motivos.push(
      'odd sem horário de coleta: não dá para garantir que referência e casa mole são do mesmo momento',
    );
    return comC('WATCHLIST', 'recoletar os prints com o horário visível');
  }

  const ajustesStake: string[] = [];
  let fatorFiltro = 1;
  if (c.filtro === 'discorda') {
    const vies = ap?.priorNeutro || ap?.favoritoLigaMaisForte;
    if (vies) {
      avisos.push(
        `modelo discorda (${pct(c.pModelo!)} × P_true ${pct(c.pTrue)}), mas pelo viés conhecido (${ap?.favoritoLigaMaisForte ? '16.3 liga mais forte' : 'prior neutro'}): ignorado`,
      );
    } else if (e.fatoNovo) {
      motivos.push(
        `PASS: modelo discorda em ${pct(c.pTrue - c.pModelo!)} e há fato novo que a referência pode não ter (${e.fatoNovo})`,
      );
      return comC('NO_BET');
    } else {
      fatorFiltro = 0.5;
      ajustesStake.push(`modelo discorda em ${pct(c.pTrue - c.pModelo!)}: stake pela metade`);
    }
  }

  let sens: ResultadoSensibilidade | null = null;
  if (c.nivel === 'R3' && ap && c.liq) {
    sens = analisarSensibilidade({
      liq: c.liq,
      lambdas: ap.lambdas,
      lambdaMercado: null,
      rho: ap.rho ?? RHO_PADRAO,
      fracao1T: ap.fracao1T ?? FRACAO_1T,
      pMercado: c.pTrue,
      w: 0,
      odd: c.oddEfetiva,
      contagens: ap.contagens,
    });
    // o preço do R3 é do modelo: a sensibilidade avalia o P_modelo nos cenários
    const ev = (p: number) =>
      c.emRisco * (blend(p, c.pConsenso, c.wModelo ?? 0) * c.oddEfetiva - 1);
    const positivos = sens.cenarios.filter((x) => ev(x.pModelo) > 0).length;
    if (positivos <= sens.cenarios.length / 2) {
      motivos.push(
        `preço do modelo FRÁGIL (${positivos}/${sens.cenarios.length} cenários com EV > 0)`,
      );
      return comC('NO_BET', undefined, sens);
    }
    if (e.redTeam && !e.redTeam.sobreviveu) {
      motivos.push('red team derrubou a tese');
      return comC('NO_BET', undefined, sens);
    }
    if (!e.redTeam || e.redTeam.argumentos.length < 3 || !e.redTeam.atacaPremissa) {
      motivos.push('nicho com preço do modelo (R3): red team pendente');
      return comC('WATCHLIST', 'completar o red team', sens);
    }
  }

  const t = e.travas;
  if (t?.pausadoAte) {
    motivos.push(...t.motivos.filter((m) => m.includes('pausa')));
    return comC('NO_BET', undefined, sens);
  }
  if (t?.diaEncerrado) {
    motivos.push(`${t.perdasHoje} perdas hoje: dia encerrado`);
    return comC('NO_BET', undefined, sens);
  }
  const folgaDia = TETO_DIA - (t?.expostoHoje ?? 0);
  if (folgaDia <= 0) {
    motivos.push('teto de 6% da banca no dia já atingido');
    return comC('WATCHLIST', 'só amanhã', sens);
  }

  const nivelStake = c.nivel as 'R1' | 'R2' | 'R3';
  const k = kellyCheio(c.pTrue, c.oddEfetiva);
  let fracaoKelly = KELLY_V4[nivelStake] * fatorFiltro;
  if (t && t.fatorKelly < 1) {
    fracaoKelly *= t.fatorKelly;
    ajustesStake.push('drawdown ≥ 20%: fração de Kelly pela metade');
  }
  let fracaoBanca = Math.max(0, k) * fracaoKelly;
  const teto = TETO_APOSTA_V4[nivelStake];
  if (fracaoBanca > teto) {
    fracaoBanca = teto;
    ajustesStake.push(`teto de ${pct(teto)} por aposta`);
  }
  if (fracaoBanca > folgaDia) {
    fracaoBanca = folgaDia;
    ajustesStake.push('limitada pelo que resta do teto de 6% no dia');
  }
  const banca = t?.bancaAtual ?? e.banca;
  const stake: StakeV4 = {
    kellyCheio: k,
    fracaoKelly,
    fracaoBanca,
    valor: banca !== undefined ? Math.round(banca * fracaoBanca * 100) / 100 : undefined,
    ajustes: ajustesStake,
  };
  motivos.push(
    `${c.descricao.replace('Ganha se: ', '')} @ ${c.melhorOdd} (${c.casaMelhorOdd}) contra P_true ${pct(c.pTrue)} (${c.fonteP}): EV ${pct(c.ev)} ≥ gate ${pct(c.evMinimo)} · ${NOMES_ESTRATEGIA[c.estrategia]}`,
  );
  return fim(
    'BET',
    { ...c, stake },
    `BET somente se odd ≥ ${c.oddMinima!.toFixed(2)} na ${c.casaMelhorOdd}`,
    sens,
  );
}
