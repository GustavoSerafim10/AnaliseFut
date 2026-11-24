/**
 * Consolidação da F1.2c: exatamente um status de reprodutibilidade por análise elegível da F1.1.
 *
 *  A. A revisão representativa é SEMPRE a revisão de decisão escolhida pela F1.1
 *     (identidadeDecisao); revisões depois do apito nunca a substituem. Sem revisão de decisão:
 *     "sem-revisao-de-decisao" (fato do dado, não falha de reprodução).
 *  B. Aposta irmã herda o status da raiz e nunca conta como análise; raiz ausente, excluída ou
 *     também irmã → "vinculo-nao-resolvido", com o motivo (nada inventado, nada descartado).
 *  D. Universos separados e conferidos: análises elegíveis, irmãs, entradas excluídas pela F1.1,
 *     seleções e apostas vinculadas.
 *  E. Resultado de uma camada de referência nunca entra na consolidação da outra.
 */
import type { Conjunto } from '../index';
import { identidadeEvidencia, type Juncao } from '../leitura/juntarBackups';
import type {
  Camada,
  ConsolidacaoAnalise,
  ConsolidacaoExcluida,
  ConsolidacaoIrma,
  Consolidado,
  RelatorioRevisao,
  StatusAnalise,
  StatusVinculado,
  VinculoRegistro,
} from './contratoConsolidacao';
import { VERSAO_CONTRATO_CONSOLIDACAO } from './contratoConsolidacao';
import type { ResultadoEntrada, ResultadoRevisao } from './contratoReprocessamento';
import { preverEntrada, preverRevisao, type ReferenciaPrevista } from './diagnostico';
import type { ReproducaoHistorica } from './historica';
import { marcasDa } from './itens';

export type EntradaConsolidacao = {
  conjunto: Omit<Conjunto, 'impressao'>;
  impressaoConjunto: string;
  juncao: Juncao;
  camada: Camada;
} & (
  | { modo: 'execucao'; f12: ReproducaoHistorica }
  | { modo: 'diagnostico'; referencia: ReferenciaPrevista }
);

const statusDaRevisao = (r: ResultadoRevisao): StatusAnalise =>
  r.classe === 'original-exata' || r.classe === 'original-equivalente'
    ? 'reproduzida'
    : r.classe === 'original-divergente'
      ? 'reproducao-divergente'
      : r.classe === 'reprocessamento'
        ? 'reprocessada'
        : 'nao-reproduzivel';

function statusDaEntrada(e: ResultadoEntrada): StatusAnalise {
  if (e.destino === 'reprocessamento') return 'reprocessada';
  if (e.destino === 'nao-reproduzivel') return 'nao-reproduzivel';
  throw new Error(
    `análise ${e.idHistorico} sem evidência com destino inesperado na F1.2: ${e.destino}`,
  );
}

/** E: nenhum resultado de uma camada de referência entra na consolidação de outra. */
function conferirCamada(f12: ReproducaoHistorica, camada: Camada) {
  const tipos = new Set<string>();
  for (const r of [...f12.revisoes, ...f12.entradas])
    if (r.referencia) tipos.add(r.referencia.tipo);
  if (f12.referencia.tipo !== 'ausente') tipos.add(f12.referencia.tipo);
  for (const t of tipos)
    if (t !== camada)
      throw new Error(
        `camada misturada: resultado com referência "${t}" numa consolidação "${camada}" (sintético nunca entra em produção)`,
      );
}

