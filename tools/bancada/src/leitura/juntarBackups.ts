/**
 * Junta vários backups (os semanais se repetem) num conjunto sem duplicatas, sem depender da
 * ordem em que os arquivos chegam, e prova a conservação: todo registro físico termina como
 * canônico, duplicata, versão substituída ou exclusão — com o motivo. Nada some.
 *
 * Identidades:
 *  - revisão de evidência: jogo + hash do conteúdo + horário original (a mesma da Fase 0)
 *  - entrada do histórico: id; versões diferentes do mesmo id → fica a mais recente
 */
import { canonico, ESQUEMA_EVIDENCIA, type Evidencia } from '../../../../apps/web/src/evidencias';
import type { EntradaHistorico } from '../../../../apps/web/src/historico';
import type { Conservacao, Exclusao, FonteLida } from '../contrato';
import type { LeituraBackup } from './lerBackup';

export interface EntradaCanonica {
  entrada: EntradaHistorico;
  /** arquivos em que alguma versão desta entrada apareceu */
  fontes: string[];
  /** versões diferentes vistas (1 = nunca mudou) */
  versoes: number;
}

export interface VersaoSubstituida {
  id: string;
  fonte: string;
  motivo: string;
}

export interface Juncao {
  fontes: FonteLida[];
  entradas: EntradaCanonica[];
  evidencias: Evidencia[];
  substituidas: VersaoSubstituida[];
  exclusoes: Exclusao[];
  conservacao: {
    historico: Conservacao;
    evidencias: Conservacao;
    /** arquivos lidos e recusados (um arquivo recusado não chega a ter registros contáveis) */
    arquivos: { lidos: number; recusados: number };
  };
}

/** Forma mínima de uma análise do histórico. */
export function pareceEntrada(x: unknown): x is EntradaHistorico {
  const e = x as EntradaHistorico;
  return (
    !!e &&
    typeof e === 'object' &&
    typeof e.id === 'string' &&
    !!e.id &&
    !!e.rascunho &&
    typeof e.rascunho === 'object' &&
    !!e.resumo &&
    typeof e.resumo === 'object'
  );
}

/** Identidade de uma revisão de evidência (a mesma da Fase 0). */
export const identidadeEvidencia = (e: Evidencia) =>
  JSON.stringify([e.meta.idJogo, e.meta.hash, e.meta.gravadoEm]);

/** Recência de uma versão de entrada: resultado, aposta, salvamento; desempate pelo conteúdo. */
const recencia = (e: EntradaHistorico): string =>
  [e.resultado?.registradoEm ?? '', e.aposta?.feitaEm ?? '', e.salvoEm ?? ''].join('|');

function verificarConservacao(nome: string, c: Conservacao): void {
  const soma = c.canonicos + c.duplicatas + c.substituidos + c.excluidos;
  if (soma !== c.fisicos)
    throw new Error(
      `conservação violada (${nome}): ${c.fisicos} físicos ≠ ${c.canonicos} canônicos + ${c.duplicatas} duplicatas + ${c.substituidos} substituídos + ${c.excluidos} excluídos`,
    );
}

