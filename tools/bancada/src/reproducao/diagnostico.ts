/**
 * Diagnóstico da F1.2c: PREVÊ o caminho de cada análise sem preparar build, sem abrir processo
 * e sem executar o motor — nem sequer recebe provedor ou executor. Só lê o que está gravado:
 * integridade da evidência (hash), relógio gravado, elegibilidade do build, D1 do histórico,
 * protocolo e a referência registrada (sem conferir se o commit existe: isso exigiria git).
 *
 * Toda previsão sai marcada natureza: 'previsao'. "determinado" só quando o desfecho não
 * depende de execução; o resto fica em naoVerificado/observacoes, como possibilidade.
 */
import { impressaoDigital, type Evidencia } from '../../../../apps/web/src/evidencias';
import type { EntradaHistorico } from '../../../../apps/web/src/historico';
import { elegibilidade } from './build';
import type { Camada, PrevisaoDiagnostico, StatusAnalise } from './contratoConsolidacao';
import type { SubcausaHistorica } from './contratoReprocessamento';
import { REFERENCIA_TESTE_SINTETICA, registroOficial, type RegistroReferencia } from './referencia';
import { inferirRelogio } from './relogio';

/** Referência como o diagnóstico a enxerga: registrada ou não; existência NÃO verificada. */
export type ReferenciaPrevista =
  | { disponivel: true; sha: string; camada: Camada; verificada: false }
  | { disponivel: false; motivo: string };

const SHA = /^[0-9a-f]{40}$/;

export function preverReferencia(o: {
  registro?: RegistroReferencia;
  referenciaDeTeste?: string;
}): ReferenciaPrevista {
  if (o.referenciaDeTeste !== undefined)
    return o.referenciaDeTeste === REFERENCIA_TESTE_SINTETICA
      ? {
          disponivel: true,
          sha: REFERENCIA_TESTE_SINTETICA,
          camada: 'teste-sintetica',
          verificada: false,
        }
      : { disponivel: false, motivo: 'referência de teste recusada: só 8964bf4 é sintética' };
  const reg = o.registro ?? registroOficial();
  if (reg.sha === null)
    return {
      disponivel: false,
      motivo: `sem build de referência oficial registrado: ${reg.motivo}`,
    };
  if (typeof reg.sha !== 'string' || !SHA.test(reg.sha) || reg.sha === REFERENCIA_TESTE_SINTETICA)
    return {
      disponivel: false,
      motivo: `referência oficial registrada inválida: ${String(reg.sha)}`,
    };
  return { disponivel: true, sha: reg.sha, camada: 'producao', verificada: false };
}

/** Falhas que só a execução revela, no build original (F1.2a) e no de referência (F1.2b). */
const EXECUCAO: SubcausaHistorica[] = [
  'dependencias-indisponiveis',
  'api-ausente',
  'ambiente-invalido',
  'entrada-irrecuperavel',
  'erro-execucao',
  'tempo-esgotado',
];

const previsao = (p: Omit<PrevisaoDiagnostico, 'natureza'>): PrevisaoDiagnostico => ({
  natureza: 'previsao',
  ...p,
});
const determinado = (sub: SubcausaHistorica, motivo: string) =>
  previsao({
    caminho: 'nenhum',
    determinado: sub,
    motivo,
    naoVerificado: [],
    observacoes: [],
    comparacaoPrevista: null,
  });

