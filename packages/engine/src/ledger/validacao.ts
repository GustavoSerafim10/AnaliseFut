/**
 * Validação semântica dos registros do esquema 1: a data e a forma do corpo para cada tipo.
 * Não olha o hash (isso é de cadeia.ts) e não interpreta números do motor: só confere que o corpo
 * é do tipo que o cabeçalho declara e que os campos centrais têm o tipo e o domínio que os
 * produtores reais geram. Valores `undefined` contam como campo ausente, igual à serialização
 * canônica.
 *
 * Mudar qualquer regra daqui muda o que um registro de esquema 1 pode conter: exige novo esquema.
 *
 * Contrato dos campos aninhados: o CORPO de cada tipo tem exatamente os campos listados (nem a mais,
 * nem a menos). Já os objetos que são cópias de saídas do motor (`stakeAutorizada`, `travas`,
 * `aposta`, `resultado`) exigem os campos centrais com o tipo certo e TOLERAM campos a mais, porque
 * o motor e o app podem acrescentar informação sem invalidar o passado. Estatísticas e contexto
 * são só "objeto simples": não têm contrato mais rígido.
 */
import type { TravasBanca } from '../banca';
import type { StakeAutorizada } from '../kelly';
import { ehHashSha256 } from './hash';
import { serializarCanonico } from './json';
import type { CabecalhoLedger, TipoRegistro } from './tipos';

// ─────────────── datas

/** ISO 8601 com deslocamento explícito (Z ou ±hh:mm), com ou sem fração de segundo. */
const ISO_COM_DESLOCAMENTO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** Deslocamentos aceitos, em minutos em relação ao UTC: de −12:00 a +14:00 (os fusos reais). */
export const DESLOCAMENTO_MINIMO_MINUTOS = -12 * 60;
export const DESLOCAMENTO_MAXIMO_MINUTOS = 14 * 60;

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
 * março) e por isso não basta. Regras:
 *  - `Z` e `+00:00` valem; `-00:00` (fuso desconhecido, no RFC 3339) é recusado;
 *  - o deslocamento fica entre −12:00 e +14:00, com minutos de 00 a 59;
 *  - hora 24 e segundo 60 (segundo intercalar) são recusados;
 *  - letras minúsculas (`t`, `z`), espaços e texto sobrando são recusados.
 */
export function ehDataIsoComDeslocamento(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  const m = ISO_COM_DESLOCAMENTO.exec(x);
  if (!m) return false;
  const [ano, mes, dia, hora, min, seg] = m.slice(1, 7).map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasDoMes(ano, mes)) return false;
  if (hora > 23 || min > 59 || seg > 59) return false;
  if (m[7] !== undefined) {
    const hh = Number(m[8]);
    const mm = Number(m[9]);
    if (mm > 59) return false;
    const minutos = hh * 60 + mm;
    if (m[7] === '-' && minutos === 0) return false; // "-00:00"
    const desloc = m[7] === '-' ? -minutos : minutos;
    if (desloc < DESLOCAMENTO_MINIMO_MINUTOS || desloc > DESLOCAMENTO_MAXIMO_MINUTOS) return false;
  }
  return Number.isFinite(Date.parse(x));
}

// ─────────────── formas básicas

type Obj = Record<string, unknown>;

const ehObjeto = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Objeto simples: não nulo, não array, protótipo `Object.prototype` ou nulo. */
const ehObjetoSimples = (x: unknown): x is Obj => {
  if (!ehObjeto(x)) return false;
  const p = Object.getPrototypeOf(x);
  return p === Object.prototype || p === null;
};

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

// ─────────────── regras por campo

interface Regra {
  /** o que o campo precisa ser, para a mensagem */
  esperado: string;
  ok: (x: unknown) => boolean;
}

const finito = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const naoNegativo = (x: unknown): boolean => finito(x) && x >= 0;
const inteiroNaoNegativo = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 0;
const textoNaoVazio = (x: unknown): boolean => typeof x === 'string' && x.trim().length > 0;
/**
 * Lista DENSA em que todo elemento é válido. `Array.prototype.every` PULA as posições vazias
 * (`new Array(3)`, `[1, , 2]`), então ele aceitaria uma lista esparsa e uma lista vazia de buracos;
 * aqui cada índice de 0 a length−1 tem de existir e passar no predicado.
 */
const listaDe =
  (p: (x: unknown) => boolean) =>
  (x: unknown): boolean => {
    if (!Array.isArray(x)) return false;
    for (let i = 0; i < x.length; i++) if (!(i in x) || !p(x[i])) return false;
    return true;
  };

