/**
 * Núcleo do harness de reprodução. É COPIADO para dentro do build histórico (apps/web/test/) e
 * roda com o código e o ferramental daquele commit: por isso não importa nada — tudo o que usa
 * do build chega por `carregar()`. Também roda dentro da bancada (testes rápidos), com os
 * módulos atuais.
 *
 * Passos: valida o ambiente (fuso, deslocamento, localidade), bloqueia a rede, devolve à entrada
 * os números não finitos que a Fase 0 marcou como {$invalido} (só os listados), fixa o relógio
 * em calculadoEm.inicio e recalcula o conteúdo da evidência com as funções do próprio build.
 */

export interface EntradaNucleo {
  /** conteudo.entrada gravado: { rascunho, travas, registradasNoJogo } */
  entradaGravada: unknown;
  /** conteudo.invalidos gravado: guia da restauração de {$invalido} */
  invalidos: { campo: string; valor: string; motivo: string }[];
  /** instante ISO em que o relógio fica parado */
  relogio: string;
  esperado: { fuso: string; localidade: string; localidadeRelevante: boolean };
}

export interface ModulosBuild {
  derivar: unknown;
  montarConteudo: unknown;
  canonico: unknown;
  impressaoDigital: unknown;
}

export interface AmbienteNucleo {
  node: string;
  v8: string;
  icu: string | null;
  plataforma: string;
  arquitetura: string;
  fuso: string;
  deslocamentoMin: number;
  localidade: string;
  localidadeColacao: string;
}

export type SaidaNucleo =
  | { status: 'ok'; conteudoCanonico: string; hash: string; ambiente: AmbienteNucleo }
  | {
      status: 'ambiente-invalido' | 'entrada-irrecuperavel' | 'api-ausente' | 'erro-execucao';
      motivo: string;
      ambiente: AmbienteNucleo | null;
    };

export interface Controles {
  carregar: () => Promise<ModulosBuild>;
  fixarRelogio: (ms: number) => void;
  liberarRelogio: () => void;
}

/** Instante fixo para medir o deslocamento do fuso (janeiro: sem horário de verão no Brasil). */
const INSTANTE_FUSO = Date.UTC(2026, 0, 15, 12, 0, 0);

export function medirAmbiente(): AmbienteNucleo {
  const v = (globalThis as { process?: { versions?: Record<string, string> } }).process;
  const p = (globalThis as { process?: { platform?: string; arch?: string } }).process;
  return {
    node: v?.versions?.node ?? '',
    v8: v?.versions?.v8 ?? '',
    icu: v?.versions?.icu ?? null,
    plataforma: p?.platform ?? '',
    arquitetura: p?.arch ?? '',
    fuso: Intl.DateTimeFormat().resolvedOptions().timeZone,
    deslocamentoMin: new Date(INSTANTE_FUSO).getTimezoneOffset(),
    localidade: Intl.DateTimeFormat().resolvedOptions().locale,
    localidadeColacao: new Intl.Collator().resolvedOptions().locale,
  };
}

/** Deslocamento esperado do fuso no instante fixo, calculado pelo próprio ICU. */
function deslocamentoEsperado(fuso: string): number | null {
  try {
    const partes = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(INSTANTE_FUSO));
    const n = (t: string) => Number(partes.find((x) => x.type === t)?.value);
    const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'));
    return (INSTANTE_FUSO - local) / 60_000;
  } catch {
    return null;
  }
}

export function validarAmbiente(a: AmbienteNucleo, e: EntradaNucleo['esperado']): string | null {
  if (a.fuso !== e.fuso) return `fuso efetivo "${a.fuso}" ≠ esperado "${e.fuso}"`;
  const esperado = deslocamentoEsperado(e.fuso);
  if (esperado === null || a.deslocamentoMin !== esperado)
    return `deslocamento efetivo ${a.deslocamentoMin} min ≠ esperado ${esperado} min para ${e.fuso}`;
  if (
    e.localidadeRelevante &&
    (a.localidade !== e.localidade || a.localidadeColacao !== e.localidade)
  )
    return `localidade efetiva "${a.localidade}" (colação "${a.localidadeColacao}") ≠ esperada "${e.localidade}"`;
  return null;
}

const ehMarcador = (x: unknown): x is { $invalido: string } =>
  !!x &&
  typeof x === 'object' &&
  !Array.isArray(x) &&
  Object.keys(x).length === 1 &&
  Object.keys(x)[0] === '$invalido';

