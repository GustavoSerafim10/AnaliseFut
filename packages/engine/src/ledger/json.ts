/**
 * Serialização JSON CANÔNICA do Ledger (esquema 1).
 *
 * Objetivo: o mesmo valor lógico gera SEMPRE exatamente os mesmos bytes, em qualquer máquina, para
 * que o hash seja reproduzível. É compatível com o RFC 8785 (JCS) nos pontos em que ele define o
 * comportamento e MAIS estrita nos demais (em vez de "adivinhar", recusa).
 *
 * Regras (qualquer mudança nelas exige novo número de esquema):
 *
 * OBJETOS
 *   - Só objetos "puros" (protótipo Object.prototype ou null). Date, Map, Set, RegExp, classes e
 *     funções são RECUSADOS (erro), nunca convertidos em silêncio. Datas entram como STRING ISO 8601.
 *   - Chaves em ordem crescente por unidade de código UTF-16 (a mesma ordem do JCS e do
 *     Array.prototype.sort padrão do JavaScript), independente da ordem de inserção.
 *   - Só propriedades próprias, enumeráveis e de chave string. Chaves-símbolo são ignoradas.
 *     Propriedades de acesso (getters) são lidas uma vez.
 *   - CAMPO AUSENTE: uma propriedade com valor `undefined` é OMITIDA. Portanto `{a: undefined}` e
 *     `{}` geram a mesma saída. `null` é um valor e É preservado: `{a: null}` ≠ `{}`.
 *
 * ARRAYS
 *   - A ordem é preservada (é parte do significado).
 *   - `undefined` dentro de array e arrays esparsos (buracos) são RECUSADOS, porque o JSON.stringify
 *     os converteria em `null` e isso esconderia uma diferença real.
 *
 * NÚMEROS
 *   - Só números finitos. NaN, +Infinity e -Infinity são RECUSADOS.
 *   - -0 é escrito como `0`. Os demais seguem o algoritmo Number::toString do ECMAScript (o mesmo
 *     do JCS): `0.1 + 0.2` → `0.30000000000000004`, `1e21` → `1e+21`, `100` → `100`.
 *   - BigInt é RECUSADO (não existe em JSON). Valores em ponto flutuante devem ser guardados já
 *     arredondados por quem grava; a serialização não arredonda nada.
 *
 * STRINGS E UNICODE
 *   - Nenhuma normalização Unicode: "é" composto (U+00E9) e decomposto (U+0065 U+0301) são strings
 *     DIFERENTES e geram hashes diferentes. Texto de prints e nomes são preservados byte a byte.
 *   - Escapes do JSON.stringify "bem formado" (ES2019): aspas, barra invertida e controles
 *     U+0000–U+001F viram \uXXXX ou \n \t etc.; surrogates solitários viram \udXXX (assim o texto
 *     mal formado também é preservado, sem virar U+FFFD). U+2028/U+2029 e caracteres não-ASCII
 *     ficam literais. A saída é codificada em UTF-8 antes de ser hasheada.
 *
 * VALORES PROIBIDOS
 *   - `undefined` no topo, funções, símbolos, BigInt, referências circulares e profundidade acima
 *     de 200 níveis: erro `ErroSerializacao` com o caminho do problema.
 *
 * DATAS: sempre strings ISO 8601 com deslocamento explícito (ex.: "2026-11-13T15:10:00-03:00").
 */

export type Json =
  null | boolean | number | string | Json[] | { [chave: string]: Json | undefined };

export class ErroSerializacao extends Error {
  constructor(
    mensagem: string,
    readonly caminho: string,
  ) {
    super(`${mensagem} (em ${caminho || 'raiz'})`);
    this.name = 'ErroSerializacao';
  }
}

const PROFUNDIDADE_MAXIMA = 200;

function ehObjetoPuro(v: object): boolean {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

function serializar(v: unknown, caminho: string, pilha: object[]): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new ErroSerializacao(`número não finito (${v})`, caminho);
      return Object.is(v, -0) ? '0' : JSON.stringify(v);
    case 'string':
      return JSON.stringify(v);
    case 'undefined':
      throw new ErroSerializacao('valor undefined não é serializável aqui', caminho);
    case 'bigint':
      throw new ErroSerializacao('BigInt não é serializável', caminho);
    case 'function':
    case 'symbol':
      throw new ErroSerializacao(`${typeof v} não é serializável`, caminho);
  }
  const obj = v as object;
  if (pilha.length >= PROFUNDIDADE_MAXIMA)
    throw new ErroSerializacao(`profundidade acima de ${PROFUNDIDADE_MAXIMA}`, caminho);
  if (pilha.includes(obj)) throw new ErroSerializacao('referência circular', caminho);
  pilha.push(obj);
  try {
    if (Array.isArray(obj)) {
      const partes: string[] = [];
      for (let i = 0; i < obj.length; i++) {
        if (!(i in obj)) throw new ErroSerializacao('array esparso (buraco)', `${caminho}[${i}]`);
        if (obj[i] === undefined)
          throw new ErroSerializacao('undefined dentro de array', `${caminho}[${i}]`);
        partes.push(serializar(obj[i], `${caminho}[${i}]`, pilha));
      }
      return `[${partes.join(',')}]`;
    }
    if (!ehObjetoPuro(obj)) {
      const nome = (obj as { constructor?: { name?: string } }).constructor?.name ?? 'desconhecido';
      throw new ErroSerializacao(`objeto não puro (${nome}); use string ISO para datas`, caminho);
    }
    const registro = obj as Record<string, unknown>;
    const partes: string[] = [];
    for (const chave of Object.keys(registro).sort()) {
      const valor = registro[chave];
      if (valor === undefined) continue; // campo ausente: omitido
      partes.push(`${JSON.stringify(chave)}:${serializar(valor, `${caminho}.${chave}`, pilha)}`);
    }
    return `{${partes.join(',')}}`;
  } finally {
    pilha.pop();
  }
}

/** A serialização canônica (string). Lança ErroSerializacao se o valor não for serializável. */
export function serializarCanonico(valor: unknown): string {
  return serializar(valor, '', []);
}
