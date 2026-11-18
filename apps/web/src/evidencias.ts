/**
 * Fase 0 — registro de evidências. Uma fotografia reproduzível de cada análise: entradas
 * (prints em texto, odds, opções), o que cada fonte leu, a tabela consolidada, λ, DQ, as
 * probabilidades de cada mercado avaliado (inclusive NO BET), parâmetros e versão do build.
 *
 * Só lê: nada aqui altera o rascunho, o resultado do motor nem o histórico. A impressão digital
 * (SHA-256) cobre só `conteudo`, serializado de forma determinística; `meta` (revisão, horário
 * de gravação, build, instante do cálculo) fica fora dela, e por isso gravar de novo a mesma
 * análise não cria revisão.
 */
import {
  CHANCE_SINAL_FORTE,
  DISCORDANCIA_FORTE,
  DISPERSAO,
  DIVERGENCIA_MAX_ENTRADA,
  DIVERGENCIA_SINAL_FORTE,
  FAIXA_LAMBDA,
  FATOR_CHUTE_NO_ALVO,
  FATOR_GRANDE_CHANCE,
  FRACAO_1T,
  GATE_V4,
  JANELA_COMPARAVEL_MIN,
  JOGOS_MIN_NICHO,
  LIMITE_MATCHUP,
  MANDO_CONTAGEM,
  MANDO_PADRAO,
  MARGEM_MAXIMA_REF,
  MAX_POR_APOSTA,
  MEDIA_CONTAGEM_PADRAO,
  MEDIA_GOLS_PADRAO,
  MIN_CASAS_CONSENSO,
  PESO_MODELO_BASE,
  RHO_PADRAO,
  TETO_DIA,
  W_MAX_NIVEL3,
  type TravasBanca,
} from '@pe/engine';
import { POLITICA_EXPOSICAO } from '@pe/engine/src/politicaExposicao';
import { lerEstatisticasConsenso } from '@pe/parsers';
import type { Derivado } from './dados';
import { FATOR_DESFALQUE, inicioIso, type Rascunho } from './estado';
import type { VersaoBuild } from '../versao-build.mjs';

export const ESQUEMA_EVIDENCIA = 'evidencia-v1';
/** Revisões guardadas por jogo: a primeira (referência inicial) e as 49 mais recentes. */
export const LIMITE_REVISOES = 50;

declare const __VERSAO_BUILD__: VersaoBuild | undefined;

/** Versão do build em execução; fora do build do Vite (testes, scripts): desconhecida. */
export function buildAtual(): VersaoBuild {
  if (typeof __VERSAO_BUILD__ !== 'undefined' && __VERSAO_BUILD__) return __VERSAO_BUILD__;
  return {
    commit: null,
    commitData: null,
    construidoEm: '',
    origem: 'desconhecida',
    alteracoesLocais: null,
  };
}

export const LIMITACOES_EVIDENCIA = [
  'As imagens dos prints não são guardadas: a evidência original de cada print é o texto do OCR (com as releituras).',
  'Competição e período das estatísticas ficam só no texto do cabeçalho de cada print; não há campo próprio.',
  'parametros.motor lista as constantes exportadas; a definição completa do motor é a do commit em meta.build.',
  'O motor lê a hora atual: para reprocessar, usar o relógio em meta.calculadoEm.inicio.',
];

export interface ValorInvalido {
  /** caminho do campo dentro de `conteudo` */
  campo: string;
  valor: 'NaN' | 'Infinity' | '-Infinity';
  motivo: string;
}

export interface ConteudoEvidencia {
  esquema: string;
  limitacoes: string[];
  jogo: {
    casa: string;
    fora: string;
    competicao: string;
    data: string;
    hora: string;
    inicio: string;
  };
  entrada: {
    rascunho: unknown;
    travas: unknown;
    registradasNoJogo: string[];
  };
  parametros: unknown;
  fontes: unknown;
  consolidado: unknown;
  amostra: unknown;
  modelo: unknown;
  mercado: unknown;
  avaliacao: unknown;
  /** números não finitos encontrados (preservados como {$invalido} no lugar de origem) */
  invalidos: ValorInvalido[];
  /** o que não é dado (funções do liquidador de cada mercado): marcado como {$omitido} */
  omitidos: { campo: string; tipo: string; quantidade: number }[];
}

export interface MetaEvidencia {
  idJogo: string;
  revisao: number;
  gravadoEm: string;
  hash: string;
  build: VersaoBuild;
  /** instantes (ms, ISO) logo antes e logo depois do cálculo que gerou o resultado */
  calculadoEm: { inicio: string; fim: string };
  /** revisão que chegou por importação com número já ocupado por outro conteúdo */
  importacao?: { revisaoOriginal: number; importadoEm: string };
  /** importação (diário em armazemEvidencias) que gravou esta revisão: permite desfazer só ela */
  loteImportacao?: string;
}

