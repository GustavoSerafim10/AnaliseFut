/**
 * Comparação reduzida do reprocessamento de uma entrada do histórico: o resumo GRAVADO contra
 * o resumo que o build de referência produz com o mesmo rascunho.
 *
 * Campos de decisão, sem tolerância: decisão, DQ e a seleção técnica (chave, odd, casa, EV,
 * P, nível). D-d: stake e lista "Melhores entradas" dependem de travas e apostas registradas que
 * o histórico não guarda → nao-comparavel. Se a aposta foi escolhida na lista, o site troca
 * resumo.entrada pela aposta → a seleção técnica também é nao-comparavel. D-c: protocolo gravado
 * diferente de V4 → "protocolo-diferente", sem concorda/diverge (proteção 4).
 */
import { chaveSelecao, type LinhaOdd } from '@pe/engine';
import { tipoDe } from './comparar';
import type { ValorComparado } from './contrato';
import type { CampoComparado, Comparacao } from './contratoReprocessamento';

interface EntradaResumo {
  linha?: unknown;
  odd?: unknown;
  casa?: unknown;
  ev?: unknown;
  pFinal?: unknown;
  nivel?: unknown;
  stake?: unknown;
  stakeValor?: unknown;
}
export interface ResumoComparavel {
  decisao?: unknown;
  dq?: unknown;
  protocolo?: unknown;
  entrada?: EntradaResumo | null;
  confianca?: unknown;
}

const valor = (x: unknown): ValorComparado => {
  const tipo = tipoDe(x);
  if (tipo === 'numero' || tipo === 'texto' || tipo === 'booleano')
    return { tipo, valor: x as number | string | boolean };
  if (tipo === 'lista') return { tipo, tamanho: (x as unknown[]).length };
  return { tipo };
};

/** igualdade estrita: mesmo tipo e, para escalares, o mesmo valor (Object.is) */
const iguais = (a: unknown, b: unknown) => {
  const ta = tipoDe(a);
  if (ta !== tipoDe(b)) return false;
  if (ta === 'numero' || ta === 'texto' || ta === 'booleano') return Object.is(a, b);
  return ta !== 'objeto' && ta !== 'lista';
};

const chaveDa = (e: EntradaResumo | null | undefined): string | null => {
  const l = e?.linha as LinhaOdd | undefined;
  if (!l || typeof l !== 'object' || typeof l.mercado !== 'string') return null;
  try {
    return chaveSelecao(l);
  } catch {
    return null;
  }
};

export function compararResumo(
  gravado: ResumoComparavel,
  reprocessado: ResumoComparavel,
  o: { entradaSubstituidaPelaAposta: boolean },
): { comparacao: Comparacao; campos: CampoComparado[] } {
  const campos: CampoComparado[] = [];
  const comparar = (campo: string, a: unknown, b: unknown) =>
    campos.push({
      campo,
      estado: iguais(a, b) ? 'igual' : 'diferente',
      original: valor(a),
      reproduzido: valor(b),
    });
  const naoComparavel = (campo: string, motivo: string) =>
    campos.push({ campo, estado: 'nao-comparavel', motivo });

  comparar('decisao', gravado.decisao, reprocessado.decisao);
  comparar('dq', gravado.dq, reprocessado.dq);

  const eg = gravado.entrada ?? null;
  const er = reprocessado.entrada ?? null;
  if (o.entradaSubstituidaPelaAposta) {
    naoComparavel(
      'entrada',
      'a aposta foi escolhida na lista "Melhores entradas": o site troca resumo.entrada pela aposta',
    );
  } else {
    comparar('entrada.presente', !!eg, !!er);
    if (eg || er) {
      comparar('entrada.chave', chaveDa(eg), chaveDa(er));
      for (const k of ['odd', 'casa', 'ev', 'pFinal', 'nivel'] as const)
        comparar(`entrada.${k}`, eg?.[k] ?? null, er?.[k] ?? null);
    }
  }
  naoComparavel('entrada.stake', 'D-d: depende das travas da banca, que o histórico não guarda');
  naoComparavel(
    'confianca',
    'D-d: a lista "Melhores entradas" depende de travas e apostas registradas, que o histórico não guarda',
  );

  const comparacao: Comparacao =
    gravado.protocolo !== 'V4'
      ? 'protocolo-diferente'
      : campos.some((c) => c.estado === 'diferente')
        ? 'diverge'
        : 'concorda';
  return { comparacao, campos };
}
