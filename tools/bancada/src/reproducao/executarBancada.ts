/**
 * Ponto de entrada único da bancada (F1.2c): arquivos → leitura → junção → F1.1 → (F1.2) →
 * consolidação, tudo sobre A MESMA junção, com as saídas só na área isolada.
 *
 *  - modo "diagnostico": não prepara build, não abre processo, não executa o motor (nem recebe
 *    provedor ou executor); cada análise sai "nao-executado" com uma PREVISÃO.
 *  - modo "execucao": roda a reprodução histórica (F1.2a + F1.2b) e consolida os resultados.
 *
 * Camada: com referenciaDeTeste é "teste-sintetica"; sem ela é "producao". Uma nunca entra na
 * outra. Saídas: consolidado.json (detalhe, local) e relatorio-revisao.json (só contagens).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonico } from '../../../../apps/web/src/evidencias';
import { normalizar, type ArquivoEntrada, type Conjunto } from '../index';
import { juntarBackups, type Juncao } from '../leitura/juntarBackups';
import { lerBackup } from '../leitura/lerBackup';
import type { Area } from './area';
import { sha256, type ProvedorBuild } from './build';
import { consolidar, relatorioDeRevisao } from './consolidar';
import type { Derivacoes } from '../derivacoes/contratoDerivacoes';
import { derivar, relatorioDeDerivacoes } from '../derivacoes/derivar';
import type { Camada, Consolidado, RelatorioRevisao } from './contratoConsolidacao';
import { preverReferencia } from './diagnostico';
import type { Executor } from './executor';
import type { ExecutorHistorico } from './executorHistorico';
import { reproducaoHistorica, type ReproducaoHistorica } from './historica';
import { REFERENCIA_TESTE_SINTETICA, type RegistroReferencia } from './referencia';

interface Base {
  area: Area;
  /** SOMENTE TESTES: referência sintética 8964bf4 → camada "teste-sintetica" */
  referenciaDeTeste?: string;
  registroReferencia?: RegistroReferencia;
  execucaoId?: string;
  /** F1.3: deriva P do modelo, peso w, mistura e desfecho (só leitura do motor) */
  derivar?: boolean;
}
export type OpcoesBancada =
  | (Base & { modo: 'diagnostico' })
  | (Base & {
      modo: 'execucao';
      provedor: ProvedorBuild;
      executor: Executor;
      executorHistorico: ExecutorHistorico;
      repositorio?: string;
      tempoLimiteMs?: number;
      fuso?: string;
      localidade?: string;
    });

export interface ResultadoBancada {
  pasta: string;
  juncao: Juncao;
  conjunto: Omit<Conjunto, 'impressao'>;
  consolidado: Consolidado;
  relatorio: RelatorioRevisao;
  /** resultado completo da F1.2 (revisões e entradas); null no diagnóstico */
  f12: ReproducaoHistorica | null;
  /** F1.3 (com derivar: true); null sem ela */
  derivacoes: Derivacoes | null;
}

export async function executarBancada(
  arquivos: ArquivoEntrada[],
  o: OpcoesBancada,
): Promise<ResultadoBancada> {
  const execucaoId =
    o.execucaoId ??
    `bancada-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
  const pasta = join(o.area.execucoes, execucaoId);
  mkdirSync(pasta, { recursive: true });

  // uma leitura, uma junção: F1.1 e F1.2 enxergam exatamente os mesmos registros
  const leituras = await Promise.all(arquivos.map((a) => lerBackup(a.nome, a.bytes)));
  const juncao = juntarBackups(leituras);
  const conjunto = normalizar(juncao);
  const impressaoConjunto = sha256(canonico(conjunto));
  // referência de teste inválida é recusada já aqui: a camada nunca fica "teste-sintetica" sem ela
  if (o.referenciaDeTeste !== undefined && o.referenciaDeTeste !== REFERENCIA_TESTE_SINTETICA)
    throw new Error(
      `referência de teste recusada: só ${REFERENCIA_TESTE_SINTETICA} é aceita como sintética`,
    );
  const camada: Camada = o.referenciaDeTeste !== undefined ? 'teste-sintetica' : 'producao';

  let consolidado: Consolidado;
  let f12: ReproducaoHistorica | null = null;
  if (o.modo === 'diagnostico') {
    consolidado = await consolidar({
      modo: 'diagnostico',
      conjunto,
      impressaoConjunto,
      juncao,
      camada,
      referencia: preverReferencia({
        registro: o.registroReferencia,
        referenciaDeTeste: o.referenciaDeTeste,
      }),
    });
  } else {
    f12 = await reproducaoHistorica(juncao, {
      area: o.area,
      provedor: o.provedor,
      executor: o.executor,
      executorHistorico: o.executorHistorico,
      repositorio: o.repositorio,
      registroReferencia: o.registroReferencia,
      referenciaDeTeste: o.referenciaDeTeste,
      tempoLimiteMs: o.tempoLimiteMs,
      fuso: o.fuso,
      localidade: o.localidade,
      execucaoId: join(execucaoId, 'f12'),
    });
    consolidado = await consolidar({
      modo: 'execucao',
      conjunto,
      impressaoConjunto,
      juncao,
      camada,
      f12,
    });
  }
  const relatorio = relatorioDeRevisao(consolidado);
  writeFileSync(join(pasta, 'consolidado.json'), JSON.stringify(consolidado, null, 1));
  writeFileSync(join(pasta, 'relatorio-revisao.json'), JSON.stringify(relatorio, null, 1));
  let derivacoes: Derivacoes | null = null;
  if (o.derivar) {
    derivacoes = derivar({ conjunto, juncao, consolidado });
    writeFileSync(join(pasta, 'derivacoes.json'), JSON.stringify(derivacoes, null, 1));
    writeFileSync(
      join(pasta, 'relatorio-derivacoes.json'),
      JSON.stringify(relatorioDeDerivacoes(derivacoes), null, 1),
    );
  }
  return { pasta, juncao, conjunto, f12, consolidado, relatorio, derivacoes };
}
