/**
 * Melhores entradas: as apostas com mais chance de green na faixa de odds escolhida pelo usuário,
 * ordenadas pela chance. Não substitui a V4.0, que continua como análise técnica: esta lista
 * funciona com poucas casas, mas só mostra o que as estatísticas sustentam e o que paga acima do
 * acerto mínimo da odd (1 / odd). Chance = modelo × mercado sem margem, com o mesmo peso da V3.3.
 */
import type { TravasBanca } from './banca';
import { TETO_DIA } from './banca';
import { descreverAposta } from './descricao';
import { blend, W_MAX_NIVEL3 } from './gates';
import { fracaoEmRisco, probEfetiva } from './liquidacao';
import {
  criarLiquidador,
  criarModelo,
  distribuicaoModelo,
  faltaNoModelo,
  FRACAO_1T,
  type Liquidador,
} from './mercados';
import { RHO_PADRAO } from './poisson';
import { mediana, precificar } from './precificacao';
import type { LinhaOdd } from './tipos';
import {
  ehAfiada,
  EV_INVESTIGAR_V4,
  JOGOS_MIN_NICHO,
  MARGEM_MAXIMA_REF,
  MIN_CASAS_CONSENSO,
  oddEfetiva,
  type ApoioModelo,
} from './v4';

export const ODD_MIN_ENTRADA = 1.4;
export const ODD_MAX_ENTRADA = 2;
/** modelo × mercado acima disso quase sempre é leitura errada ou ponto cego, não valor */
export const DIVERGENCIA_MAX_ENTRADA = 0.15;
export const DIVERGENCIA_SINAL_FORTE = 0.1;
/** sinal forte pede chance alta de fato e alguma folga sobre o acerto mínimo da odd */
export const CHANCE_SINAL_FORTE = 0.6;
export const FOLGA_SINAL_FORTE = 0.005;
export const STAKE_ENTRADA = 0.01;
export const MAX_ENTRADAS = 5;

export type ForcaSinal = 'forte' | 'media';

export interface EntradaSugerida {
  chave: string;
  linha: LinhaOdd;
  descricao: string;
  odd: number;
  casa: string;
  /** chance estimada de green */
  chance: number;
  /** acerto mínimo para a odd não dar prejuízo */
  minimo: number;
  pModelo: number;
  pMercado: number;
  /** o preço de referência veio de Pinnacle/Betfair */
  referenciaAfiada: boolean;
  casas: number;
  ev: number;
  forca: ForcaSinal;
  /** fração da banca sugerida, já com as travas */
  stake: number;
  stakeValor?: number;
}

export interface EntradaRecusada {
  chave: string;
  descricao: string;
  odd: number;
  motivo: string;
}

export type StatusEntradas =
  'ok' | 'jogo_iniciado' | 'sem_estatisticas' | 'dados_fracos' | 'sem_mercados';

export interface ResultadoEntradas {
  status: StatusEntradas;
  entradas: EntradaSugerida[];
  recusadas: EntradaRecusada[];
  /** motivo da banca para não apostar agora (a lista continua visível) */
  bloqueio?: string;
}

export interface PedidoEntradas {
  jogo: { casa: string; fora: string; inicio: string };
  linhas: LinhaOdd[];
  apoio?: ApoioModelo;
  /** liga bem coberta: aposta no azarão só com referência confiável */
  ligaPrincipal?: boolean;
  agora?: string;
  banca?: number;
  travas?: TravasBanca;
}

