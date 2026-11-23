/**
 * Backup .json.gz (versão 3, JSONL em fluxo): ida e volta, SHA-256 de cada revisão, arquivo
 * corrompido ou incompleto recusado inteiro com motivo, e a 2ª passada presa à 1ª.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ehGzip,
  escreverBackupGz,
  evidenciasDoBackupGz,
  FORMATO_BACKUP,
  montarBackupGz,
  verificarBackupGz,
  verificarEvidencias,
  type CabecalhoBackupGz,
} from '../src/backupGz';
import { derivar } from '../src/dados';
import { canonico, montarEvidencia, type Evidencia } from '../src/evidencias';
import { rascunhoExemplo } from '../src/exemplo';
import type { Rascunho } from '../src/estado';

const fx = (n: string) =>
  readFileSync(
    new URL(`../../../packages/parsers/test/fixtures-reais/${n}`, import.meta.url),
    'utf8',
  );

let revs: Evidencia[] = [];
const cabecalho: CabecalhoBackupGz = {
  formato: FORMATO_BACKUP,
  versao: 3,
  exportadoEm: '2026-11-18T20:00:00-03:00',
  historico: [{ id: 'jogo-1', salvoEm: 'x' }],
  banca: 1000,
};

beforeAll(async () => {
  vi.useFakeTimers({ now: new Date('2026-11-18T15:00:00Z'), toFake: ['Date'] });
  const ex = rascunhoExemplo();
  const passos: Rascunho[] = [
    ex,
    {
      ...ex,
      prints: { ...ex.prints, sofascore: [{ arquivo: 's1', texto: fx('sofascore-remo-1.txt') }] },
    },
    {
      ...ex,
      prints: {
        ...ex.prints,
        sofascore: [{ arquivo: 's1', texto: fx('sofascore-remo-1.txt') }],
        superscore: [{ arquivo: 'u1', texto: fx('superscore-remo-1.txt') }],
      },
    },
  ];
  revs = [];
  for (const [i, r] of passos.entries()) {
    const e = await montarEvidencia('jogo-1', r, derivar(r), {
      calculadoEm: { inicio: 'a', fim: 'b' },
    });
    revs.push({ ...e, meta: { ...e.meta, revisao: i + 1 } });
  }
  vi.useRealTimers();
});

async function* paginas(lista: Evidencia[], tamanho = 2) {
  for (let i = 0; i < lista.length; i += tamanho) yield lista.slice(i, i + tamanho);
}
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const abrirBytes = (b: Uint8Array) => () => new Blob([b]).stream();
/** gzip de linhas montadas à mão (para fabricar arquivos defeituosos válidos como gzip) */
async function gzLinhas(linhas: string[]): Promise<Uint8Array> {
  const s = new Blob([linhas.join('\n') + '\n'])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const linhasValidas = () => [
  JSON.stringify(cabecalho),
  ...revs.map((r) => JSON.stringify(r)),
  JSON.stringify({ fim: true, revisoes: revs.length }),
];

describe('ida e volta', () => {
  it('escreve em fluxo, confere SHA-256 de cada revisão e devolve tudo idêntico', async () => {
    const { blob, revisoes, bytesBrutos } = await escreverBackupGz(cabecalho, paginas(revs));
    const b = await bytes(blob);
    expect(ehGzip(b)).toBe(true);
    expect(revisoes).toBe(3);
    expect(b.length).toBeLessThan(bytesBrutos / 4);
    const v = await verificarBackupGz(abrirBytes(b));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.cabecalho).toEqual(cabecalho);
    expect(v.hashes).toEqual(revs.map((r) => r.meta.hash));
    const voltaram: Evidencia[] = [];
    for await (const e of evidenciasDoBackupGz(abrirBytes(b), v.hashes)) voltaram.push(e);
    expect(voltaram.map(canonico)).toEqual(revs.map(canonico));
  });

  it('backup sem nenhuma evidência (banco vazio) também é válido', async () => {
    const { blob } = await escreverBackupGz(cabecalho, paginas([]));
    const v = await verificarBackupGz(abrirBytes(await bytes(blob)));
    expect(v).toMatchObject({ ok: true, revisoes: 0 });
  });

  it('JSON antigo não é confundido com gzip', () => {
    expect(ehGzip(new TextEncoder().encode('{"versao":2'))).toBe(false);
    expect(ehGzip(new Uint8Array([0x1f]))).toBe(false);
  });
});

