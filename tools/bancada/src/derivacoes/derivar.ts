/**
 * Derivações da F1.3, por universo (seleções, entradas das análises, apostas), com exatamente um
 * estado por registro e conservação conferida na execução. Conferências obrigatórias contra o
 * que a evidência gravou (tolerância D3): P do modelo ajustado, w e P_true no R3, chance da lista.
 * Divergência marca o registro como "derivacao-divergente" — nunca corrige em silêncio.
 */
import { blend, chaveSelecao, type LinhaOdd } from '@pe/engine';
import type { Evidencia } from '../../../../apps/web/src/evidencias';
import type { Conjunto } from '../index';
import { identidadeEvidencia, type Juncao } from '../leitura/juntarBackups';
import { dentroDaTolerancia } from '../reproducao/comparar';
import type { Consolidado } from '../reproducao/contratoConsolidacao';
import {
  VERSAO_CONTRATO_DERIVACOES,
  type Conferencia,
  type DerivacaoSelecao,
  type Derivacoes,
  type DesfechoAposta,
  type DesfechoEntrada,
} from './contratoDerivacoes';
import { apurarDesfecho } from './desfecho';
import { insumosDaEvidencia, pModeloDe, wDe } from './modelo';

export const MOTOR_ATUAL =
  'motor atual (@pe/engine da árvore de trabalho), conferido contra a evidência';