const R = {
  finito: { esperado: 'um número finito', ok: finito } satisfies Regra,
  naoNegativo: {
    esperado: 'um número finito maior ou igual a zero',
    ok: naoNegativo,
  } satisfies Regra,
  inteiroNaoNegativo: {
    esperado: 'um inteiro maior ou igual a zero',
    ok: inteiroNaoNegativo,
  } satisfies Regra,
  logico: {
    esperado: 'verdadeiro ou falso',
    ok: (x: unknown) => typeof x === 'boolean',
  } satisfies Regra,
  texto: { esperado: 'um texto', ok: (x: unknown) => typeof x === 'string' } satisfies Regra,
  textoNaoVazio: { esperado: 'um texto não vazio', ok: textoNaoVazio } satisfies Regra,
  data: {
    esperado: 'uma data ISO 8601 com deslocamento válida',
    ok: ehDataIsoComDeslocamento,
  } satisfies Regra,
  objetoSimples: { esperado: 'um objeto simples', ok: ehObjetoSimples } satisfies Regra,
  listaDeTextos: {
    esperado: 'uma lista de textos',
    ok: listaDe((t) => typeof t === 'string'),
  } satisfies Regra,
};

/**
 * Uma regra por campo DECLARADO do tipo `T` (o compilador exige todas, nem uma a mais) e, para os
 * campos opcionais do tipo, a marca `opcional` (o compilador também a exige, e a recusa nos
 * obrigatórios). Assim a validação acompanha a definição do motor.
 */
type Regras<T> = {
  [K in keyof T]-?: Regra &
    (Partial<Pick<T, K>> extends Pick<T, K> ? { opcional: true } : { opcional?: false });
};

const LIMITES_DA_STAKE: readonly StakeAutorizada['limites'][number][] = ['teto', 'jogo', 'dia'];

/** Campo a campo de `StakeAutorizada` (kelly.ts): o tipo declarado e o domínio produzido por `autorizarStake`. */
const REGRAS_STAKE: Regras<StakeAutorizada> = {
  autorizada: R.logico,
  motivo: { ...R.texto, opcional: true },
  // pode ser negativo: "EV negativo continua negativo" (kellyCheio)
  kellyCheio: R.finito,
  // 0 ou mais: reduções só multiplicam por [0, 1]
  fracaoKelly: R.naoNegativo,
  // max(0, …) limitado pelo teto
  fracaoBanca: R.naoNegativo,
  limites: {
    esperado: `uma lista com ${LIMITES_DA_STAKE.map((l) => `"${l}"`).join(', ')}`,
    ok: listaDe((l) => LIMITES_DA_STAKE.includes(l as StakeAutorizada['limites'][number])),
  },
  teto: R.naoNegativo,
  // arredondado para baixo ao centavo; ausente quando não havia banca
  valor: { ...R.naoNegativo, opcional: true },
};

/** Campo a campo de `TravasBanca` (banca.ts): o tipo declarado e o domínio produzido por `calcularTravas`. */
const REGRAS_TRAVAS: Regras<TravasBanca> = {
  // a banca pode zerar ou ficar negativa com perdas: só precisa ser finita
  bancaInicial: R.finito,
  bancaAtual: R.finito,
  pico: R.finito,
  drawdown: R.naoNegativo,
  // multiplicador das frações de Kelly
  fatorKelly: R.naoNegativo,
  pausadoAte: {
    esperado: 'uma data ISO 8601 com deslocamento válida ou null',
    ok: (x) => x === null || ehDataIsoComDeslocamento(x),
  },
  perdasHoje: R.inteiroNaoNegativo,
  diaEncerrado: R.logico,
  expostoHoje: R.naoNegativo,
  expostoJogo: { ...R.naoNegativo, opcional: true },
  motivos: R.listaDeTextos,
};

/**
 * A aposta como o usuário registrou. Os campos centrais da aposta real do app (odd, casa, valor,
 * feitaEm); `entrada`, quando existe, é só "objeto simples" (o formato é do app, não do motor).
 */
const REGRAS_APOSTA: Record<string, Regra & { opcional?: boolean }> = {
  // o app só aceita odd maior que 1
  odd: { esperado: 'um número finito maior que 1', ok: (x) => finito(x) && x > 1 },
  casa: R.textoNaoVazio,
  // valor em R$, opcional: o formulário não impõe mínimo, mas não existe aposta de valor negativo
  valor: { ...R.naoNegativo, opcional: true },
  feitaEm: R.data,
  entrada: { ...R.objetoSimples, opcional: true },
};

/** O resultado do jogo: placar inteiro e a data do registro; o restante (intervalo, escanteios…) é livre. */
const REGRAS_RESULTADO: Record<string, Regra & { opcional?: boolean }> = {
  casa: R.inteiroNaoNegativo,
  fora: R.inteiroNaoNegativo,
  registradoEm: R.data,
};

/** Confere os campos com regra; tolera campos a mais. */
function validarCampos(
  o: unknown,
  regras: Record<string, Regra & { opcional?: boolean }>,
  nome: string,
): string | null {
  if (!ehObjetoSimples(o)) return `${nome} deve ser um objeto simples`;
  for (const [campo, regra] of Object.entries(regras)) {
    const v = o[campo];
    if (v === undefined) {
      if (!regra.opcional) return `${nome}.${campo} ausente`;
      continue;
    }
    if (!regra.ok(v)) return `${nome}.${campo} deve ser ${regra.esperado}`;
  }
  return null;
}

