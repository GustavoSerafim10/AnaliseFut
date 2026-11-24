/**
 * Orquestrador da reprodução (F1.2a). Para cada revisão de evidência, em ordem:
 *  1. integridade: o conteúdo gravado bate com meta.hash
 *  2. relógio: meta.calculadoEm.inicio legível
 *  3. build: elegível pelo meta.build gravado (senão: reprocessamento, F1.2b)
 *  4. preparo do build (cache por commit) e execução isolada do harness
 *  5. comparação: hash → estrutura (tolerância D3) → campos de decisão (sem tolerância)
 * Cada revisão termina em exatamente uma classe; a soma é conferida. Nada é escrito fora da
 * área isolada.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonico, impressaoDigital, type Evidencia } from '../../../../apps/web/src/evidencias';
import { identidadeEvidencia } from '../leitura/juntarBackups';
import type { Area } from './area';
import {
  elegibilidade,
  sha256,
  type BuildPreparado,
  type Preparo,
  type ProvedorBuild,
} from './build';
import { compararConteudos, porPrefixo } from './comparar';
import {
  FUSO_ESPERADO,
  LIMITE_DIFERENCAS,
  LOCALIDADE_ESPERADA,
  TEMPO_LIMITE_PADRAO_MS,
  VERSAO_CONTRATO_REPRODUCAO,
  type Manifesto,
  type ResultadoReproducao,
  type Subcausa,
} from './contrato';
import type { Executor } from './executor';
import type { EntradaNucleo } from './harness/zz-bancada-nucleo';

export interface ItemReproducao {
  evidencia: Evidencia;
  /** marcas herdadas da F1.1, ex.: 'cronologiaNaoComprovada' */
  marcas?: string[];
}

export interface OpcoesReproducao {
  area: Area;
  provedor: ProvedorBuild;
  executor: Executor;
  tempoLimiteMs?: number;
  fuso?: string;
  localidade?: string;
  execucaoId?: string;
  /** SOMENTE TESTES: relógio no lugar de calculadoEm (marcado no resultado) */
  substituirRelogioEmTeste?: string;
}

export interface Reproducao {
  pasta: string;
  resultados: ResultadoReproducao[];
  manifesto: Manifesto;
}

/** Resultados sem os campos naturalmente variáveis: a base da impressão e do determinismo. */
export const semVariaveis = (r: ResultadoReproducao): Omit<ResultadoReproducao, 'duracaoMs'> => {
  const resto: Partial<ResultadoReproducao> = { ...r };
  delete resto.duracaoMs;
  return resto as Omit<ResultadoReproducao, 'duracaoMs'>;
};

