/**
 * Apostas feitas de verdade (botão "Entrei"): odd usada, odd efetiva (comissão da Exchange, a
 * mesma convenção do EV da V4), faixa pela odd usada e CLV padronizado contra o fechamento
 * registrado. O fechamento é o do lado apostado, informado à mão (lacuna G1), sem horário.
 */
import { chaveSelecao, oddEfetiva, resolverCasa, type LinhaOdd } from '@pe/engine';
import type { EntradaHistorico } from '../../../../apps/web/src/historico';
import { clvPadronizado, type ClvPadronizado } from './clv';
import { ehPreferencial, faixaDe, type IdFaixa } from './faixas';
import { estadoResultado, type EstadoResultado } from './jogos';
import { classificarMercado, type ClasseMercado } from './mercados';

export interface Aposta extends Partial<ClasseMercado> {
  idHistorico: string;
  chaveJogo: string;
  irmaDe: string | null;
  /** escolhida na lista "Melhores entradas" (aposta.entrada) ou a entrada da análise */
  origemEntrada: 'lista' | 'analise';
  casa: string;
  operador: string;
  oddUsada: number | null;
  /** odd que entra no retorno: na Betfair Exchange, depois da comissão */
  oddUsadaEfetiva: number | null;
  valor: number | null;
  feitaEm: string | null;
  faixaUsada: IdFaixa | null;
  preferencial: boolean;
  estadoResultado: EstadoResultado;
  manual: string | null;
  /** CLV com a odd efetiva (oficial) e com a odd nominal (referência) */
  clv: ClvPadronizado;
  clvNominal: ClvPadronizado;
}

const finito = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function montarAposta(e: EntradaHistorico, chave: string): Aposta | null {
  const a = e.aposta;
  if (!a || !e.resumo.entrada) return null;
  const linha = (a.entrada?.linha ?? e.resumo.entrada.linha) as LinhaOdd | undefined;
  const odd = finito(a.odd) && a.odd > 1 ? a.odd : null;
  const efetiva = odd !== null ? oddEfetiva(a.casa, odd) : null;
  const r = e.resultado;
  return {
    ...(linha ? classificarMercado(linha) : {}),
    ...(linha ? { chave: chaveSelecao(linha) } : {}),
    idHistorico: e.id,
    chaveJogo: chave,
    irmaDe: e.irmaDe ?? null,
    origemEntrada: a.entrada ? 'lista' : 'analise',
    casa: a.casa,
    operador: resolverCasa(a.casa).operatorId,
    oddUsada: odd,
    oddUsadaEfetiva: efetiva,
    valor: finito(a.valor) ? a.valor : null,
    feitaEm: a.feitaEm ?? null,
    faixaUsada: faixaDe(odd),
    preferencial: ehPreferencial(faixaDe(odd)),
    estadoResultado: estadoResultado(e),
    manual: e.manual ?? null,
    clv: clvPadronizado(efetiva, r?.oddFechamento, r?.fechamentoOutros),
    clvNominal: clvPadronizado(odd, r?.oddFechamento, r?.fechamentoOutros),
  };
}