// ─────────────── corpos

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
  // a saída do motor pode ser parcial ({}), mas é sempre um objeto simples
  if (!ehObjetoSimples(c.saida)) return 'decisao.saida deve ser um objeto simples';
  const sn = chavesExatas(
    c.snapshot,
    ['odds', 'estatisticas', 'contexto', 'prints'],
    'decisao.snapshot',
  );
  if (sn) return sn;
  const snapshot = c.snapshot as Obj;
  // lista densa; o formato de cada linha é do motor (LinhaOdd) e não é duplicado aqui
  if (!listaDe((linha) => linha !== undefined)(snapshot.odds))
    return 'decisao.snapshot.odds deve ser uma lista sem posições vazias';
  if (!ehObjetoSimples(snapshot.estatisticas))
    return 'decisao.snapshot.estatisticas deve ser um objeto simples';
  if (!ehObjetoSimples(snapshot.contexto))
    return 'decisao.snapshot.contexto deve ser um objeto simples';
  const prints = snapshot.prints;
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
  return (
    refOuNulo(c.decisao, 'aposta_registrada.decisao') ??
    validarCampos(c.aposta, REGRAS_APOSTA, 'aposta_registrada.aposta') ??
    validarCampos(c.stakeAutorizada, REGRAS_STAKE, 'aposta_registrada.stakeAutorizada') ??
    validarCampos(c.travas, REGRAS_TRAVAS, 'aposta_registrada.travas')
  );
}

function validarResultado(c: Obj): string | null {
  const e = chavesExatas(c, ['decisao', 'resultado'], 'resultado');
  if (e) return e;
  return (
    refOuNulo(c.decisao, 'resultado.decisao') ??
    validarCampos(c.resultado, REGRAS_RESULTADO, 'resultado.resultado')
  );
}

function validarCorrecao(c: Obj): string | null {
  const e = chavesExatas(c, ['motivo', 'novo'], 'correcao');
  if (e) return e;
  if (typeof c.motivo !== 'string') return 'correcao.motivo deve ser texto';
  // sem contrato para o conteúdo enquanto não houver produtor: basta existir e ser serializável
  try {
    serializarCanonico(c.novo);
  } catch (erro) {
    return `correcao.novo não é serializável: ${(erro as Error).message}`;
  }
  return null;
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
 * A ligação `corrige` do cabeçalho: só em `correcao`, exatamente `{ seq, hash }` (sem campo a mais),
 * `seq` inteiro positivo e ESTRITAMENTE menor que o `seq` do próprio registro. Se o registro
 * apontado existe e tem esse hash, só a cadeia sabe (verificarCadeia; na gravação, a L2).
 */
function motivoCorrigeInvalido(
  tipo: TipoRegistro,
  corrige: unknown,
  seqDoRegistro: number,
): string | null {
  if (tipo !== 'correcao')
    return corrige === undefined ? null : '`corrige` só existe em registros do tipo correcao';
  if (corrige === undefined) return 'correção sem `corrige` no cabeçalho';
  const e = chavesExatas(corrige, ['seq', 'hash'], 'corrige');
  if (e) return `correção com \`corrige\` inválido: ${e}`;
  const c = corrige as { seq: unknown; hash: unknown };
  if (typeof c.seq !== 'number' || !Number.isInteger(c.seq) || c.seq < 1)
    return 'correção: `corrige.seq` deve ser um inteiro positivo';
  if (!ehHashSha256(c.hash)) return 'correção: `corrige.hash` fora do formato';
  if (c.seq >= seqDoRegistro)
    return `correção: \`corrige.seq\` (${c.seq}) deve ser estritamente menor que o seq do registro (${seqDoRegistro}): só se corrige o passado`;
  return null;
}

/**
 * Motivo pelo qual o corpo não é do tipo declarado (ou a ligação `corrige` do cabeçalho não bate com
 * o tipo); null se o registro é coerente. Só vale para o esquema 1.
 */
export function motivoCorpoIncompativel(
  cabecalho: Pick<CabecalhoLedger, 'tipo' | 'corrige' | 'seq'>,
  corpo: unknown,
): string | null {
  const validar = VALIDADORES[cabecalho.tipo];
  if (!validar) return `tipo desconhecido: ${String(cabecalho.tipo)}`;
  if (!ehObjeto(corpo)) return 'corpo não é um objeto';
  const erro = validar(corpo);
  if (erro) return `corpo incompatível com o tipo "${cabecalho.tipo}": ${erro}`;
  return motivoCorrigeInvalido(cabecalho.tipo, cabecalho.corrige, cabecalho.seq);
}
