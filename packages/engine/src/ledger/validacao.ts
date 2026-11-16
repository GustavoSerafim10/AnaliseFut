/**
 * Validação semântica dos registros do esquema 1: a data e a forma do corpo para cada tipo.
 * Não olha o hash (isso é de cadeia.ts) e não interpreta números do motor: só confere que o corpo
 * é do tipo que o cabeçalho declara. Valores `undefined` contam como campo ausente, igual à
 * serialização canônica.
 *
 * Mudar qualquer regra daqui muda o que um registro de esquema 1 pode conter: exige novo esquema.
 */
import { ehHashSha256 } from './hash';
import type { CabecalhoLedger, TipoRegistro } from './tipos';

/** ISO 8601 com deslocamento explícito (Z ou ±hh:mm), com ou sem fração de segundo. */
const ISO_COM_DESLOCAMENTO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

const diasDoMes = (ano: number, mes: number): number =>
  mes === 2
    ? ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(mes)
      ? 30
      : 31;

/**
 * true se for uma data ISO 8601 com deslocamento explícito que realmente existe no calendário.
 * Conferida componente a componente: o `Date.parse` do V8 "rola" datas impossíveis (30/02 vira
 * março) e por isso não basta. Segundo 60 (segundo intercalar) não é aceito.
 */
export function ehDataIsoComDeslocamento(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  const m = ISO_COM_DESLOCAMENTO.exec(x);
  if (!m) return false;
  const [ano, mes, dia, hora, min, seg] = m.slice(1, 7).map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDoMes(ano, mes)) return false;
  if (hora > 23 || min > 59 || seg > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  return Number.isFinite(Date.parse(x));
}

type Obj = Record<string, unknown>;

const ehObjeto = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

const chavesPresentes = (o: Obj): string[] => Object.keys(o).filter((k) => o[k] !== undefined);

/** Confere que o objeto tem exatamente estas chaves (as com valor undefined contam como ausentes). */
function chavesExatas(o: unknown, esperadas: readonly string[], nome: string): string | null {
  if (!ehObjeto(o)) return `${nome} não é um objeto`;
  const tem = chavesPresentes(o);
  const faltam = esperadas.filter((k) => !tem.includes(k));
  if (faltam.length) return `${nome}: faltam ${faltam.join(', ')}`;
  const sobram = tem.filter((k) => !esperadas.includes(k));
  if (sobram.length) return `${nome}: campos que não são deste tipo: ${sobram.join(', ')}`;
  return null;
}

const objetoOuNulo = (x: unknown): boolean => x === null || ehObjeto(x);

/** `decisao`: nulo ou { seq, hash } de um registro anterior. */
function refOuNulo(x: unknown, nome: string): string | null {
  if (x === null) return null;
  const e = chavesExatas(x, ['seq', 'hash'], nome);
  if (e) return e;
  const r = x as { seq: unknown; hash: unknown };
  if (typeof r.seq !== 'number' || !Number.isInteger(r.seq) || r.seq < 1)
    return `${nome}.seq inválido`;
  if (!ehHashSha256(r.hash)) return `${nome}.hash fora do formato`;
  return null;
}

function validarDecisao(c: Obj): string | null {
  const e = chavesExatas(c, ['entradaMotor', 'saida', 'snapshot', 'impressao'], 'decisao');
  if (e) return e;
  const em = chavesExatas(c.entradaMotor, ['v4', 'lista'], 'decisao.entradaMotor');
  if (em) return em;
  const entrada = c.entradaMotor as Obj;
  if (!objetoOuNulo(entrada.v4) || !objetoOuNulo(entrada.lista))
    return 'decisao.entradaMotor.v4 e .lista devem ser objeto ou null';
  const sn = chavesExatas(
    c.snapshot,
    ['odds', 'estatisticas', 'contexto', 'prints'],
    'decisao.snapshot',
  );
  if (sn) return sn;
  const prints = (c.snapshot as Obj).prints;
  if (!ehObjeto(prints)) return 'decisao.snapshot.prints não é um objeto';
  for (const [nome, h] of Object.entries(prints))
    if (!ehHashSha256(h)) return `decisao.snapshot.prints["${nome}"] não é um hash de blob`;
  if (typeof c.impressao !== 'string' || !c.impressao)
    return 'decisao.impressao deve ser um texto não vazio';
  return null;
}

function validarAposta(c: Obj): string | null {
  const e = chavesExatas(
    c,
    ['decisao', 'aposta', 'stakeAutorizada', 'travas'],
    'aposta_registrada',
  );
  if (e) return e;
  return refOuNulo(c.decisao, 'aposta_registrada.decisao');
}

function validarResultado(c: Obj): string | null {
  const e = chavesExatas(c, ['decisao', 'resultado'], 'resultado');
  if (e) return e;
  return refOuNulo(c.decisao, 'resultado.decisao');
}

function validarCorrecao(c: Obj): string | null {
  const e = chavesExatas(c, ['motivo', 'novo'], 'correcao');
  if (e) return e;
  return typeof c.motivo === 'string' ? null : 'correcao.motivo deve ser texto';
}

function validarExclusao(c: Obj): string | null {
  // `motivo: null` é um valor e fica; só `undefined` conta como ausente
  if (!ehObjeto(c)) return 'exclusao não é um objeto';
  const tem = Object.keys(c);
  if (!tem.includes('motivo') || c.motivo === undefined) return 'exclusao: faltam motivo';
  const sobram = chavesPresentes(c).filter((k) => k !== 'motivo');
  if (sobram.length) return `exclusao: campos que não são deste tipo: ${sobram.join(', ')}`;
  return c.motivo === null || typeof c.motivo === 'string'
    ? null
    : 'exclusao.motivo deve ser texto ou null';
}

const VALIDADORES: Record<TipoRegistro, (c: Obj) => string | null> = {
  decisao: validarDecisao,
  aposta_registrada: validarAposta,
  resultado: validarResultado,
  correcao: validarCorrecao,
  exclusao: validarExclusao,
};

/**
 * Motivo pelo qual o corpo não é do tipo declarado (ou a ligação `corrige` do cabeçalho não bate com
 * o tipo); null se o registro é coerente. Só vale para o esquema 1.
 */
export function motivoCorpoIncompativel(
  cabecalho: Pick<CabecalhoLedger, 'tipo' | 'corrige'>,
  corpo: unknown,
): string | null {
  const validar = VALIDADORES[cabecalho.tipo];
  if (!validar) return `tipo desconhecido: ${String(cabecalho.tipo)}`;
  if (!ehObjeto(corpo)) return 'corpo não é um objeto';
  const erro = validar(corpo);
  if (erro) return `corpo incompatível com o tipo "${cabecalho.tipo}": ${erro}`;
  if (cabecalho.tipo === 'correcao') {
    const c = cabecalho.corrige;
    if (!c || !Number.isInteger(c.seq) || c.seq < 1 || !ehHashSha256(c.hash))
      return 'correção sem `corrige` válido no cabeçalho';
  } else if (cabecalho.corrige !== undefined) {
    return '`corrige` só existe em registros do tipo correcao';
  }
  return null;
}
