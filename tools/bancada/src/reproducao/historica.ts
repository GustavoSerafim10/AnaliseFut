/**
 * Reprodução histórica combinada (F1.2b): F1.2a + reprocessamento, com exatamente uma
 * classificação final por item.
 *
 *  1. Revisões de evidência → reproduzir() da F1.2a, SEM mudança. Só as tentativas que terminam
 *     em build-nao-elegivel ou commit-ausente (proteção 2) caem para o reprocessamento no build
 *     de referência; original-divergente e as demais subcausas são finais (proteção 1). A
 *     tentativa original segue inteira no resultado (proteção 5).
 *  2. Entradas do histórico sem evidência → relógio inferido (D1 corrigida) → reprocessamento
 *     nas DUAS pontas do minuto. Qualquer diferença entre as pontas = relogio-desconhecido
 *     (cuidado 1); falha de uma ponta = falha, nunca divergência, com o parcial preservado
 *     (cuidado 2). Irmãs vinculadas à raiz; entradas com evidência ficam cobertas por ela.
 *  3. Uma referência por execução; cada resultado e o manifesto dizem se é a oficial de produção
 *     ou a sintética de teste, e as contagens ficam separadas por tipo (cuidado 3).
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonico } from '../../../../apps/web/src/evidencias';
import { identidadeEvidencia, type Juncao } from '../leitura/juntarBackups';
import { raizRepositorio, type Area } from './area';
import { sha256, type Preparo, type ProvedorBuild } from './build';
import { compararConteudos } from './comparar';
import { compararResumo, type ResumoComparavel } from './compararResumo';
import {
  FUSO_ESPERADO,
  LIMITE_DIFERENCAS,
  LOCALIDADE_ESPERADA,
  TEMPO_LIMITE_PADRAO_MS,
} from './contrato';
import {
  SUBCAUSAS_COM_REPROCESSAMENTO,
  VERSAO_CONTRATO_HISTORICA,
  type DetalheReprocessamento,
  type ManifestoHistorico,
  type Ponta,
  type ReferenciaUsada,
  type ResultadoEntrada,
  type ResultadoRevisao,
  type SubcausaHistorica,
} from './contratoReprocessamento';
import type { Executor } from './executor';
import type { ExecutorHistorico } from './executorHistorico';
import { montarItens } from './itens';
import { resolverReferencia, type RegistroReferencia } from './referencia';
import { inferirRelogio } from './relogio';
import { reproduzir } from './reproduzir';

export interface OpcoesHistoricas {
  area: Area;
  provedor: ProvedorBuild;
  executor: Executor;
  executorHistorico: ExecutorHistorico;
  repositorio?: string;
  /** padrão: referencia.json (oficial; hoje sem SHA) */
  registroReferencia?: RegistroReferencia;
  /** SOMENTE TESTES: usa a referência sintética 8964bf4, marcada em tudo como teste */
  referenciaDeTeste?: string;
  tempoLimiteMs?: number;
  fuso?: string;
  localidade?: string;
  execucaoId?: string;
}

export interface ReproducaoHistorica {
  pasta: string;
  referencia: ManifestoHistorico['referencia'];
  revisoes: ResultadoRevisao[];
  entradas: ResultadoEntrada[];
  manifesto: ManifestoHistorico;
}

/** Sem os campos naturalmente variáveis (duração, também na tentativa original). */
export const semVariaveisHistorica = (x: {
  revisoes: ResultadoRevisao[];
  entradas: ResultadoEntrada[];
}) => ({
  revisoes: x.revisoes.map((r) => {
    const t: Partial<ResultadoRevisao['tentativaOriginal']> = { ...r.tentativaOriginal };
    delete t.duracaoMs;
    const s: Partial<ResultadoRevisao> = { ...r, tentativaOriginal: t as never };
    delete s.duracaoMs;
    return s;
  }),
  entradas: x.entradas.map((e) => {
    const s: Partial<ResultadoEntrada> = { ...e };
    delete s.duracaoMs;
    return s;
  }),
});