export interface Evidencia {
  esquema: string;
  meta: MetaEvidencia;
  conteudo: ConteudoEvidencia;
}

/* ---------- serialização determinística e valores inválidos ---------- */

/** Troca o que JSON perderia por marcadores explícitos, registrando onde e por quê. */
export function sanitizar(
  valor: unknown,
  invalidos: ValorInvalido[] = [],
  omitidos: Map<string, { tipo: string; quantidade: number }> = new Map(),
  caminho = '',
  pilha: Set<object> = new Set(),
): unknown {
  if (typeof valor === 'number') {
    if (Number.isFinite(valor)) return valor;
    const v = Number.isNaN(valor) ? 'NaN' : valor > 0 ? 'Infinity' : '-Infinity';
    invalidos.push({ campo: caminho, valor: v, motivo: `número não finito (${v}) no resultado` });
    return { $invalido: v };
  }
  if (valor === null || typeof valor === 'string' || typeof valor === 'boolean') return valor;
  if (valor === undefined) return undefined;
  if (typeof valor === 'function' || typeof valor === 'symbol' || typeof valor === 'bigint') {
    // índices viram [*]: o liquidador de cada mercado conta uma vez, com a quantidade
    const padrao = caminho.replace(/\[\d+\]/g, '[*]');
    const ja = omitidos.get(padrao);
    if (ja) ja.quantidade++;
    else omitidos.set(padrao, { tipo: typeof valor, quantidade: 1 });
    return { $omitido: typeof valor };
  }
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'object') {
    if (pilha.has(valor)) {
      invalidos.push({ campo: caminho, valor: 'NaN', motivo: 'referência circular' });
      return { $invalido: 'ciclo' };
    }
    pilha.add(valor);
    let saida: unknown;
    if (Array.isArray(valor)) {
      saida = valor.map((x, i) => {
        const s = sanitizar(x, invalidos, omitidos, `${caminho}[${i}]`, pilha);
        // em lista, "vazio" é posição: fica marcado em vez de virar null
        return s === undefined ? { $indefinido: true } : s;
      });
    } else {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(valor)) {
        const s = sanitizar(x, invalidos, omitidos, caminho ? `${caminho}.${k}` : k, pilha);
        if (s !== undefined) o[k] = s;
      }
      saida = o;
    }
    pilha.delete(valor);
    return saida;
  }
  return undefined;
}