const NUMERO: Record<string, number> = {
  NaN: Number.NaN,
  Infinity: Infinity,
  '-Infinity': -Infinity,
};

/**
 * Devolve os números não finitos à entrada. Só restaura marcador que esteja listado em
 * `invalidos` no mesmo caminho, com o mesmo valor, e que tenha sido número não finito (não
 * referência circular). Qualquer outro marcador, ou {$omitido} na entrada, torna a entrada
 * irrecuperável — nada é adivinhado.
 */
export function restaurarEntrada(
  entrada: unknown,
  invalidos: EntradaNucleo['invalidos'],
): { ok: true; valor: unknown } | { ok: false; motivo: string } {
  const lista = new Map(
    invalidos
      .filter((i) => i.motivo.startsWith('número não finito'))
      .map((i) => [i.campo, i.valor] as const),
  );
  const problemas: string[] = [];
  const andar = (x: unknown, caminho: string): unknown => {
    if (ehMarcador(x)) {
      const v = x.$invalido;
      if (lista.get(caminho) === v && v in NUMERO) return NUMERO[v];
      problemas.push(`${caminho}: {$invalido: ${JSON.stringify(v)}} sem registro correspondente`);
      return x;
    }
    if (Array.isArray(x)) return x.map((y, i) => andar(y, `${caminho}[${i}]`));
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (Object.keys(o).length === 1 && '$omitido' in o) {
        problemas.push(`${caminho}: {$omitido} na entrada (função não é dado)`);
        return x;
      }
      return Object.fromEntries(
        Object.entries(o).map(([k, y]) => [k, andar(y, `${caminho}.${k}`)]),
      );
    }
    return x;
  };
  const valor = andar(entrada, 'entrada');
  return problemas.length ? { ok: false, motivo: problemas.join('; ') } : { ok: true, valor };
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function executarNucleo(e: EntradaNucleo, c: Controles): Promise<SaidaNucleo> {
  const ambiente = medirAmbiente();
  const ruim = validarAmbiente(ambiente, e.esperado);
  if (ruim) return { status: 'ambiente-invalido', motivo: ruim, ambiente };

  const relogio = Date.parse(e.relogio);
  if (!Number.isFinite(relogio))
    return { status: 'erro-execucao', motivo: `relógio ilegível: ${e.relogio}`, ambiente };

  const r = restaurarEntrada(e.entradaGravada, e.invalidos);
  if (!r.ok) return { status: 'entrada-irrecuperavel', motivo: r.motivo, ambiente };
  const ent = r.valor as { rascunho?: unknown; travas?: unknown; registradasNoJogo?: unknown };

  let m: ModulosBuild;
  try {
    m = await c.carregar();
  } catch (x) {
    return {
      status: 'api-ausente',
      motivo: `módulos do build não carregam: ${mensagem(x)}`,
      ambiente,
    };
  }
  const faltam = (['derivar', 'montarConteudo', 'canonico', 'impressaoDigital'] as const).filter(
    (k) => typeof m[k] !== 'function',
  );
  if (faltam.length)
    return { status: 'api-ausente', motivo: `o build não exporta: ${faltam.join(', ')}`, ambiente };

  // rede bloqueada: a reprodução só usa o que está gravado
  const g = globalThis as { fetch?: unknown };
  const fetchOriginal = g.fetch;
  g.fetch = () => Promise.reject(new Error('rede bloqueada durante a reprodução'));
  try {
    const derivar = m.derivar as (r: unknown, t?: unknown, reg?: unknown) => unknown;
    const montar = m.montarConteudo as (r: unknown, d: unknown, ctx: unknown) => unknown;
    const canonico = m.canonico as (v: unknown) => string;
    const impressao = m.impressaoDigital as (v: unknown) => Promise<string>;
    const travas = ent.travas ?? undefined;
    const registradas = Array.isArray(ent.registradasNoJogo) ? ent.registradasNoJogo : [];
    let conteudo: unknown;
    c.fixarRelogio(relogio);
    try {
      const d = derivar(ent.rascunho, travas, registradas);
      conteudo = montar(ent.rascunho, d, { travas, registradasNoJogo: registradas });
    } finally {
      c.liberarRelogio();
    }
    return {
      status: 'ok',
      conteudoCanonico: canonico(conteudo),
      hash: await impressao(conteudo),
      ambiente,
    };
  } catch (x) {
    return { status: 'erro-execucao', motivo: mensagem(x), ambiente };
  } finally {
    g.fetch = fetchOriginal;
  }
}
