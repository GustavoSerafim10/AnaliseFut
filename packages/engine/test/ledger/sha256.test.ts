/** SHA-256 pela API nativa: vetores OFICIAIS (FIPS 180-2 / NIST) e conferência cruzada. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  criarBlob,
  ehHashSha256,
  ehTextoBemFormado,
  sha256Hex,
  sha256HexBytes,
  TextoMalFormado,
  verificarBlob,
} from '../../src/ledger';

const referencia = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('vetores oficiais de SHA-256 (FIPS 180-2)', () => {
  const vetores: [string, string, string][] = [
    ['mensagem vazia', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['"abc"', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      '448 bits',
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      '896 bits',
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
    [
      'um milhão de "a"',
      'a'.repeat(1_000_000),
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    ],
  ];
  for (const [nome, entrada, esperado] of vetores)
    it(nome, async () => {
      expect(await sha256Hex(entrada)).toBe(esperado);
    });

  it('sobre bytes: os mesmos vetores', async () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]); // "abc"
    expect(await sha256HexBytes(bytes)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await sha256HexBytes(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('conferência cruzada com outra implementação (node:crypto)', () => {
  it('textos variados, com acentos, emoji, quebras de linha e caracteres de controle', async () => {
    const textos = [
      'Atlético-MG × Cruzeiro',
      'ção ñ ü ß 日本語 한국어 العربية',
      '😀 emoji 👨‍👩‍👧 combinado',
      'linha 1\nlinha 2\r\nlinha 3\t\u0000fim',
      ' espaços   nas pontas  ',
      '  ',
      'x'.repeat(65_537),
    ];
    for (const t of textos) expect(await sha256Hex(t)).toBe(referencia(t));
  });

  it('é UTF-8: "é" ocupa 2 bytes e muda o hash do "e"', async () => {
    expect(await sha256Hex('é')).toBe(referencia('é'));
    expect(await sha256Hex('é')).not.toBe(await sha256Hex('e'));
  });

  it('determinístico: o mesmo texto, o mesmo hash, sempre', async () => {
    const a = await sha256Hex('mesmo texto');
    for (let i = 0; i < 5; i++) expect(await sha256Hex('mesmo texto')).toBe(a);
  });
});

describe('formato do hash e texto bem formado', () => {
  it('64 hexadecimais minúsculos', async () => {
    expect(ehHashSha256(await sha256Hex('x'))).toBe(true);
    expect(ehHashSha256('ABC')).toBe(false);
    expect(ehHashSha256('A'.repeat(64))).toBe(false); // maiúsculas
    expect(ehHashSha256('a'.repeat(63))).toBe(false);
    expect(ehHashSha256(undefined)).toBe(false);
  });
  it('surrogate solitário é detectado', () => {
    expect(ehTextoBemFormado('ok 😀')).toBe(true);
    expect(ehTextoBemFormado('mal \uD83D formado')).toBe(false);
    expect(ehTextoBemFormado('mal \uDE00 formado')).toBe(false);
    expect(ehTextoBemFormado('')).toBe(true);
  });
});

describe('blobs: texto bruto endereçado pelo hash', () => {
  it('o hash é o do texto exato, verificável com sha256sum', async () => {
    const t = '  Over 2.5  1.80\r\n  Under 2.5 2.00 \n';
    const b = await criarBlob(t);
    expect(b.hash).toBe(referencia(t));
    expect(b.texto).toBe(t); // nada de trim, normalização ou troca de quebra de linha
    expect(b.bytes).toBe(Buffer.byteLength(t, 'utf8'));
    expect(await verificarBlob(b)).toBe(true);
  });

  it('não normaliza Unicode: forma composta e decomposta são blobs diferentes', async () => {
    const composto = await criarBlob('é');
    const decomposto = await criarBlob('é');
    expect(composto.hash).not.toBe(decomposto.hash);
    expect(composto.texto).toBe('é');
    expect(decomposto.texto).toBe('é');
  });

  it('mesmo conteúdo, mesmo hash (deduplicação)', async () => {
    expect((await criarBlob('print igual')).hash).toBe((await criarBlob('print igual')).hash);
  });

  it('um byte alterado quebra a verificação', async () => {
    const b = await criarBlob('Over 2.5 1.80');
    expect(await verificarBlob({ ...b, texto: 'Over 2.5 1.81' })).toBe(false);
    expect(await verificarBlob({ ...b, bytes: b.bytes + 1 })).toBe(false);
    expect(await verificarBlob({ ...b, hash: 'f'.repeat(64) })).toBe(false);
  });

  it('texto mal formado é recusado, não "consertado" em silêncio', async () => {
    await expect(criarBlob('quebrado \uD800')).rejects.toBeInstanceOf(TextoMalFormado);
  });

  it('texto vazio é um blob válido', async () => {
    const b = await criarBlob('');
    expect(b.hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(b.bytes).toBe(0);
  });
});