describe('arquivo corrompido ou incompleto: recusado inteiro, com motivo', () => {
  const motivos = async (b: Uint8Array) => {
    const v = await verificarBackupGz(abrirBytes(b));
    expect(v.ok).toBe(false);
    return v.ok ? '' : v.problemas.map((p) => `${p.linha ?? '-'}: ${p.motivo}`).join(' | ');
  };

  it('cortado no meio (download interrompido)', async () => {
    const { blob } = await escreverBackupGz(cabecalho, paginas(revs));
    const b = await bytes(blob);
    expect(await motivos(b.slice(0, Math.floor(b.length * 0.6)))).toMatch(
      /corrompido ou cortado|sem rodapé/,
    );
  });

  it('bytes trocados no meio do gzip', async () => {
    const { blob } = await escreverBackupGz(cabecalho, paginas(revs));
    const b = await bytes(blob);
    const meio = Math.floor(b.length / 2);
    for (let i = meio; i < meio + 16; i++) b[i] ^= 0xff;
    expect(await motivos(b)).toMatch(/corrompido|JSON|SHA-256|forma/);
  });

  it('conteúdo de uma revisão alterado (gzip válido): SHA-256 não confere, com a linha', async () => {
    const l = linhasValidas();
    const r2 = JSON.parse(l[2]) as Evidencia;
    (r2.conteudo.jogo as { casa: string }).casa = 'Adulterado FC';
    l[2] = JSON.stringify(r2);
    expect(await motivos(await gzLinhas(l))).toMatch(
      /^3: SHA-256 não confere \(jogo jogo-1, revisão 2\)/,
    );
  });

  it('sem rodapé', async () => {
    expect(await motivos(await gzLinhas(linhasValidas().slice(0, -1)))).toMatch(/sem rodapé/);
  });

  it('rodapé com contagem diferente', async () => {
    const l = linhasValidas();
    l[l.length - 1] = JSON.stringify({ fim: true, revisoes: 99 });
    expect(await motivos(await gzLinhas(l))).toMatch(/rodapé diz 99 revisões, o arquivo tem 3/);
  });

  it('conteúdo depois do rodapé', async () => {
    expect(await motivos(await gzLinhas([...linhasValidas(), '{"x":1}']))).toMatch(
      /depois do rodapé/,
    );
  });

  it('linha que não é JSON e linha que não é evidência', async () => {
    const l = linhasValidas();
    l.splice(2, 0, '{quebrado', '{"outra":"coisa"}');
    const m = await motivos(await gzLinhas(l));
    expect(m).toMatch(/3: linha não é JSON válido/);
    expect(m).toMatch(/4: linha não tem a forma de uma revisão/);
  });

  it('cabeçalho de outro formato', async () => {
    const l = linhasValidas();
    l[0] = JSON.stringify({ versao: 2, historico: [] });
    expect(await motivos(await gzLinhas(l))).toMatch(/1: cabeçalho não é de um backup versão 3/);
  });

  it('arquivo que não é gzip', async () => {
    expect(await motivos(new TextEncoder().encode('{"versao":2,"historico":[]}'))).toMatch(
      /corrompido ou cortado/,
    );
  });

  it('2ª passada: se o arquivo mudou depois da conferência, para com erro', async () => {
    const { blob } = await escreverBackupGz(cabecalho, paginas(revs));
    const b = await bytes(blob);
    const v = await verificarBackupGz(abrirBytes(b));
    if (!v.ok) throw new Error('deveria verificar');
    const outro = await gzLinhas([
      JSON.stringify(cabecalho),
      JSON.stringify(revs[1]),
      JSON.stringify({ fim: true, revisoes: 1 }),
    ]);
    const ler = async () => {
      for await (const e of evidenciasDoBackupGz(abrirBytes(outro), v.hashes)) void e;
    };
    await expect(ler()).rejects.toThrow(/o arquivo mudou/);
  });
});

