/**
 * Ajuste C: o diagnóstico não prepara build, não abre processo e não executa o motor. Aqui
 * node:child_process é substituído por uma versão que REGISTRA e RECUSA qualquer chamada (git,
 * npm, vitest, node...). O diagnóstico inteiro, de arquivos a relatório, tem de passar sem
 * nenhuma chamada. A área é montada à mão (prepararArea usaria git).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { raizRepositorio, type Area } from '../src/reproducao/area';
import { executarBancada } from '../src/reproducao/executarBancada';
import { REFERENCIA_TESTE_SINTETICA } from '../src/reproducao/referencia';
import { arquivosBancada } from './fixtures/bancada';

const { chamadas } = vi.hoisted(() => ({ chamadas: [] as string[] }));
vi.mock('node:child_process', async (original) => {
  const real = await original<typeof import('node:child_process')>();
  const recusar =
    (nome: string) =>
    (...a: unknown[]) => {
      chamadas.push(`${nome} ${String(a[0])}`);
      throw new Error(`processo proibido no diagnóstico: ${nome}`);
    };
  return {
    ...real,
    execFileSync: recusar('execFileSync'),
    execSync: recusar('execSync'),
    execFile: recusar('execFile'),
    exec: recusar('exec'),
    spawn: recusar('spawn'),
    spawnSync: recusar('spawnSync'),
    fork: recusar('fork'),
  };
});

const base = join(process.env.LOCALAPPDATA as string, 'pe-bancada', 'testes');
mkdirSync(base, { recursive: true });
const raiz = mkdtempSync(join(base, 'diag-'));
const area: Area = { raiz, builds: join(raiz, 'builds'), execucoes: join(raiz, 'execucoes') };
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

describe('diagnóstico sem processo', () => {
  it('controle: o bloqueio funciona (git é recusado e registrado)', () => {
    expect(() => raizRepositorio()).toThrow(/processo proibido/);
    expect(chamadas).toHaveLength(1);
    chamadas.length = 0;
  });

  it('com e sem referência: arquivos → F1.1 → previsões → relatório, sem nenhuma chamada de processo', async () => {
    const arquivos = await arquivosBancada();
    for (const ref of [REFERENCIA_TESTE_SINTETICA, undefined]) {
      const r = await executarBancada(arquivos, {
        modo: 'diagnostico',
        area,
        referenciaDeTeste: ref,
      });
      expect(r.consolidado.modo).toBe('diagnostico');
      expect(
        r.consolidado.analises.every(
          (a) => a.status === 'nao-executado' || a.status === 'sem-revisao-de-decisao',
        ),
      ).toBe(true);
      expect(
        r.consolidado.analises
          .filter((a) => a.previsao)
          .every((a) => a.previsao!.natureza === 'previsao'),
      ).toBe(true);
      expect(JSON.parse(readFileSync(join(r.pasta, 'relatorio-revisao.json'), 'utf8')).modo).toBe(
        'diagnostico',
      );
    }
    expect(chamadas).toEqual([]);
  });
});
