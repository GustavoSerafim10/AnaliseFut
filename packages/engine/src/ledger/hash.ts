/**
 * SHA-256 pela API padrão `crypto.subtle.digest` (assíncrona), sem implementação própria.
 * Disponível no Node 20+ e nos navegadores em contexto seguro (https e localhost). Se não existir,
 * lança `SubtleCryptoIndisponivel` em vez de gravar um registro sem hash.
 */

export class SubtleCryptoIndisponivel extends Error {
  constructor() {
    super(
      'crypto.subtle não está disponível: o Ledger exige SHA-256 nativo (contexto seguro https ou localhost)',
    );
    this.name = 'SubtleCryptoIndisponivel';
  }
}

interface SubtleMinimo {
  digest(algoritmo: string, dados: Uint8Array): Promise<ArrayBuffer>;
}

function subtle(): SubtleMinimo {
  const s = (globalThis as unknown as { crypto?: { subtle?: SubtleMinimo } }).crypto?.subtle;
  if (!s || typeof s.digest !== 'function') throw new SubtleCryptoIndisponivel();
  return s;
}

const codificador = () =>
  new (
    globalThis as unknown as { TextEncoder: new () => { encode(t: string): Uint8Array } }
  ).TextEncoder();

const HEX = '0123456789abcdef';
function paraHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += HEX[b >> 4] + HEX[b & 15];
  return s;
}

/** SHA-256 dos bytes, em hexadecimal minúsculo (64 caracteres). */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  return paraHex(new Uint8Array(await subtle().digest('SHA-256', bytes)));
}

/** SHA-256 do texto codificado em UTF-8, em hexadecimal minúsculo. */
export async function sha256Hex(texto: string): Promise<string> {
  return sha256HexBytes(codificador().encode(texto));
}

/** O formato de um hash do Ledger: 64 hexadecimais minúsculos. */
export const ehHashSha256 = (x: unknown): x is string =>
  typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);

/** true se a string não tem surrogate solitário (UTF-16 bem formado, convertível a UTF-8 sem perda). */
export const ehTextoBemFormado = (t: string): boolean =>
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t);