interface AvaliadaGravada {
  chave?: unknown;
  pModelo?: unknown;
  wModelo?: unknown;
  pTrue?: unknown;
  nivel?: unknown;
}
/** chave da seleção sem lançar em linha malformada */
const chaveSegura = (l: LinhaOdd): string | null => {
  try {
    return chaveSelecao(l);
  } catch {
    return null;
  }
};
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function derivar(x: {
  conjunto: Omit<Conjunto, 'impressao'>;
  juncao: Juncao;
  consolidado?: Consolidado | null;
  motor?: string;
}): Derivacoes {
  const { conjunto, juncao } = x;
  const analisePorId = new Map(conjunto.analises.map((a) => [a.idHistorico, a]));
  const entradaPorId = new Map(juncao.entradas.map((c) => [c.entrada.id, c.entrada]));
  const evPorIdent = new Map<string, Evidencia>(
    juncao.evidencias.map((ev) => [identidadeEvidencia(ev), ev]),
  );
  const jogoPorChave = new Map(conjunto.jogos.map((j) => [j.chaveJogo, j]));
  const statusSel = new Map(
    (x.consolidado?.selecoes ?? []).map((s) => [`${s.idHistorico}#${s.chave}`, s.status]),
  );
  const statusAnalise = new Map(
    (x.consolidado?.analises ?? []).map((a) => [a.idHistorico, a.status]),
  );
  const statusAposta = new Map(
    (x.consolidado?.apostas ?? []).map((a) => [a.idHistorico, a.status]),
  );

  const jogoDe = (idHistorico: string) => {
    const a = analisePorId.get(idHistorico);
    const j = a ? jogoPorChave.get(a.chaveJogo) : undefined;
    return { placar: j?.placar ?? null, conflitoPlacar: j?.conflitoPlacar ?? false };
  };
  /** linha da entrada registrada (a aposta da lista troca resumo.entrada) e a marcação manual */
  const entradaRegistrada = (idHistorico: string) => {
    const e = entradaPorId.get(idHistorico);
    const linha = (e?.aposta?.entrada?.linha ?? e?.resumo?.entrada?.linha) as LinhaOdd | undefined;
    return { linha: linha ?? null, manual: e?.manual ?? null };
  };

  // ---------- seleções: modelo, mistura, desfecho ----------
  const selecoes: DerivacaoSelecao[] = conjunto.selecoes.map((s) => {
    const a = analisePorId.get(s.idHistorico);
    const ev = a?.identidadeDecisao ? evPorIdent.get(a.identidadeDecisao) : undefined;
    const reg = entradaRegistrada(s.idHistorico);
    const ehEntrada = reg.linha ? chaveSegura(reg.linha) === s.chave : false;
    const l = linhaDaSelecao(s, ev) as LinhaOdd;
    const linha = (
      ev?.conteudo.avaliacao as { v4?: { avaliadas?: AvaliadaGravada[] } } | undefined
    )?.v4?.avaliadas?.find((v) => v.chave === s.chave);
    const d: DerivacaoSelecao = {
      idHistorico: s.idHistorico,
      chave: s.chave,
      chaveGrupo: s.chaveGrupo,
      status: statusSel.get(`${s.idHistorico}#${s.chave}`) ?? null,
      estado: 'sem-modelo',
      motivo: null,
      nivelReferencia: s.nivelReferencia,
      pModeloBruto: null,
      pModeloAjustado: null,
      wMistura: null,
      pMercadoBase: null,
      pMistura: null,
      pMisturaBruta: null,
      conferencias: [],
      desfecho: apurarDesfecho(l, jogoDe(s.idHistorico), ehEntrada ? reg.manual : null),
    };
    if (!ev) {
      d.estado = 'indisponivel-sem-evidencia';
      d.motivo = 'seleção sem revisão de decisão na junção';
      return d;
    }
    const ins = insumosDaEvidencia(ev);
    if (!ins.lambdasAjustado || !ins.lambdasBruto) {
      d.motivo = 'a evidência não tem λ do modelo';
      return d;
    }
    const aj = pModeloDe(l, ins.lambdasAjustado, ins.contagens);
    const br = pModeloDe(l, ins.lambdasBruto, ins.contagens);
    if (aj.p === null) {
      d.motivo = aj.motivo;
      return d;
    }
    d.pModeloAjustado = aj.p;
    d.pModeloBruto = br.p;
    d.wMistura = wDe(ins, aj.nivel);
    // a parte "mercado" da mistura: no R3 o P_true gravado já é mistura → P_consenso
    d.pMercadoBase =
      s.origem === 'lista'
        ? (s.lista?.pMercado ?? null)
        : s.nivelReferencia === 'R3'
          ? s.pConsenso
          : s.pMercado;
    if (d.wMistura !== null && d.pMercadoBase !== null) {
      d.pMistura = blend(aj.p, d.pMercadoBase, d.wMistura);
      d.pMisturaBruta = br.p === null ? null : blend(br.p, d.pMercadoBase, d.wMistura);
    }
    d.estado = 'derivado';

    // conferências contra o que foi gravado
    const conf = (campo: string, gravado: number | null, recalculado: number | null) => {
      if (gravado === null || recalculado === null) return;
      d.conferencias.push({
        campo,
        gravado,
        recalculado,
        confere: dentroDaTolerancia(gravado, recalculado),
      });
    };
    conf('pModelo (V4)', num(linha?.pModelo), d.pModeloAjustado);
    if (s.nivelReferencia === 'R3') {
      conf('wModelo (V4, R3)', num(linha?.wModelo), d.wMistura);
      conf('pTrue = mistura (V4, R3)', num(linha?.pTrue), d.pMistura);
    }
    if (s.lista) {
      conf('pModelo (lista)', s.lista.pModelo, d.pModeloAjustado);
      if (d.wMistura !== null && s.lista.pMercado !== null)
        conf('chance (lista)', s.lista.chance, blend(aj.p, s.lista.pMercado, d.wMistura));
    }
    const ruins = d.conferencias.filter((c: Conferencia) => !c.confere);
    if (ruins.length) {
      d.estado = 'derivacao-divergente';
      d.motivo = `recálculo não confere com o gravado: ${ruins.map((c) => c.campo).join(', ')}`;
    }
    return d;
  });

  // ---------- entradas das análises elegíveis (inclui v1/v2): só desfecho ----------
  const entradas: DesfechoEntrada[] = conjunto.analises
    .filter((a) => !a.irmaDe)
    .map((a) => {
      const reg = entradaRegistrada(a.idHistorico);
      return {
        idHistorico: a.idHistorico,
        status: statusAnalise.get(a.idHistorico) ?? null,
        chave: reg.linha ? chaveSegura(reg.linha) : null,
        semEntrada: !reg.linha,
        modelo: a.identidadeDecisao ? 'via-selecao' : 'indisponivel-sem-evidencia',
        desfecho: reg.linha ? apurarDesfecho(reg.linha, jogoDe(a.idHistorico), reg.manual) : null,
      };
    });

  // ---------- apostas feitas: só desfecho ----------
  const apostas: DesfechoAposta[] = conjunto.apostas.map((p) => {
    const reg = entradaRegistrada(p.idHistorico);
    const linha = reg.linha;
    return {
      idHistorico: p.idHistorico,
      irmaDe: p.irmaDe,
      status: statusAposta.get(p.idHistorico) ?? null,
      chave: linha ? chaveSegura(linha) : null,
      desfecho: linha
        ? apurarDesfecho(linha, jogoDe(p.irmaDe ?? p.idHistorico), reg.manual)
        : {
            estado: 'mercado-desconhecido',
            resultado: null,
            y: null,
            peso: 0,
            rotulo: null,
            manual: reg.manual,
            motivo: 'aposta sem linha registrada',
          },
    };
  });

  // ---------- conservação ----------
  const elegiveis = conjunto.analises.filter((a) => !a.irmaDe).length;
  if (selecoes.length !== conjunto.selecoes.length)
    throw new Error('conservação violada: seleções sem derivação');
  if (entradas.length !== elegiveis) throw new Error('conservação violada: análises sem desfecho');
  if (apostas.length !== conjunto.apostas.length)
    throw new Error('conservação violada: apostas sem desfecho');
  const chaves = selecoes.map((s) => `${s.idHistorico}#${s.chave}`);
  if (new Set(chaves).size !== chaves.length)
    throw new Error('conservação violada: seleção repetida');

  return {
    contrato: VERSAO_CONTRATO_DERIVACOES,
    motor: x.motor ?? MOTOR_ATUAL,
    selecoes,
    entradas,
    apostas,
    conservacao: { selecoes: selecoes.length, entradas: entradas.length, apostas: apostas.length },
  };
}