describe('backup antigo (.json versão 2 com evidências)', () => {
  it('mesma conferência de SHA-256', async () => {
    expect(await verificarEvidencias(revs)).toEqual([]);
    const alterada = JSON.parse(JSON.stringify(revs[0])) as Evidencia;
    alterada.conteudo.limitacoes = ['outra'];
    const p = await verificarEvidencias([revs[1], alterada]);
    expect(p).toHaveLength(1);
    expect(p[0].motivo).toMatch(/evidência 2 \(jogo jogo-1, revisão 1\): SHA-256 não confere/);
  });
});

describe('impressão digital do backup (identifica a importação no diário)', () => {
  it('o mesmo arquivo dá sempre a mesma impressão', async () => {
    const b = await bytes((await escreverBackupGz(cabecalho, paginas(revs))).blob);
    const v1 = await verificarBackupGz(abrirBytes(b));
    const v2 = await verificarBackupGz(abrirBytes(b));
    if (!v1.ok || !v2.ok) throw new Error('deveria verificar');
    expect(v1.impressao).toMatch(/^[0-9a-f]{64}$/);
    expect(v2.impressao).toBe(v1.impressao);
  });
  it('mesmo nome e mesma contagem, revisões diferentes: impressões diferentes', async () => {
    const outras = revs.map((r) => ({ ...r, meta: { ...r.meta, idJogo: 'jogo-2' } }));
    const a = await verificarBackupGz(
      abrirBytes(await bytes((await escreverBackupGz(cabecalho, paginas(revs))).blob)),
    );
    const b = await verificarBackupGz(
      abrirBytes(await bytes((await escreverBackupGz(cabecalho, paginas(outras))).blob)),
    );
    if (!a.ok || !b.ok) throw new Error('deveria verificar');
    expect(b.revisoes).toBe(a.revisoes);
    expect(b.impressao).not.toBe(a.impressao);
  });
});

describe('exportação: nunca um arquivo incompleto que pareça completo', () => {
  const base = { ...cabecalho };
  it('banco aberto: leva todas e diz isso no cabeçalho', async () => {
    const r = await montarBackupGz(base, {
      abrir: async () => undefined,
      paginas: () => paginas(revs),
    });
    expect(r.semEvidencias).toBeNull();
    const v = await verificarBackupGz(abrirBytes(await bytes(r.blob)));
    if (!v.ok) throw new Error('deveria verificar');
    expect(v.cabecalho.evidenciasNoArquivo).toBe('todas');
    expect(v.revisoes).toBe(revs.length);
  });
  it('banco indisponível ANTES de começar: só o histórico, dito no arquivo', async () => {
    const lidas = vi.fn();
    const r = await montarBackupGz(base, {
      abrir: async () => {
        throw new Error('este navegador não tem banco (IndexedDB)');
      },
      paginas: () => {
        lidas();
        return paginas(revs);
      },
    });
    expect(lidas).not.toHaveBeenCalled();
    expect(r.semEvidencias).toMatch(/não tem banco/);
    expect(r.revisoes).toBe(0);
    const v = await verificarBackupGz(abrirBytes(await bytes(r.blob)));
    if (!v.ok) throw new Error('deveria verificar');
    expect(v.cabecalho.evidenciasNoArquivo).toBe('indisponiveis');
    expect(v.cabecalho.motivoSemEvidencias).toMatch(/não tem banco/);
    expect(v.cabecalho.historico).toEqual(cabecalho.historico);
  });
  it('leitura falha NO MEIO: backup cancelado, nenhum arquivo', async () => {
    async function* quebra() {
      yield revs.slice(0, 2);
      throw new Error('banco fechou no meio da leitura');
    }
    await expect(
      montarBackupGz(base, { abrir: async () => undefined, paginas: () => quebra() }),
    ).rejects.toThrow(/backup cancelado, nenhum arquivo gerado.*banco fechou no meio/);
  });
  it('cabeçalho "sem evidências" com revisões dentro: recusado', async () => {
    const b = await gzLinhas([
      JSON.stringify({ ...cabecalho, evidenciasNoArquivo: 'indisponiveis' }),
      JSON.stringify(revs[0]),
      JSON.stringify({ fim: true, revisoes: 1 }),
    ]);
    const v = await verificarBackupGz(abrirBytes(b));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problemas[0].motivo).toMatch(/saiu sem evidências, mas ele tem revisões/);
  });
});