const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',')}%`;

function stakeDa(t?: TravasBanca): number {
  const folgaDia = TETO_DIA - (t?.expostoHoje ?? 0);
  return Math.max(0, Math.min(STAKE_ENTRADA * (t?.fatorKelly ?? 1), folgaDia));
}

function bloqueioDa(t?: TravasBanca): string | undefined {
  if (t?.pausadoAte) return `Banca em pausa até ${t.pausadoAte.slice(0, 10)}`;
  if (t?.diaEncerrado) return `${t.perdasHoje} perdas hoje: dia encerrado`;
  if (t && TETO_DIA - t.expostoHoje <= 0) return 'Teto de 6% da banca no dia já atingido';
  return undefined;
}

/** Time que a aposta favorece: compara como ela paga numa goleada de cada lado. */
function timeFavorecido(liq: Liquidador): 'casa' | 'fora' | null {
  if (liq.tipo !== 'placar') return null;
  const casa = liq.fn(3, 0);
  const fora = liq.fn(0, 3);
  return casa > fora ? 'casa' : fora > casa ? 'fora' : null;
}

export function melhoresEntradas(e: PedidoEntradas): ResultadoEntradas {
  const nomes = { casa: e.jogo.casa, fora: e.jogo.fora };
  const bloqueio = bloqueioDa(e.travas);
  const vazio = (status: StatusEntradas): ResultadoEntradas => ({
    status,
    entradas: [],
    recusadas: [],
    bloqueio,
  });
  const inicio = Date.parse(e.jogo.inicio);
  const agora = e.agora ? Date.parse(e.agora) : Date.now();
  if (Number.isFinite(inicio) && agora >= inicio) return vazio('jogo_iniciado');
  const ap = e.apoio;
  if (!ap) return vazio('sem_estatisticas');
  if (ap.w === null || !['A', 'B', 'C'].includes(ap.dq)) return vazio('dados_fracos');

  const modelo = criarModelo(
    ap.lambdas,
    ap.rho ?? RHO_PADRAO,
    ap.fracao1T ?? FRACAO_1T,
    ap.contagens,
  );
  const stake = stakeDa(e.travas);
  const banca = e.travas?.bancaAtual ?? e.banca;
  const entradas: EntradaSugerida[] = [];
  const recusadas: EntradaRecusada[] = [];

  const selecoes = precificar(e.linhas, { devig3: 'shin' }).selecoes;
  const p1x2 = (lado: string) =>
    selecoes.find(
      (s) => s.linha.mercado === '1X2' && s.linha.periodo === 'FT' && s.chave.endsWith(`|${lado}`),
    )?.pMercado;
  const pCasa = p1x2('1') ?? ap.lambdas.casa;
  const pFora = p1x2('2') ?? ap.lambdas.fora;
  const azarao = pCasa < pFora ? 'casa' : pFora < pCasa ? 'fora' : null;

  for (const s of selecoes) {
    const candidatos = s.precos.filter(
      (p) => !ehAfiada(p.casa) && p.odd >= ODD_MIN_ENTRADA && p.odd <= ODD_MAX_ENTRADA,
    );
    if (!candidatos.length) continue;
    const melhor = candidatos.reduce((a, b) =>
      oddEfetiva(b.casa, b.odd) > oddEfetiva(a.casa, a.odd) ? b : a,
    );
    const descricao = descreverAposta(s.linha, nomes);
    const recusar = (motivo: string) =>
      recusadas.push({ chave: s.chave, descricao, odd: melhor.odd, motivo });

    const r = criarLiquidador(s.linha);
    if (!r.ok || faltaNoModelo(r.liq, modelo)) {
      recusar('as estatísticas coladas não cobrem este mercado');
      continue;
    }
    if (r.nivel === 3 && (ap.jogosMin ?? 0) < JOGOS_MIN_NICHO) {
      recusar(`escanteios e cartões exigem ${JOGOS_MIN_NICHO} jogos ou mais de cada time`);
      continue;
    }
    const afiadas = s.precos.filter((p) => ehAfiada(p.casa));
    // lição 3: em liga principal o modelo encolhe o favorito, e o "valor" no azarão é falso
    if (
      e.ligaPrincipal &&
      !afiadas.length &&
      s.precos.length < MIN_CASAS_CONSENSO &&
      azarao &&
      timeFavorecido(r.liq) === azarao
    ) {
      recusar(
        `aposta no azarão: em liga principal, o modelo tende a subestimar o favorito. Só com Pinnacle/Betfair ou ${MIN_CASAS_CONSENSO}+ casas`,
      );
      continue;
    }
    const pMercado = afiadas.length ? mediana(afiadas.map((p) => p.pJusta)) : s.pMercado;
    const margem = afiadas.length ? mediana(afiadas.map((p) => p.margem)) : s.margem;
    if (margem > MARGEM_MAXIMA_REF) {
      recusar(`margem de ${pct(margem)} na casa: preço ruim demais para servir de base`);
      continue;
    }
    const dist = distribuicaoModelo(r.liq, modelo);
    const pModelo = probEfetiva(dist);
    if (Math.abs(pModelo - pMercado) > DIVERGENCIA_MAX_ENTRADA) {
      recusar(
        `modelo ${pct(pModelo)} × mercado ${pct(pMercado)}: diferença tão grande costuma ser leitura errada ou ponto cego`,
      );
      continue;
    }
    const efetiva = oddEfetiva(melhor.casa, melhor.odd);
    const minimo = 1 / efetiva;
    if (pModelo < minimo) {
      recusar(`as estatísticas dão ${pct(pModelo)}, abaixo do mínimo de ${pct(minimo)} da odd`);
      continue;
    }
    const w = r.nivel === 3 ? Math.min(ap.w, W_MAX_NIVEL3) : ap.w;
    const chance = blend(pModelo, pMercado, w);
    const ev = fracaoEmRisco(dist) * (chance * efetiva - 1);
    if (ev <= 0) {
      recusar(`chance de ${pct(chance)}, abaixo do mínimo de ${pct(minimo)} da odd`);
      continue;
    }
    if (ev > EV_INVESTIGAR_V4) {
      recusar(`vantagem de ${pct(ev)} é boa demais: conferir se a odd foi lida certo`);
      continue;
    }
    entradas.push({
      chave: s.chave,
      linha: melhor.linha,
      descricao,
      odd: melhor.odd,
      casa: melhor.casa,
      chance,
      minimo,
      pModelo,
      pMercado,
      referenciaAfiada: afiadas.length > 0,
      casas: s.precos.length,
      ev,
      // cartões e escanteios têm pontos cegos conhecidos (clássico, árbitro): nunca sinal forte
      forca:
        r.nivel !== 3 &&
        (ap.dq === 'A' || ap.dq === 'B') &&
        chance >= CHANCE_SINAL_FORTE &&
        chance - minimo >= FOLGA_SINAL_FORTE &&
        Math.abs(pModelo - pMercado) <= DIVERGENCIA_SINAL_FORTE
          ? 'forte'
          : 'media',
      stake,
      stakeValor: banca !== undefined ? Math.round(banca * stake * 100) / 100 : undefined,
    });
  }

  entradas.sort((a, b) => b.chance - a.chance || b.ev - a.ev);
  if (!entradas.length && !recusadas.length) return vazio('sem_mercados');
  return { status: 'ok', entradas: entradas.slice(0, MAX_ENTRADAS), recusadas, bloqueio };
}
