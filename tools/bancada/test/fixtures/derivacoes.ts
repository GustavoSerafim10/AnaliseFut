/**
 * Cenário sintético da F1.3 (funções reais do site, nenhum dado real):
 *  jogo-r      evidência R1 (exemplo com Pinnacle), placar 2×1, aposta feita
 *  r3          evidência R3 (uma casa só, liga não marcada como principal), placar 2×1
 *  jogo-lista  evidência com a lista "Melhores entradas" (over 2,5 na lista e na V4)
 *  v1          sem evidência (backup antigo), placar 2×1 → só desfecho (E4)
 *  man         sem evidência, placar 2×1, over 2,5 GANHA mas a marcação manual é "red" → conflito
 *  man2        sem evidência, SEM placar, marcação "red" → sem-placar (não conflito)
 */
import { vi } from 'vitest';
import { derivar as derivarSite } from '../../../../apps/web/src/dados';
import { montarEvidencia, type Evidencia } from '../../../../apps/web/src/evidencias';
import { rascunhoExemplo } from '../../../../apps/web/src/exemplo';
import { salvarNoHistorico, type EntradaHistorico } from '../../../../apps/web/src/historico';
import type { ArquivoEntrada } from '../../src/index';
import {
  AGORA,
  backupGz,
  backupV1,
  cenario,
  cenarioComLista,
  comApostaEResultado,
} from './geradores';
import { buildGravado, evidenciaReproduzivel } from './reproducao';

export const C = 'a'.repeat(40);

/** Jogo de uma casa só (Superbet) numa liga não marcada como principal: a V4 usa R3. */
export async function cenarioR3(): Promise<{ ev: Evidencia; entrada: EntradaHistorico }> {
  vi.useFakeTimers({ now: AGORA, toFake: ['Date'] });
  try {
    const r0 = rascunhoExemplo();
    const r = {
      ...r0,
      idHistorico: 'r3',
      jogo: { ...r0.jogo, casa: 'Remo', fora: 'Paysandu', competicao: 'Série C' },
      casas: ['Superbet'],
      odds: r0.odds.filter((o) => o.casa === 'Superbet'),
      config: { ...r0.config, ligaTop: false },
    };
    const d = derivarSite(r);
    const inicio = new Date().toISOString();
    const ev = await montarEvidencia(
      'r3',
      r,
      d,
      { calculadoEm: { inicio, fim: inicio } },
      buildGravado(C),
      inicio,
    );
    const { lista } = salvarNoHistorico([], r, d, undefined, Date.now());
    return { ev: { ...ev, meta: { ...ev.meta, revisao: 1 } }, entrada: lista[0] };
  } finally {
    vi.useRealTimers();
  }
}

export async function arquivosDerivacoes(
  o: { adulterarLambda?: boolean } = {},
): Promise<ArquivoEntrada[]> {
  const base = (await cenario()).entrada;
  const e = (id: string, f: (x: EntradaHistorico) => void = () => undefined) => {
    const x = { ...structuredClone(base), id };
    f(x);
    return x;
  };
  let evR = await evidenciaReproduzivel(buildGravado(C));
  if (o.adulterarLambda) {
    // λ gravado diferente do que gerou o pModelo gravado: o recálculo tem de divergir
    const c = structuredClone(evR.conteudo) as unknown as {
      modelo: { lambda: { lambdas: { casa: number } } };
      avaliacao: { v33: { lambdaModelo: { ajustado: { casa: number } } } | null };
    };
    c.modelo.lambda.lambdas.casa += 0.4;
    if (c.avaliacao.v33) c.avaliacao.v33.lambdaModelo.ajustado.casa += 0.4;
    evR = { ...evR, conteudo: c as unknown as Evidencia['conteudo'] };
    const { impressaoDigital } = await import('../../../../apps/web/src/evidencias');
    evR = { ...evR, meta: { ...evR.meta, hash: await impressaoDigital(evR.conteudo) } };
  }
  const r3 = await cenarioR3();
  const lista = await cenarioComLista();
  const placar21 = (x: EntradaHistorico) =>
    comApostaEResultado(x, { oddFechamento: 1.8, fechamentoOutros: [2.1] });
  const semAposta = (x: EntradaHistorico): EntradaHistorico => ({
    ...placar21(x),
    aposta: undefined,
  });

  const v3 = [placar21(e('jogo-r')), semAposta({ ...r3.entrada }), semAposta({ ...lista.entrada })];
  const v1 = [
    semAposta(e('v1', (x) => (x.rascunho.jogo.casa = 'Bahia'))),
    { ...semAposta(e('man', (x) => (x.rascunho.jogo.casa = 'Vasco'))), manual: 'red' as const },
    { ...e('man2', (x) => (x.rascunho.jogo.casa = 'Ceará')), manual: 'red' as const },
  ];
  return [
    {
      nome: 'derivacoes.json.gz',
      bytes: await backupGz(v3, [evR, r3.ev, ...lista.revisoes.slice(0, 3)]),
    },
    { nome: 'derivacoes-v1.json', bytes: backupV1(v1) },
  ];
}