/** JSON com as chaves em ordem: os mesmos dados dão sempre o mesmo texto. */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(',')}}`;
}

/** SHA-256 (hex) do conteúdo canônico. Exige crypto.subtle (https, localhost ou Node 20+). */
export async function impressaoDigital(conteudo: ConteudoEvidencia): Promise<string> {
  const sutil = globalThis.crypto?.subtle;
  if (!sutil) throw new Error('crypto.subtle indisponível: sem SHA-256 não há evidência');
  const bytes = new TextEncoder().encode(canonico(conteudo));
  const h = new Uint8Array(await sutil.digest('SHA-256', bytes));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- montagem ---------- */

export interface ContextoCalculo {
  travas?: TravasBanca;
  registradasNoJogo?: string[];
  /** instantes (ISO com milissegundos) logo antes e logo depois do derivar() */
  calculadoEm: { inicio: string; fim: string };
}

const PARAMETROS_MOTOR = {
  MANDO_PADRAO,
  MEDIA_GOLS_PADRAO,
  FATOR_CHUTE_NO_ALVO,
  FATOR_GRANDE_CHANCE,
  LIMITE_MATCHUP,
  FAIXA_LAMBDA,
  PESO_MODELO_BASE,
  W_MAX_NIVEL3,
  GATE_V4,
  MIN_CASAS_CONSENSO,
  DISCORDANCIA_FORTE,
  MARGEM_MAXIMA_REF,
  JANELA_COMPARAVEL_MIN,
  JOGOS_MIN_NICHO,
  DIVERGENCIA_MAX_ENTRADA,
  DIVERGENCIA_SINAL_FORTE,
  CHANCE_SINAL_FORTE,
  RHO_PADRAO,
  FRACAO_1T,
  MEDIA_CONTAGEM_PADRAO,
  MANDO_CONTAGEM,
  DISPERSAO,
  MAX_POR_APOSTA,
  TETO_DIA,
};

/** O que cada print de estatística leu sozinho (a mesma leitura do derivar, antes de juntar). */
function porPrint(r: Rascunho, fonte: 'sofascore' | 'superscore') {
  const nomes = { casa: r.jogo.casa || 'Mandante', fora: r.jogo.fora || 'Visitante' };
  return (r.prints[fonte] ?? []).map((l) => ({
    arquivo: l.arquivo,
    capturadoEm: l.capturadoEm,
    leitura: lerEstatisticasConsenso([l.texto, ...(l.releituras ?? [])], fonte, nomes),
  }));
}

/** Monta o conteúdo (sem meta). Não altera `r` nem `d`. */
export function montarConteudo(
  r: Rascunho,
  d: Derivado,
  ctx: Pick<ContextoCalculo, 'travas' | 'registradasNoJogo'>,
): ConteudoEvidencia {
  const valor = (t: 'casa' | 'fora') => d.tabela.partidas?.[t]?.valor;
  const bruto = {
    esquema: ESQUEMA_EVIDENCIA,
    limitacoes: LIMITACOES_EVIDENCIA,
    jogo: {
      casa: r.jogo.casa,
      fora: r.jogo.fora,
      competicao: r.jogo.competicao,
      data: r.jogo.data,
      hora: r.jogo.hora,
      inicio: inicioIso(r),
    },
    entrada: {
      // o id é do histórico (vai em meta.idJogo); dentro do conteúdo mudaria o hash à toa
      rascunho: { ...r, idHistorico: undefined },
      travas: ctx.travas ?? null,
      registradasNoJogo: ctx.registradasNoJogo ?? [],
    },
    parametros: {
      motor: PARAMETROS_MOTOR,
      exposicao: POLITICA_EXPOSICAO,
      fatorDesfalque: FATOR_DESFALQUE,
      config: r.config,
    },
    fontes: {
      sofascore: { porPrint: porPrint(r, 'sofascore'), juntada: d.sofa },
      superscore: { porPrint: porPrint(r, 'superscore'), juntada: d.sup },
      flashscore: d.flash,
      classificacao: d.classificacao,
    },
    consolidado: { tabela: d.tabela, correcoes: r.correcoes },
    amostra: {
      partidas: { casa: valor('casa') ?? null, fora: valor('fora') ?? null },
      fontesComDados: [
        d.sofa && Object.keys(d.sofa.campos).length ? 'sofascore' : null,
        d.sup && Object.keys(d.sup.campos).length ? 'superscore' : null,
        d.flash ? 'flashscore' : null,
      ].filter(Boolean),
    },
    modelo: {
      casa: d.modeloCasa,
      fora: d.modeloFora,
      lambda: d.lambda,
      contagens: d.contagens,
      dq: d.dq,
      dqFinal: d.dqFinal,
      desfalques: d.desfalques,
      avisosDesfalques: d.avisosDesfalques,
      impacto: d.impacto,
      escalacao: d.escalacao,
      pendencias: d.pendencias,
    },
    mercado: {
      oddsValidas: d.oddsValidas,
      problemasOdds: d.problemasOdds,
      errosOdds: d.errosOdds,
      mercado1x2: d.mercado1x2,
      motivoSem1x2: d.motivoSem1x2,
      movimentos: d.movimentos,
      atrasos: d.atrasos,
      pendenciasV4: d.pendenciasV4,
    },
    avaliacao: { v4: d.v4, entradas: d.entradas, v33: d.resultado },
  };
  const invalidos: ValorInvalido[] = [];
  const omitidos = new Map<string, { tipo: string; quantidade: number }>();
  const limpo = sanitizar(bruto, invalidos, omitidos) as Omit<
    ConteudoEvidencia,
    'invalidos' | 'omitidos'
  >;
  return {
    ...limpo,
    invalidos,
    omitidos: [...omitidos].map(([campo, o]) => ({ campo, ...o })),
  };
}

/** Evidência completa, ainda sem número de revisão (o banco atribui na transação). */
export async function montarEvidencia(
  idJogo: string,
  r: Rascunho,
  d: Derivado,
  ctx: ContextoCalculo,
  build: VersaoBuild = buildAtual(),
  gravadoEm = new Date().toISOString(),
): Promise<Evidencia> {
  const conteudo = montarConteudo(r, d, ctx);
  return {
    esquema: ESQUEMA_EVIDENCIA,
    meta: {
      idJogo,
      revisao: 0,
      gravadoEm,
      hash: await impressaoDigital(conteudo),
      build,
      calculadoEm: ctx.calculadoEm,
    },
    conteudo,
  };
}

/** Só pré-live: depois do apito o motor responde "excluído" e a evidência não vale. */
export function antesDoApito(r: Rascunho, agora = Date.now()): boolean {
  const inicio = Date.parse(inicioIso(r));
  return !Number.isFinite(inicio) || agora < inicio;
}

/* ---------- revisões (planejadas aqui, aplicadas numa transação do banco) ---------- */

export interface RevisaoExistente {
  revisao: number;
  hash: string;
}

export type PlanoRevisao =
  { acao: 'igual'; revisao: number } | { acao: 'gravar'; revisao: number; apagar: number[] };

/**
 * Conteúdo igual ao da última revisão: nada a gravar. Diferente: próxima revisão (maior + 1,
 * mesmo depois de podar). Passou de 50: fica a primeira e as 49 mais recentes.
 */
export function planejarRevisao(existentes: RevisaoExistente[], hash: string): PlanoRevisao {
  const ordem = [...existentes].sort((a, b) => a.revisao - b.revisao);
  const ultima = ordem[ordem.length - 1];
  if (ultima && ultima.hash === hash) return { acao: 'igual', revisao: ultima.revisao };
  const revisao = (ultima?.revisao ?? 0) + 1;
  const todas = [...ordem.map((e) => e.revisao), revisao];
  const apagar =
    todas.length > LIMITE_REVISOES ? todas.slice(1, todas.length - (LIMITE_REVISOES - 1)) : [];
  return { acao: 'gravar', revisao, apagar };
}

export type PlanoImportacao =
  { acao: 'ja-existe'; revisao: number } | { acao: 'gravar'; evidencia: Evidencia };

/**
 * Importação de backup: conteúdo já guardado (mesmo hash) não duplica; número livre mantém o
 * número; número ocupado por OUTRO conteúdo ganha número novo, guardando o original em
 * meta.importacao. Nada é sobrescrito nem podado na importação.
 */
export function planejarImportacao(
  existentes: RevisaoExistente[],
  vindas: Evidencia[],
  importadoEm = new Date().toISOString(),
): PlanoImportacao[] {
  const atuais = [...existentes];
  const planos: PlanoImportacao[] = [];
  for (const ev of [...vindas].sort((a, b) => a.meta.revisao - b.meta.revisao)) {
    const igual = atuais.find((e) => e.hash === ev.meta.hash);
    if (igual) {
      planos.push({ acao: 'ja-existe', revisao: igual.revisao });
      continue;
    }
    const ocupado = atuais.some((e) => e.revisao === ev.meta.revisao);
    const revisao = ocupado ? Math.max(0, ...atuais.map((e) => e.revisao)) + 1 : ev.meta.revisao;
    const meta: MetaEvidencia = ocupado
      ? { ...ev.meta, revisao, importacao: { revisaoOriginal: ev.meta.revisao, importadoEm } }
      : ev.meta;
    atuais.push({ revisao, hash: ev.meta.hash });
    planos.push({ acao: 'gravar', evidencia: { ...ev, meta } });
  }
  return planos;
}

/** Forma mínima de uma evidência vinda de fora (backup): o resto é conferido pelo hash. */
export function pareceEvidencia(x: unknown): x is Evidencia {
  const e = x as Evidencia;
  return (
    !!e &&
    typeof e.esquema === 'string' &&
    !!e.meta &&
    typeof e.meta.idJogo === 'string' &&
    Number.isInteger(e.meta.revisao) &&
    e.meta.revisao > 0 &&
    typeof e.meta.hash === 'string' &&
    !!e.conteudo &&
    typeof e.conteudo === 'object'
  );
}

/* ---------- reprodução ---------- */

export type TipoReproducao =
  /** mesmo commit e o recálculo deu o mesmo conteúdo */
  | 'reproducao-original'
  /** mesmo commit e conteúdo diferente: defeito (o motor não é determinístico ou faltou insumo) */
  | 'divergiu-no-mesmo-build'
  /** commit diferente: é reprocessamento com outra versão, não reprodução */
  | 'reprocessamento-outra-versao'
  /** o build original ou o atual não tem commit conhecido: não dá para afirmar reprodução */
  | 'versao-desconhecida';

/**
 * Classifica um recálculo. Só afirma reprodução exata quando os DOIS builds têm commit conhecido,
 * são o mesmo e nenhum dos dois tinha alteração local sem commit.
 */
export function classificarReproducao(
  original: Evidencia,
  hashRecalculado: string,
  atual: VersaoBuild,
): { tipo: TipoReproducao; mesmoConteudo: boolean } {
  const mesmoConteudo = hashRecalculado === original.meta.hash;
  const b = original.meta.build;
  if (
    !b.commit ||
    !atual.commit ||
    b.alteracoesLocais !== false ||
    atual.alteracoesLocais !== false
  )
    return { tipo: 'versao-desconhecida', mesmoConteudo };
  if (b.commit !== atual.commit) return { tipo: 'reprocessamento-outra-versao', mesmoConteudo };
  return {
    tipo: mesmoConteudo ? 'reproducao-original' : 'divergiu-no-mesmo-build',
    mesmoConteudo,
  };
}
