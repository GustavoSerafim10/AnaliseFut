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
  /**
   * Como a canônica foi escolhida: 'unica' (só uma versão), 'recencia' (pelo instante das datas)
   * ou 'desempate-por-conteudo' (datas inválidas ou empatadas: a ordem no tempo não pôde ser
   * provada; a escolha é determinística, mas fica marcada com o motivo em `alerta`)
   */
  criterio: CriterioCanonica;
  alerta: string | null;
}

export type CriterioCanonica = 'unica' | 'recencia' | 'desempate-por-conteudo';

/** As datas que decidem a recência, como vieram no arquivo (valor original preservado). */
export interface DatasVersao {
  registradoEm: string | null;
  feitaEm: string | null;
  salvoEm: string | null;
}

export interface VersaoSubstituida {
  id: string;
  fonte: string;
  datas: DatasVersao;
  criterio: Exclude<CriterioCanonica, 'unica'>;
  motivo: string;
}

export interface Juncao {
  fontes: FonteLida[];
  entradas: EntradaCanonica[];
  evidencias: Evidencia[];
  /** arquivos em que cada revisão canônica apareceu (por identidade), para rastrear exclusões */
  fontesDaEvidencia: Map<string, string[]>;
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

/**
 * Recência de uma versão de entrada: resultado, depois aposta, depois salvamento — comparados
 * pelo INSTANTE (Date.parse), nunca como texto: "-03:00" e "Z" do mesmo instante empatam.
 * Campo ausente vale "antes de tudo" (versão sem resultado é anterior à que tem). Campo
 * presente mas ilegível é marcado como inválido: não entra em comparação silenciosa.
 */
interface Recencia {
  datas: DatasVersao;
  instantes: number[];
  invalidas: string[];
}
export function recencia(e: EntradaHistorico): Recencia {
  const datas: DatasVersao = {
    registradoEm: e.resultado?.registradoEm ?? null,
    feitaEm: e.aposta?.feitaEm ?? null,
    salvoEm: e.salvoEm ?? null,
  };
  const invalidas: string[] = [];
  const instantes = (Object.keys(datas) as (keyof DatasVersao)[]).map((k) => {
    const v = datas[k];
    if (v === null) return -Infinity;
    const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
    if (!Number.isFinite(t)) invalidas.push(`${k}=${JSON.stringify(v)}`);
    return t;
  });
  return { datas, instantes, invalidas };
}
const compararInstantes = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

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
    const rs = versoes.map((v) => ({ ...v, r: recencia(v.entrada) }));
    const invalidas = rs.flatMap((v) => v.r.invalidas);
    // com data ilegível em qualquer versão, a ordem no tempo não é provável: só desempate
    const ordenadas = rs.sort(
      (a, b) =>
        (invalidas.length ? 0 : compararInstantes(b.r.instantes, a.r.instantes)) ||
        b.texto.localeCompare(a.texto),
    );
    const [canonica, ...antigas] = ordenadas;
    const empate =
      antigas.length > 0 && compararInstantes(canonica.r.instantes, antigas[0].r.instantes) === 0;
    const criterio: CriterioCanonica =
      versoes.length === 1
        ? 'unica'
        : invalidas.length || empate
          ? 'desempate-por-conteudo'
          : 'recencia';
    const alerta =
      criterio !== 'desempate-por-conteudo'
        ? null
        : invalidas.length
          ? `data inválida (${invalidas.join(', ')}): ordem no tempo não comprovada; canônica escolhida pelo conteúdo`
          : 'versões com as mesmas datas: ordem no tempo não comprovada; canônica escolhida pelo conteúdo';
    hist.canonicos++;
    hist.duplicatas += canonica.copias - 1;
    for (const v of antigas) {
      hist.substituidos++;
      hist.duplicatas += v.copias - 1;
      substituidas.push({
        id,
        fonte: v.fontes[0],
        datas: v.r.datas,
        criterio: criterio === 'recencia' ? 'recencia' : 'desempate-por-conteudo',
        motivo:
          criterio === 'recencia'
            ? `versão anterior (${JSON.stringify(v.r.datas)}) à canônica (${JSON.stringify(canonica.r.datas)})`
            : alerta!,
      });
    }
    entradas.push({
      entrada: canonica.entrada,
      fontes: [...(fontesPorId.get(id) ?? [])].sort(),
      versoes: versoes.length,
      criterio,
      alerta,
    });
  }
  entradas.sort((a, b) => a.entrada.id.localeCompare(b.entrada.id));
  const ids = new Set(entradas.map((e) => e.entrada.id));

  // ---------- evidências ----------
  const vistas = new Map<string, Evidencia>();
  const fontesEv = new Map<string, Set<string>>();
  for (const l of ordem) {
    for (const ev of l.evidencias) {
      const k = identidadeEvidencia(ev);
      fontesEv.set(k, (fontesEv.get(k) ?? new Set()).add(l.fonte.nome));
    }
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
    fontesDaEvidencia: new Map(
      evidencias.map((ev) => {
        const k = identidadeEvidencia(ev);
        return [k, [...(fontesEv.get(k) ?? [])].sort()];
      }),
    ),
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