/** A linha completa da seleção: a gravada na evidência (avaliada da V4 ou item da lista). */
function linhaDaSelecao(
  s: Conjunto['selecoes'][number],
  ev: Evidencia | undefined,
): Partial<LinhaOdd> {
  const av = ev?.conteudo.avaliacao as
    | {
        v4?: { avaliadas?: { chave?: unknown; linha?: unknown }[] };
        entradas?: { entradas?: { chave?: unknown; linha?: unknown }[] } | null;
      }
    | undefined;
  const achada =
    av?.v4?.avaliadas?.find((v) => v.chave === s.chave)?.linha ??
    av?.entradas?.entradas?.find((v) => v.chave === s.chave)?.linha;
  return (achada ?? {}) as Partial<LinhaOdd>;
}

const contar = <T>(xs: T[], f: (x: T) => string | null) => {
  const m: Record<string, number> = {};
  for (const x of xs) {
    const k = f(x);
    if (k) m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** Relatório de revisão da F1.3: só contagens (sem times, casas ou ids). */
export function relatorioDeDerivacoes(d: Derivacoes) {
  return {
    contrato: d.contrato,
    motor: d.motor,
    conservacao: d.conservacao,
    selecoes: {
      porEstado: contar(d.selecoes, (s) => s.estado),
      porDesfecho: contar(d.selecoes, (s) => s.desfecho.estado),
      porStatus: contar(d.selecoes, (s) => s.status),
      conferencias: {
        total: d.selecoes.reduce((n, s) => n + s.conferencias.length, 0),
        divergentes: d.selecoes.reduce(
          (n, s) => n + s.conferencias.filter((c) => !c.confere).length,
          0,
        ),
      },
    },
    entradas: {
      porDesfecho: contar(d.entradas, (e) => (e.desfecho ? e.desfecho.estado : 'sem-entrada')),
      porModelo: contar(d.entradas, (e) => e.modelo),
    },
    apostas: { porDesfecho: contar(d.apostas, (a) => a.desfecho.estado) },
  };
}
