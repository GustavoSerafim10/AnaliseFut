/**
 * Leitura dos três formatos de backup: v3 (.json.gz), v2 (.json) e v1 (.json antigo). Arquivo
 * defeituoso é recusado INTEIRO, com motivo e exclusão rastreada; v1 não "perde" evidências.
 */
import { describe, expect, it } from 'vitest';
import { lerBackup } from '../src/leitura/lerBackup';
import { backupGz, backupV1, backupV2, cenario, gzTexto } from './fixtures/geradores';

describe('v3 (.json.gz)', () => {
  it('lê histórico e todas as revisões, com SHA do arquivo e formato', async () => {
    const c = await cenario();
    const l = await lerBackup('a.json.gz', await backupGz([c.entrada], c.revisoes));
    expect(l.fonte).toMatchObject({ formato: 'v3-gz', recusada: false, suportaEvidencias: true });
    expect(l.fonte.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(l.historico).toHaveLength(1);
    expect(l.evidencias.map((e) => e.meta.revisao)).toEqual([1, 2, 3, 4]);
    expect(l.fisicos).toEqual({ historico: 1, evidencias: 4 });
    expect(l.exclusoes).toEqual([]);
  });

  it('cabeçalho "indisponiveis": marcado na fonte, sem fingir que há evidência', async () => {
    const c = await cenario();
    const l = await lerBackup(
      'b.json.gz',
      await backupGz([c.entrada], [], {
        evidenciasNoArquivo: 'indisponiveis',
        motivoSemEvidencias: 'x',
      }),
    );
    expect(l.fonte.evidenciasIndisponiveisNaOrigem).toBe(true);
    expect(l.evidencias).toEqual([]);
  });

  it('gzip truncado: recusado inteiro, nada aproveitado', async () => {
    const c = await cenario();
    const b = await backupGz([c.entrada], c.revisoes);
    const l = await lerBackup('t.json.gz', b.slice(0, Math.floor(b.length / 2)));
    expect(l.fonte.recusada).toBe(true);
    expect(l.historico).toEqual([]);
    expect(l.evidencias).toEqual([]);
    expect(l.fisicos).toEqual({ historico: 0, evidencias: 0 });
    expect(l.exclusoes).toHaveLength(1);
    expect(l.exclusoes[0].categoria).toBe('fonte-recusada');
  });

  it('revisão adulterada (SHA não confere): recusado inteiro', async () => {
    const c = await cenario();
    const adulterada = structuredClone(c.revisoes);
    (adulterada[1].conteudo as unknown as Record<string, unknown>).extra = 1;
    const l = await lerBackup('s.json.gz', await backupGz([c.entrada], adulterada));
    expect(l.fonte.recusada).toBe(true);
    expect(l.fonte.motivosRecusa.join(' ')).toMatch(/SHA|hash|impress/i);
  });

  it('gzip válido com conteúdo que não é backup: recusado', async () => {
    const l = await lerBackup('x.json.gz', await gzTexto('isto não é jsonl\n'));
    expect(l.fonte.recusada).toBe(true);
  });
});

describe('v2 (.json)', () => {
  it('lê histórico e evidências; itens sem forma de revisão viram exclusão contada', async () => {
    const c = await cenario();
    const l = await lerBackup('v2.json', backupV2([c.entrada], [...c.revisoes, { lixo: true }]));
    expect(l.fonte).toMatchObject({ formato: 'v2-json', recusada: false, suportaEvidencias: true });
    expect(l.evidencias).toHaveLength(4);
    expect(l.fisicos).toEqual({ historico: 1, evidencias: 5 });
    expect(l.exclusoes).toEqual([
      expect.objectContaining({ categoria: 'evidencia-malformada', id: 'evidencias[4]' }),
    ]);
  });

  it('revisão com SHA divergente: arquivo inteiro recusado', async () => {
    const c = await cenario();
    const ruim = structuredClone(c.revisoes);
    ruim[0].meta.hash = '0'.repeat(64);
    const l = await lerBackup('v2.json', backupV2([c.entrada], ruim));
    expect(l.fonte.recusada).toBe(true);
    expect(l.historico).toEqual([]);
  });

  it('JSON inválido e versão desconhecida: recusados com motivo', async () => {
    const a = await lerBackup('a.json', new TextEncoder().encode('{"versao":2,'));
    expect(a.fonte.recusada).toBe(true);
    expect(a.fonte.motivosRecusa[0]).toMatch(/JSON/);
    const b = await lerBackup('b.json', new TextEncoder().encode('{"versao":9,"historico":[]}'));
    expect(b.fonte.recusada).toBe(true);
    expect(b.fonte.motivosRecusa[0]).toContain('versão de backup desconhecida');
    const sem = await lerBackup('c.json', new TextEncoder().encode('{"versao":2}'));
    expect(sem.fonte.recusada).toBe(true);
  });
});

describe('v1 (.json antigo)', () => {
  it('formato histórico sem estrutura de evidências: NÃO é evidência perdida', async () => {
    const c = await cenario();
    const l = await lerBackup('v1.json', backupV1([c.entrada]));
    expect(l.fonte).toMatchObject({
      formato: 'v1-json',
      suportaEvidencias: false,
      evidenciasIndisponiveisNaOrigem: false,
      recusada: false,
    });
    expect(l.historico).toHaveLength(1);
    expect(l.exclusoes).toEqual([]);
  });
});