/** Previsão para a revisão de DECISÃO de uma análise com evidência. */
export async function preverRevisao(
  ev: Evidencia,
  ref: ReferenciaPrevista,
): Promise<PrevisaoDiagnostico> {
  if ((await impressaoDigital(ev.conteudo)) !== ev.meta.hash)
    return determinado('evidencia-inconsistente', 'o conteúdo gravado não bate com meta.hash');
  if (!Number.isFinite(Date.parse(ev.meta.calculadoEm?.inicio ?? '')))
    return determinado('relogio-desconhecido', 'meta.calculadoEm.inicio ausente ou ilegível');
  const b = ev.meta.build ?? ({} as Evidencia['meta']['build']);
  const eleg = elegibilidade({
    commit: b.commit ?? null,
    origem: b.origem ?? null,
    alteracoesLocais: b.alteracoesLocais ?? null,
  });
  if (eleg.ok)
    return previsao({
      caminho: 'reproducao-original',
      determinado: null,
      motivo:
        'build original elegível: reprodução no próprio build (existência do commit não verificada)',
      // commit ausente cairia para o reprocessamento; sem referência, para sem-build-referencia
      naoVerificado: [
        ...EXECUCAO,
        'commit-ausente',
        ...(ref.disponivel ? [] : (['sem-build-referencia'] as const)),
      ],
      observacoes: [
        'o hash reproduzido pode divergir (original-divergente/equivalente)',
        ref.disponivel
          ? 'commit ausente → reprocessamento na referência'
          : 'commit ausente → sem-build-referencia',
      ],
      comparacaoPrevista: null,
    });
  if (!ref.disponivel) return determinado('sem-build-referencia', `${eleg.motivo}; ${ref.motivo}`);
  return previsao({
    caminho: 'reprocessamento',
    determinado: null,
    motivo: `${eleg.motivo}: reprocessamento no build de referência (${ref.camada}, existência não verificada)`,
    naoVerificado: [...EXECUCAO, 'commit-ausente'],
    observacoes: ['a decisão reprocessada pode concordar ou divergir'],
    comparacaoPrevista: null,
  });
}

/** Previsão para uma análise SEM evidência (reprocessamento do rascunho do histórico). */
export function preverEntrada(
  e: EntradaHistorico,
  marcas: string[],
  ref: ReferenciaPrevista,
): PrevisaoDiagnostico {
  const rel = inferirRelogio({
    salvoEm: e.salvoEm,
    data: e.rascunho?.jogo?.data,
    hora: e.rascunho?.jogo?.hora,
    inicio: e.resumo?.inicio,
    marcas,
  });
  if (!rel.ok) return determinado('relogio-desconhecido', rel.motivo);
  if (!ref.disponivel) return determinado('sem-build-referencia', ref.motivo);
  const v4 = e.resumo?.protocolo === 'V4';
  return previsao({
    caminho: 'reprocessamento',
    determinado: null,
    motivo: `relógio inferido (${rel.pontas[0]} … ${rel.pontas[1]}): reprocessamento nas duas pontas no build de referência (${ref.camada})`,
    // relógio ambíguo dentro do minuto só aparece executando
    naoVerificado: [...EXECUCAO, 'commit-ausente', 'relogio-desconhecido'],
    observacoes: [
      'as duas pontas do minuto podem divergir (relógio ambíguo)',
      v4
        ? 'a decisão reprocessada pode concordar ou divergir'
        : 'protocolo ≠ V4: sem concordância/divergência',
    ],
    comparacaoPrevista: v4 ? null : 'protocolo-diferente',
  });
}

/**
 * O resultado efetivo é compatível com a previsão? (para conferir o diagnóstico contra a
 * execução: a previsão não pode ter afirmado nada que a execução desminta)
 */
export function previsaoConfere(
  p: PrevisaoDiagnostico,
  efetivo: { status: StatusAnalise; subcausa: SubcausaHistorica | null; comparacao: string | null },
): boolean {
  if (p.determinado)
    return efetivo.status === 'nao-reproduzivel' && efetivo.subcausa === p.determinado;
  if (
    p.comparacaoPrevista &&
    efetivo.status === 'reprocessada' &&
    efetivo.comparacao !== p.comparacaoPrevista
  )
    return false;
  if (efetivo.status === 'nao-reproduzivel')
    return efetivo.subcausa !== null && p.naoVerificado.includes(efetivo.subcausa);
  if (p.caminho === 'reproducao-original')
    return (
      efetivo.status === 'reproduzida' ||
      efetivo.status === 'reproducao-divergente' ||
      // fallback por commit ausente
      (efetivo.status === 'reprocessada' && p.naoVerificado.includes('commit-ausente'))
    );
  if (p.caminho === 'reprocessamento') return efetivo.status === 'reprocessada';
  return false;
}
