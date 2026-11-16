/**
 * Blobs: o texto BRUTO dos prints, guardado uma vez por conteúdo. O hash é o SHA-256 dos bytes
 * UTF-8 do texto exatamente como veio (sem normalizar Unicode, sem aparar espaços, sem trocar
 * quebras de linha), então pode ser conferido fora do sistema: `sha256sum arquivo.txt`.
 *
 * Texto com surrogate solitário NÃO é aceito aqui: a codificação UTF-8 o trocaria por U+FFFD e dois
 * textos diferentes poderiam ter o mesmo hash. Quem grava (L2) decide o que fazer com esse caso raro.
 */
import { ehTextoBemFormado, sha256Hex } from './hash';
import type { BlobLedger } from './tipos';

export class TextoMalFormado extends Error {
  constructor() {
    super('texto com surrogate solitário: não pode ser hasheado sem perda');
    this.name = 'TextoMalFormado';
  }
}

const bytesUtf8 = (t: string): number =>
  new (
    globalThis as unknown as { TextEncoder: new () => { encode(t: string): { length: number } } }
  ).TextEncoder().encode(t).length;

export async function criarBlob(texto: string): Promise<BlobLedger> {
  if (!ehTextoBemFormado(texto)) throw new TextoMalFormado();
  return { hash: await sha256Hex(texto), texto, bytes: bytesUtf8(texto) };
}

/** true se o texto guardado ainda tem o hash e o tamanho registrados. */
export async function verificarBlob(blob: BlobLedger): Promise<boolean> {
  if (!ehTextoBemFormado(blob.texto)) return false;
  return blob.hash === (await sha256Hex(blob.texto)) && blob.bytes === bytesUtf8(blob.texto);
}