export async function reproduzir(
  itens: ItemReproducao[],
  o: OpcoesReproducao,
): Promise<Reproducao> {
  const execucaoId =
    o.execucaoId ??
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const pasta = join(o.area.execucoes, execucaoId);
  mkdirSync(join(pasta, 'conteudos'), { recursive: true });
  const iniciadaEm = new Date().toISOString();
  const fuso = o.fuso ?? FUSO_ESPERADO;
  const localidade = o.localidade ?? LOCALIDADE_ESPERADA;
  const preparos = new Map<string, Promise<Preparo>>();
  const resultados: ResultadoReproducao[] = [];

  for (const [i, item] of itens.entries()) {
    const t0 = performance.now();
    const ev = item.evidencia;
    const b = ev.meta.build ?? ({} as Evidencia['meta']['build']);
    const r: ResultadoReproducao = {
      identidade: identidadeEvidencia(ev),
      idJogo: ev.meta.idJogo,
      revisao: ev.meta.revisao,
      marcas: [...new Set(item.marcas ?? [])].sort(),
      buildPedido: {
        commit: b.commit ?? null,
        origem: b.origem ?? null,
        alteracoesLocais: b.alteracoesLocais ?? null,
      },
      buildUsado: null,
      ambiente: null,
      localidadeRelevante: null,
      relogio: {
        valor: o.substituirRelogioEmTeste ?? ev.meta.calculadoEm?.inicio ?? null,
        origem: o.substituirRelogioEmTeste ? 'substituido-em-teste' : 'calculadoEm',
      },
      shaEntrada: null,
      hashOriginal: ev.meta.hash,
      hashReproduzido: null,
      shaConteudoReproduzido: null,
      classe: 'nao-reproduzivel',
      subcausa: null,
      motivo: '',
      diferencasTotal: 0,
      diferencasDecisao: 0,
      diferencas: [],
      diferencasPorPrefixo: {},
      falha: null,
      duracaoMs: 0,
    };
    const naoReproduzivel = (subcausa: Subcausa, motivo: string) => {
      r.classe = 'nao-reproduzivel';
      r.subcausa = subcausa;
      r.motivo = motivo;
    };

    await (async () => {
      if ((await impressaoDigital(ev.conteudo)) !== ev.meta.hash)
        return naoReproduzivel(
          'evidencia-inconsistente',
          'o conteúdo gravado não bate com meta.hash',
        );
      if (!r.relogio.valor || !Number.isFinite(Date.parse(r.relogio.valor)))
        return naoReproduzivel(
          'relogio-desconhecido',
          'meta.calculadoEm.inicio ausente ou ilegível',
        );
      const eleg = elegibilidade(r.buildPedido);
      if (!eleg.ok)
        return naoReproduzivel(
          'build-nao-elegivel',
          `${eleg.motivo}; o caminho seria reprocessamento (F1.2b, não autorizado nesta etapa)`,
        );
      const commit = r.buildPedido.commit as string;
      if (!preparos.has(commit)) preparos.set(commit, o.provedor.preparar(commit));
      const p = await preparos.get(commit)!;
      if (!p.ok) return naoReproduzivel(p.subcausa, p.motivo);
      const build: BuildPreparado = p.build;
      r.buildUsado = {
        commit: build.commit,
        shaLockfile: build.shaLockfile,
        hashDependencias: build.hashDependencias,
        npm: build.npm,
      };
      r.localidadeRelevante = build.localidadeRelevante;

      const entrada: EntradaNucleo = {
        entradaGravada: ev.conteudo.entrada,
        invalidos: ev.conteudo.invalidos ?? [],
        relogio: r.relogio.valor,
        esperado: { fuso, localidade, localidadeRelevante: build.localidadeRelevante },
      };
      r.shaEntrada = sha256(canonico(entrada));
      const x = await o.executor.executar(build, entrada, {
        pastaExecucao: pasta,
        caso: String(i).padStart(4, '0'),
        tempoLimiteMs: o.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS,
        fuso,
        localidade,
      });
      if (x.tipo === 'falha') {
        r.falha = { mensagem: x.mensagem, codigoSaida: x.codigoSaida, registro: x.registro };
        return naoReproduzivel(x.subcausa, x.mensagem);
      }
      const s = x.saida;
      r.ambiente = s.ambiente;
      if (s.status !== 'ok') return naoReproduzivel(s.status, s.motivo);

      r.hashReproduzido = s.hash;
      r.shaConteudoReproduzido = sha256(s.conteudoCanonico);
      writeFileSync(
        join(pasta, 'conteudos', `${r.shaConteudoReproduzido}.json`),
        s.conteudoCanonico,
      );
      if (s.hash === ev.meta.hash) {
        r.classe = 'original-exata';
        r.motivo = 'hash idêntico ao gravado';
        return;
      }
      const difs = compararConteudos(ev.conteudo, JSON.parse(s.conteudoCanonico));
      const decisao = difs.filter((d) => d.decisao);
      const foraTol = difs.filter((d) => d.tipo !== 'numero-na-tolerancia');
      r.diferencasTotal = difs.length;
      r.diferencasDecisao = decisao.length;
      r.diferencas = difs.slice(0, LIMITE_DIFERENCAS);
      if (difs.length > LIMITE_DIFERENCAS) r.diferencasPorPrefixo = porPrefixo(difs);
      if (decisao.length || foraTol.length || !difs.length) {
        r.classe = 'original-divergente';
        r.motivo = !difs.length
          ? 'hash diferente sem diferença estrutural'
          : decisao.length
            ? `${decisao.length} diferença(s) em campo de decisão (sem tolerância)`
            : `${foraTol.length} diferença(s) fora da tolerância`;
        return;
      }
      r.classe = 'original-equivalente';
      r.motivo = `${difs.length} diferença(s) numérica(s) dentro da tolerância; campos de decisão idênticos`;
    })().catch((e: unknown) => {
      r.falha = {
        mensagem: e instanceof Error ? e.message : String(e),
        codigoSaida: null,
        registro: null,
      };
      naoReproduzivel('erro-execucao', `falha do orquestrador: ${r.falha.mensagem}`);
    });

    r.duracaoMs = Math.round(performance.now() - t0);
    resultados.push(r);
    appendFileSync(join(pasta, 'resultados.jsonl'), `${JSON.stringify(r)}\n`);
  }

  const conta = (f: (r: ResultadoReproducao) => string | null) => {
    const m: Record<string, number> = {};
    for (const r of resultados) {
      const k = f(r);
      if (k) m[k] = (m[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  const porClasse = conta((r) => r.classe);
  if (Object.values(porClasse).reduce((s, n) => s + n, 0) !== itens.length)
    throw new Error('conservação violada: revisões sem classe');
  const manifesto: Manifesto = {
    contrato: VERSAO_CONTRATO_REPRODUCAO,
    execucaoId,
    iniciadaEm,
    concluidaEm: new Date().toISOString(),
    entradas: itens.length,
    porClasse,
    porSubcausa: conta((r) => r.subcausa),
    impressaoEntradas: sha256(
      resultados
        .map((r) => r.identidade)
        .sort()
        .join('\n'),
    ),
    impressaoResultados: sha256(canonico(resultados.map(semVariaveis))),
  };
  writeFileSync(join(pasta, 'manifesto.json'), JSON.stringify(manifesto, null, 1));
  return { pasta, resultados, manifesto };
}
