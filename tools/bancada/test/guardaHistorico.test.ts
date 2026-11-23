/**
 * Guarda própria da bancada para v3 com "historico" que não é lista. O verificador da Fase 0 já
 * recusa esse cabeçalho; aqui ele é substituído por um que aceita, para provar que a bancada,
 * sozinha, também recusa com motivo explícito — nunca transforma em lista vazia.
 */
import { describe, expect, it, vi } from 'vitest';
import { lerBackup } from '../src/leitura/lerBackup';

vi.mock('../../../apps/web/src/backupGz', async (original) => ({
  ...(await original<typeof import('../../../apps/web/src/backupGz')>()),
  verificarBackupGz: async () => ({
    ok: true,
    problemas: [],
    cabecalho: { formato: 'x', versao: 3, exportadoEm: 'x', historico: { id: 'x' } },
    revisoes: 0,
    hashes: [],
    chaves: [],
    impressao: '',
  }),
}));

describe('guarda da bancada', () => {
  it('verificador aceitou, mas "historico" não é lista: a bancada recusa com motivo', async () => {
    const gzVazio = new Uint8Array([0x1f, 0x8b]);
    const l = await lerBackup('g.json.gz', gzVazio);
    expect(l.fonte.recusada).toBe(true);
    expect(l.fonte.motivosRecusa).toEqual(['cabeçalho com "historico" que não é lista (object)']);
    expect(l.historico).toEqual([]);
    expect(l.fisicos).toEqual({ historico: 0, evidencias: 0 });
  });
});