const conta = <T>(xs: T[], f: (x: T) => string | null) => {
  const m: Record<string, number> = {};
  for (const x of xs) {
    const k = f(x);
    if (k) m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
};

export async function consolidar(x: EntradaConsolidacao): Promise<Consolidado> {
  const { conjunto, juncao } = x;
  if (x.modo === 'execucao') conferirCamada(x.f12, x.camada);
  const canonicaPorId = new Map(juncao.entradas.map((c) => [c.entrada.id, c]));
  const evPorIdent = new Map(juncao.evidencias.map((ev) => [identidadeEvidencia(ev), ev]));
  const revPorIdent =
    x.modo === 'execucao' ? new Map(x.f12.revisoes.map((r) => [r.identidade, r])) : null;
  const entPorId =
    x.modo === 'execucao' ? new Map(x.f12.entradas.map((e) => [e.idHistorico, e])) : null;

  // ---------- análises elegíveis (sem irmaDe): exatamente um status ----------
  const analises: ConsolidacaoAnalise[] = [];
  for (const a of conjunto.analises.filter((y) => !y.irmaDe)) {
    const c: ConsolidacaoAnalise = {
      idHistorico: a.idHistorico,
      chaveJogo: a.chaveJogo,
      status: 'nao-executado',
      subcausa: null,
      comparacao: null,
      referencia: null,
      fonte: { tipo: 'nenhuma' },
      previsao: null,
      motivo: '',
    };
    if (a.temEvidencia && !a.identidadeDecisao) {
      c.status = 'sem-revisao-de-decisao';
      c.motivo = `${a.revisoes} revisão(ões), ${a.revisoesPosApito} depois do apito: nenhuma antes do apito`;
    } else if (a.temEvidencia) {
      const id = a.identidadeDecisao!;
      c.fonte = { tipo: 'revisao-de-decisao', identidade: id, revisao: a.revisaoDecisao };
      if (revPorIdent) {
        const r = revPorIdent.get(id);
        if (!r) throw new Error(`revisão de decisão ${id} sem resultado na F1.2`);
        c.status = statusDaRevisao(r);
        c.subcausa = r.subcausa;
        c.comparacao = r.comparacao;
        c.referencia = r.referencia;
        c.motivo = r.motivo;
      } else {
        const ev = evPorIdent.get(id);
        if (!ev) throw new Error(`revisão de decisão ${id} ausente da junção`);
        c.previsao = await preverRevisao(ev, (x as { referencia: ReferenciaPrevista }).referencia);
        c.motivo = c.previsao.motivo;
      }
    } else {
      c.fonte = { tipo: 'entrada' };
      if (entPorId) {
        const e = entPorId.get(a.idHistorico);
        if (!e) throw new Error(`análise ${a.idHistorico} sem resultado de entrada na F1.2`);
        c.status = statusDaEntrada(e);
        c.subcausa = e.subcausa;
        c.comparacao = e.comparacao;
        c.referencia = e.referencia;
        c.motivo = e.motivo;
      } else {
        const can = canonicaPorId.get(a.idHistorico);
        if (!can) throw new Error(`análise ${a.idHistorico} ausente da junção`);
        c.previsao = preverEntrada(
          can.entrada,
          marcasDa(can),
          (x as { referencia: ReferenciaPrevista }).referencia,
        );
        c.motivo = c.previsao.motivo;
      }
    }
    analises.push(c);
  }
  const statusPorId = new Map(analises.map((a) => [a.idHistorico, a.status]));

  // ---------- apostas irmãs: herdam da raiz ou vínculo não resolvido ----------
  const excluidasIds = new Set(
    conjunto.exclusoes.filter((e) => e.categoria === 'jogo-sem-chave').map((e) => e.id as string),
  );
  const irmaIds = new Set(conjunto.analises.filter((a) => a.irmaDe).map((a) => a.idHistorico));
  const irmas: ConsolidacaoIrma[] = conjunto.analises
    .filter((a) => a.irmaDe)
    .map((a) => {
      const raiz = a.irmaDe!;
      const st = statusPorId.get(raiz);
      if (st)
        return {
          idHistorico: a.idHistorico,
          irmaDe: raiz,
          status: 'herdado-da-raiz' as const,
          statusRaiz: st,
          motivo: `herda o status da análise ${raiz}`,
        };
      return {
        idHistorico: a.idHistorico,
        irmaDe: raiz,
        status: 'vinculo-nao-resolvido' as const,
        statusRaiz: null,
        motivo: excluidasIds.has(raiz)
          ? 'a raiz foi excluída pela F1.1 (jogo-sem-chave)'
          : irmaIds.has(raiz)
            ? 'a raiz também é uma aposta irmã (cadeia de vínculos)'
            : 'a raiz não está no conjunto',
      };
    });
  const irmaPorId = new Map(irmas.map((i) => [i.idHistorico, i]));

  // ---------- entradas excluídas pela F1.1: registradas com o destino da F1.2 ----------
  const excluidas: ConsolidacaoExcluida[] = [];
  for (const ex of conjunto.exclusoes.filter((e) => e.categoria === 'jogo-sem-chave')) {
    const id = ex.id as string;
    const r: ConsolidacaoExcluida = {
      idHistorico: id,
      categoria: 'jogo-sem-chave',
      motivo: ex.motivo,
      destinoF12: null,
      subcausaF12: null,
      previsao: null,
    };
    if (entPorId) {
      const e = entPorId.get(id);
      if (!e) throw new Error(`entrada excluída ${id} sem destino na F1.2`);
      r.destinoF12 = e.destino;
      r.subcausaF12 = e.subcausa;
    } else {
      const can = canonicaPorId.get(id);
      const temEv = juncao.evidencias.some((ev) => ev.meta.idJogo === id);
      if (can && !temEv)
        r.previsao = preverEntrada(
          can.entrada,
          marcasDa(can),
          (x as { referencia: ReferenciaPrevista }).referencia,
        );
    }
    excluidas.push(r);
  }

  // ---------- seleções e apostas: herdam o status da análise ----------
  const vinculado = (id: string): StatusVinculado => {
    const st = statusPorId.get(id);
    if (st) return st;
    const irma = irmaPorId.get(id);
    if (irma) return irma.statusRaiz ?? 'vinculo-nao-resolvido';
    return 'vinculo-nao-resolvido';
  };
  const selecoes: VinculoRegistro[] = conjunto.selecoes.map((s) => ({
    idHistorico: s.idHistorico,
    chave: s.chave,
    status: vinculado(s.idHistorico),
  }));
  const apostas: VinculoRegistro[] = conjunto.apostas.map((a) => ({
    idHistorico: a.idHistorico,
    chave: null,
    status: vinculado(a.idHistorico),
  }));

  // ---------- conservação (D): nada some, nada conta duas vezes ----------
  const universos = [
    analises.map((a) => a.idHistorico),
    irmas.map((i) => i.idHistorico),
    excluidas.map((e) => e.idHistorico),
  ];
  const todos = universos.flat();
  if (new Set(todos).size !== todos.length)
    throw new Error('conservação violada: registro em mais de um universo ou repetido');
  if (todos.length !== juncao.entradas.length)
    throw new Error(
      `conservação violada: ${juncao.entradas.length} entradas canônicas ≠ ${analises.length} análises + ${irmas.length} irmãs + ${excluidas.length} excluídas`,
    );
  if (selecoes.length !== conjunto.selecoes.length || apostas.length !== conjunto.apostas.length)
    throw new Error('conservação violada: seleções ou apostas sem vínculo');

  // universo das revisões: todas as da junção, cada uma com exatamente uma classe na F1.2
  const revisoesF12: Consolidado['revisoesF12'] = {
    total: juncao.evidencias.length,
    porClasse: x.modo === 'execucao' ? x.f12.manifesto.revisoes.porClasse : null,
  };
  if (x.modo === 'execucao') {
    const soma = Object.values(revisoesF12.porClasse!).reduce((s, n) => s + n, 0);
    if (x.f12.revisoes.length !== revisoesF12.total || soma !== revisoesF12.total)
      throw new Error(
        `conservação violada: ${revisoesF12.total} revisões na junção ≠ ${x.f12.revisoes.length} resultados da F1.2 (Σ classes ${soma})`,
      );
  }

  const referencia: Consolidado['referencia'] =
    x.modo === 'execucao'
      ? x.f12.referencia
      : x.referencia.disponivel
        ? {
            tipo: 'prevista',
            sha: x.referencia.sha,
            camada: x.referencia.camada,
            verificada: false,
          }
        : { tipo: 'ausente', motivo: x.referencia.motivo };

  return {
    contrato: VERSAO_CONTRATO_CONSOLIDACAO,
    modo: x.modo,
    camada: x.camada,
    referencia,
    impressaoConjunto: x.impressaoConjunto,
    impressaoF12: x.modo === 'execucao' ? x.f12.manifesto.impressaoResultados : null,
    analises,
    irmas,
    excluidas,
    selecoes,
    apostas,
    exclusoesF11: conta(conjunto.exclusoes, (e) => e.categoria),
    revisoesF12,
    conservacao: {
      entradasCanonicas: juncao.entradas.length,
      analisesElegiveis: analises.length,
      irmas: irmas.length,
      excluidas: excluidas.length,
      selecoes: selecoes.length,
      apostas: apostas.length,
    },
  };
}

/** Relatório de revisão: só contagens e impressões (F: sem times, casas, ids). */
export function relatorioDeRevisao(c: Consolidado): RelatorioRevisao {
  return {
    contrato: c.contrato,
    modo: c.modo,
    camada: c.camada,
    referencia: { tipo: c.referencia.tipo },
    analises: conta(c.analises, (a) => a.status),
    analisesPorSubcausa: conta(c.analises, (a) => a.subcausa),
    analisesPorComparacao: conta(c.analises, (a) => a.comparacao),
    previsoes: conta(c.analises, (a) =>
      a.previsao
        ? a.previsao.determinado
          ? `determinado:${a.previsao.determinado}`
          : `caminho:${a.previsao.caminho}`
        : null,
    ),
    irmas: conta(c.irmas, (i) => i.status),
    excluidas: c.excluidas.length,
    selecoes: conta(c.selecoes, (s) => s.status),
    apostas: conta(c.apostas, (s) => s.status),
    exclusoesF11: c.exclusoesF11,
    revisoesF12: c.revisoesF12,
    conservacao: c.conservacao,
    impressaoConjunto: c.impressaoConjunto,
    impressaoF12: c.impressaoF12,
  };
}