const conta = <T>(xs: T[], f: (x: T) => string | null) => {
  const m: Record<string, number> = {};
  for (const x of xs) {
    const k = f(x);
    if (k) m[k] = (m[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
};
const porTipo = (xs: { referencia: ReferenciaUsada | null; comparacao: string | null }[]) => {
  const m: Record<string, Record<string, number>> = {};
  for (const x of xs)
    if (x.referencia && x.comparacao) {
      const t = (m[x.referencia.tipo] ??= {});
      t[x.comparacao] = (t[x.comparacao] ?? 0) + 1;
    }
  return m;
};

export async function reproducaoHistorica(
  j: Juncao,
  o: OpcoesHistoricas,
): Promise<ReproducaoHistorica> {
  const execucaoId =
    o.execucaoId ??
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const pasta = join(o.area.execucoes, execucaoId);
  mkdirSync(join(pasta, 'conteudos'), { recursive: true });
  const iniciadaEm = new Date().toISOString();
  const fuso = o.fuso ?? FUSO_ESPERADO;
  const localidade = o.localidade ?? LOCALIDADE_ESPERADA;
  const tempoLimiteMs = o.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
  const itens = montarItens(j);

  // 1. F1.2a, como está
  const original = await reproduzir(itens.revisoes, {
    area: o.area,
    provedor: o.provedor,
    executor: o.executor,
    tempoLimiteMs,
    fuso,
    localidade,
    execucaoId: join(execucaoId, 'f12a'),
  });

  const ref = resolverReferencia({
    repositorio: o.repositorio ?? raizRepositorio(),
    registro: o.registroReferencia,
    referenciaDeTeste: o.referenciaDeTeste,
  });
  const referencia: ReferenciaUsada | null = ref.ok ? { sha: ref.sha, tipo: ref.tipo } : null;
  let preparoRef: Promise<Preparo> | null = null;
  const buildRef = () => (preparoRef ??= o.provedor.preparar((ref as { sha: string }).sha));
  const evPorIdentidade = new Map(
    itens.revisoes.map((i) => [identidadeEvidencia(i.evidencia), i.evidencia]),
  );

  // 2a. revisões de evidência
  const revisoes: ResultadoRevisao[] = [];
  for (const [k, t] of original.resultados.entries()) {
    const t0 = performance.now();
    const r: ResultadoRevisao = {
      identidade: t.identidade,
      idJogo: t.idJogo,
      revisao: t.revisao,
      marcas: t.marcas,
      classe: t.classe,
      subcausa: t.subcausa,
      motivo: t.motivo,
      comparacao: null,
      referencia: null,
      tentativaOriginal: t,
      reprocessamento: null,
      duracaoMs: t.duracaoMs,
    };
    const fallback = t.subcausa !== null && SUBCAUSAS_COM_REPROCESSAMENTO.includes(t.subcausa);
    if (fallback) {
      const tentativa = `tentativa original: ${t.subcausa} (${t.motivo})`;
      const falhar = (subcausa: SubcausaHistorica, motivo: string) => {
        r.classe = 'nao-reproduzivel';
        r.subcausa = subcausa;
        r.motivo = `${motivo}; ${tentativa}`;
      };
      if (!ref.ok) falhar('sem-build-referencia', ref.motivo);
      else {
        r.referencia = referencia;
        const p = await buildRef();
        if (!p.ok) falhar(p.subcausa, `build de referência: ${p.motivo}`);
        else {
          const ev = evPorIdentidade.get(t.identidade)!;
          const det: DetalheReprocessamento = {
            referencia: referencia!,
            hashReproduzido: null,
            shaConteudoReproduzido: null,
            diferencasTotal: 0,
            diferencasDecisao: 0,
            diferencas: [],
            ambiente: null,
            falha: null,
          };
          r.reprocessamento = det;
          const x = await o.executor.executar(
            p.build,
            {
              entradaGravada: ev.conteudo.entrada,
              invalidos: ev.conteudo.invalidos ?? [],
              relogio: ev.meta.calculadoEm.inicio,
              esperado: { fuso, localidade, localidadeRelevante: p.build.localidadeRelevante },
            },
            {
              pastaExecucao: pasta,
              caso: `r${String(k).padStart(4, '0')}`,
              tempoLimiteMs,
              fuso,
              localidade,
            },
          );
          if (x.tipo === 'falha') {
            det.falha = { mensagem: x.mensagem, codigoSaida: x.codigoSaida, registro: x.registro };
            falhar(x.subcausa, x.mensagem);
          } else if (x.saida.status !== 'ok') {
            det.ambiente = x.saida.ambiente;
            falhar(x.saida.status, x.saida.motivo);
          } else {
            const s = x.saida;
            det.ambiente = s.ambiente;
            det.hashReproduzido = s.hash;
            det.shaConteudoReproduzido = sha256(s.conteudoCanonico);
            writeFileSync(
              join(pasta, 'conteudos', `${det.shaConteudoReproduzido}.json`),
              s.conteudoCanonico,
            );
            const difs = compararConteudos(ev.conteudo, JSON.parse(s.conteudoCanonico));
            const decisao = difs.filter((d) => d.decisao);
            det.diferencasTotal = difs.length;
            det.diferencasDecisao = decisao.length;
            det.diferencas = difs.slice(0, LIMITE_DIFERENCAS);
            r.classe = 'reprocessamento';
            r.subcausa = null;
            r.comparacao = decisao.length ? 'diverge' : 'concorda';
            r.motivo = `${
              decisao.length
                ? `${decisao.length} diferença(s) em campo de decisão`
                : 'campos de decisão iguais'
            } no build de referência (${referencia!.tipo}); ${tentativa}`;
          }
        }
      }
      r.duracaoMs = t.duracaoMs + Math.round(performance.now() - t0);
    }
    revisoes.push(r);
    appendFileSync(join(pasta, 'revisoes.jsonl'), `${JSON.stringify(r)}\n`);
  }

  // 2b. entradas do histórico
  const entradas: ResultadoEntrada[] = [];
  for (const [k, it] of itens.entradas.entries()) {
    const t0 = performance.now();
    const e = it.entrada;
    const r: ResultadoEntrada = {
      idHistorico: e.id,
      irmaDe: e.irmaDe ?? null,
      marcas: it.marcas,
      protocolo: e.resumo?.protocolo ?? null,
      destino: it.destino === 'reprocessar' ? 'nao-reproduzivel' : it.destino,
      subcausa: null,
      motivo: '',
      comparacao: null,
      referencia: null,
      relogio: { origem: 'nao-aplicavel' },
      pontas: [],
      diferencasEntrePontas: [],
      campos: [],
      revisoesCobertas: it.revisoesCobertas,
      raiz: null,
      duracaoMs: 0,
    };
    const falhar = (subcausa: SubcausaHistorica, motivo: string) => {
      r.destino = 'nao-reproduzivel';
      r.subcausa = subcausa;
      r.motivo = motivo;
    };
    if (it.destino === 'coberta-por-evidencia')
      r.motivo = `${it.revisoesCobertas} revisão(ões) de evidência são os itens desta entrada`;
    else if (it.destino === 'irma-vinculada')
      r.motivo = `aposta irmã de ${e.irmaDe}: copia o resumo da raiz, não é análise própria`;
    else {
      const rel = inferirRelogio({
        salvoEm: e.salvoEm,
        data: e.rascunho?.jogo?.data,
        hora: e.rascunho?.jogo?.hora,
        inicio: e.resumo?.inicio,
        marcas: it.marcas,
      });
      if (!rel.ok) {
        r.relogio = { origem: 'desconhecido', motivo: rel.motivo };
        falhar('relogio-desconhecido', rel.motivo);
      } else {
        r.relogio = { origem: 'inferido', salvoEm: rel.salvoEm, intervalo: rel.pontas };
        if (!ref.ok) falhar('sem-build-referencia', ref.motivo);
        else {
          r.referencia = referencia;
          const p = await buildRef();
          if (!p.ok) falhar(p.subcausa, `build de referência: ${p.motivo}`);
          else {
            const resumos: string[] = [];
            for (const [n, instante] of rel.pontas.entries()) {
              const ponta: Ponta = {
                instante,
                status: 'ok',
                motivo: null,
                shaResumo: null,
                ambiente: null,
                registro: null,
              };
              const x = await o.executorHistorico.executar(
                p.build,
                {
                  rascunho: e.rascunho,
                  relogio: instante,
                  esperado: { fuso, localidade, localidadeRelevante: p.build.localidadeRelevante },
                },
                {
                  pastaExecucao: pasta,
                  caso: `h${String(k).padStart(4, '0')}-${n}`,
                  tempoLimiteMs,
                  fuso,
                  localidade,
                },
              );
              if (x.tipo === 'falha') {
                ponta.status = x.subcausa;
                ponta.motivo = x.mensagem;
                ponta.registro = x.registro;
              } else if (x.saida.status !== 'ok') {
                ponta.status = x.saida.status;
                ponta.motivo = x.saida.motivo;
                ponta.ambiente = x.saida.ambiente;
              } else {
                ponta.ambiente = x.saida.ambiente;
                ponta.shaResumo = sha256(x.saida.resumoJson);
                resumos.push(x.saida.resumoJson);
                writeFileSync(
                  join(pasta, 'conteudos', `${ponta.shaResumo}.json`),
                  x.saida.resumoJson,
                );
              }
              r.pontas.push(ponta);
            }
            const falhou = r.pontas.find((pt) => pt.status !== 'ok');
            if (falhou)
              // cuidado 2: falha de execução nunca vira divergência; os parciais ficam em pontas
              falhar(
                falhou.status as SubcausaHistorica,
                `reprocessamento incompleto: ${r.pontas
                  .map((pt) => `${pt.instante} → ${pt.status}${pt.motivo ? ` (${pt.motivo})` : ''}`)
                  .join('; ')}`,
              );
            else {
              const entrePontas = compararConteudos(JSON.parse(resumos[0]), JSON.parse(resumos[1]));
              if (entrePontas.length) {
                // cuidado 1: nenhuma ponta é escolhida
                r.diferencasEntrePontas = entrePontas.slice(0, LIMITE_DIFERENCAS);
                r.relogio = {
                  origem: 'desconhecido',
                  motivo: `relógio ambíguo dentro do minuto: ${entrePontas.length} campo(s) do resumo diferem entre ${rel.pontas[0]} e ${rel.pontas[1]}`,
                };
                falhar('relogio-desconhecido', r.relogio.motivo);
              } else {
                const c = compararResumo(
                  e.resumo as unknown as ResumoComparavel,
                  JSON.parse(resumos[0]) as ResumoComparavel,
                  { entradaSubstituidaPelaAposta: !!e.aposta?.entrada },
                );
                r.destino = 'reprocessamento';
                r.comparacao = c.comparacao;
                r.campos = c.campos;
                r.motivo =
                  c.comparacao === 'protocolo-diferente'
                    ? `protocolo gravado "${String(e.resumo?.protocolo ?? 'ausente')}" ≠ V4: reprocessado, sem concordância ou divergência (D-c)`
                    : `resumo reprocessado no build de referência (${referencia!.tipo}) ${c.comparacao === 'concorda' ? 'concorda' : 'diverge'} do gravado`;
              }
            }
          }
        }
      }
    }
    r.duracaoMs = Math.round(performance.now() - t0);
    entradas.push(r);
  }
  // irmãs: apontam para o destino da raiz (que nunca é contado como delas)
  const porId = new Map(entradas.map((x) => [x.idHistorico, x]));
  for (const x of entradas)
    if (x.destino === 'irma-vinculada' && x.irmaDe) {
      const raiz = porId.get(x.irmaDe);
      x.raiz = {
        id: x.irmaDe,
        presente: !!raiz,
        destino: raiz?.destino ?? null,
        comparacao: raiz?.comparacao ?? null,
      };
    }
  for (const x of entradas) appendFileSync(join(pasta, 'entradas.jsonl'), `${JSON.stringify(x)}\n`);

  // proteção 6: conservação nos dois universos
  if (
    revisoes.length !== itens.revisoes.length ||
    new Set(revisoes.map((x) => x.identidade)).size !== revisoes.length
  )
    throw new Error('conservação violada: revisões sem exatamente uma classificação final');
  if (
    entradas.length !== j.entradas.length ||
    new Set(entradas.map((x) => x.idHistorico)).size !== entradas.length
  )
    throw new Error('conservação violada: entradas sem exatamente um destino final');

  const referenciaManifesto: ManifestoHistorico['referencia'] = referencia ?? {
    tipo: 'ausente',
    motivo: (ref as { motivo: string }).motivo,
  };
  const manifesto: ManifestoHistorico = {
    contrato: VERSAO_CONTRATO_HISTORICA,
    execucaoId,
    iniciadaEm,
    concluidaEm: new Date().toISOString(),
    referencia: referenciaManifesto,
    revisoes: {
      total: revisoes.length,
      porClasse: conta(revisoes, (x) => x.classe),
      porSubcausa: conta(revisoes, (x) => x.subcausa),
      reprocessamentoPorTipo: porTipo(revisoes),
    },
    entradas: {
      total: entradas.length,
      porDestino: conta(entradas, (x) => x.destino),
      porSubcausa: conta(entradas, (x) => x.subcausa),
      reprocessamentoPorTipo: porTipo(entradas),
    },
    impressaoEntradas: sha256(
      [...revisoes.map((x) => `r:${x.identidade}`), ...entradas.map((x) => `e:${x.idHistorico}`)]
        .sort()
        .join('\n'),
    ),
    impressaoResultados: sha256(canonico(semVariaveisHistorica({ revisoes, entradas }))),
  };
  writeFileSync(join(pasta, 'manifesto.json'), JSON.stringify(manifesto, null, 1));
  return { pasta, referencia: referenciaManifesto, revisoes, entradas, manifesto };
}