export function juntarBackups(leituras: LeituraBackup[]): Juncao {
  // ordem determinística: o resultado não depende da ordem em que os arquivos chegaram
  const ordem = [...leituras].sort(
    (a, b) =>
      a.fonte.sha256.localeCompare(b.fonte.sha256) || a.fonte.nome.localeCompare(b.fonte.nome),
  );
  const exclusoes: Exclusao[] = [];
  const substituidas: VersaoSubstituida[] = [];
  const hist: Conservacao = {
    fisicos: 0,
    canonicos: 0,
    duplicatas: 0,
    substituidos: 0,
    excluidos: 0,
  };
  const evid: Conservacao = {
    fisicos: 0,
    canonicos: 0,
    duplicatas: 0,
    substituidos: 0,
    excluidos: 0,
  };

  // ---------- histórico ----------
  const versoesPorId = new Map<
    string,
    { texto: string; entrada: EntradaHistorico; fontes: string[]; copias: number }[]
  >();
  const fontesPorId = new Map<string, Set<string>>();
  for (const l of ordem) {
    exclusoes.push(...l.exclusoes.filter((x) => x.categoria === 'fonte-recusada'));
    hist.fisicos += l.fisicos.historico;
    l.historico.forEach((x, i) => {
      if (!pareceEntrada(x)) {
        hist.excluidos++;
        exclusoes.push({
          categoria: 'entrada-malformada',
          fonte: l.fonte.nome,
          id:
            typeof (x as { id?: unknown })?.id === 'string'
              ? (x as { id: string }).id
              : `historico[${i}]`,
          motivo: 'item de "historico" sem id, rascunho ou resumo',
        });
        return;
      }
      const texto = canonico(x);
      const lista = versoesPorId.get(x.id) ?? [];
      const igual = lista.find((v) => v.texto === texto);
      if (igual) {
        igual.copias++;
        igual.fontes.push(l.fonte.nome);
      } else lista.push({ texto, entrada: x, fontes: [l.fonte.nome], copias: 1 });
      versoesPorId.set(x.id, lista);
      fontesPorId.set(x.id, (fontesPorId.get(x.id) ?? new Set()).add(l.fonte.nome));
    });
  }
  const entradas: EntradaCanonica[] = [];
  for (const [id, versoes] of versoesPorId) {
    const ordenadas = [...versoes].sort(
      (a, b) =>
        recencia(b.entrada).localeCompare(recencia(a.entrada)) || b.texto.localeCompare(a.texto),
    );
    const [canonica, ...antigas] = ordenadas;
    hist.canonicos++;
    hist.duplicatas += canonica.copias - 1;
    for (const v of antigas) {
      hist.substituidos++;
      hist.duplicatas += v.copias - 1;
      substituidas.push({
        id,
        fonte: v.fontes[0],
        motivo: `versão mais antiga (${recencia(v.entrada)}) que a canônica (${recencia(canonica.entrada)})`,
      });
    }
    entradas.push({
      entrada: canonica.entrada,
      fontes: [...(fontesPorId.get(id) ?? [])].sort(),
      versoes: versoes.length,
    });
  }
  entradas.sort((a, b) => a.entrada.id.localeCompare(b.entrada.id));
  const ids = new Set(entradas.map((e) => e.entrada.id));

  // ---------- evidências ----------
  const vistas = new Map<string, Evidencia>();
  for (const l of ordem) {
    evid.fisicos += l.fisicos.evidencias;
    for (const x of l.exclusoes.filter((e) => e.categoria === 'evidencia-malformada')) {
      evid.excluidos++;
      exclusoes.push(x);
    }
    for (const ev of l.evidencias) {
      const chave = identidadeEvidencia(ev);
      if (vistas.has(chave)) {
        evid.duplicatas++;
        continue;
      }
      if (ev.esquema !== ESQUEMA_EVIDENCIA) {
        evid.excluidos++;
        exclusoes.push({
          categoria: 'esquema-desconhecido',
          fonte: l.fonte.nome,
          id: chave,
          motivo: `esquema "${ev.esquema}" (conhecido: "${ESQUEMA_EVIDENCIA}")`,
        });
        vistas.set(chave, ev); // cópias seguintes contam como duplicata desta exclusão
        continue;
      }
      if (!ids.has(ev.meta.idJogo)) {
        evid.excluidos++;
        exclusoes.push({
          categoria: 'evidencia-orfa',
          fonte: l.fonte.nome,
          id: chave,
          motivo: `nenhuma entrada do histórico com o id ${ev.meta.idJogo}`,
        });
        vistas.set(chave, ev);
        continue;
      }
      vistas.set(chave, ev);
      evid.canonicos++;
    }
  }
  const evidencias = [...vistas.values()]
    .filter((ev) => ev.esquema === ESQUEMA_EVIDENCIA && ids.has(ev.meta.idJogo))
    .sort(
      (a, b) =>
        a.meta.idJogo.localeCompare(b.meta.idJogo) ||
        a.meta.revisao - b.meta.revisao ||
        identidadeEvidencia(a).localeCompare(identidadeEvidencia(b)),
    );

  verificarConservacao('histórico', hist);
  verificarConservacao('evidências', evid);
  return {
    fontes: ordem.map((l) => l.fonte),
    entradas,
    evidencias,
    substituidas: substituidas.sort(
      (a, b) => a.id.localeCompare(b.id) || a.fonte.localeCompare(b.fonte),
    ),
    exclusoes: exclusoes.sort(
      (a, b) =>
        a.categoria.localeCompare(b.categoria) ||
        a.fonte.localeCompare(b.fonte) ||
        (a.id ?? '').localeCompare(b.id ?? ''),
    ),
    conservacao: {
      historico: hist,
      evidencias: evid,
      arquivos: { lidos: ordem.length, recusados: ordem.filter((l) => l.fonte.recusada).length },
    },
  };
}

export { verificarConservacao };
