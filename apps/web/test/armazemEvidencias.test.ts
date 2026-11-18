/**
 * Banco de evidências quando falha: o histórico nunca depende dele. (A concorrência entre abas
 * e a gravação real foram conferidas num Chrome de verdade: o Node não tem IndexedDB.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registrarEvidencia } from '../src/armazemEvidencias';
import { derivar } from '../src/dados';
import { rascunhoExemplo } from '../src/exemplo';
import { salvarNoHistorico } from '../src/historico';

afterEach(() => vi.useRealTimers());

describe('falha do banco de evidências', () => {
  it('sem IndexedDB: devolve aviso, não lança, e o histórico já salvo segue intacto', async () => {
    expect(typeof indexedDB).toBe('undefined');
    const r = rascunhoExemplo();
    const d = derivar(r);
    const { lista, id } = salvarNoHistorico([], r, d);
    const antes = JSON.stringify(lista);
    const aviso = await registrarEvidencia(id, r, d, { calculadoEm: { inicio: 'a', fim: 'b' } });
    expect(aviso).toMatch(/salva no histórico, mas a evidência não foi gravada/);
    expect(JSON.stringify(lista)).toBe(antes);
    expect(lista).toHaveLength(1);
  });

  it('depois do apito: não tenta gravar (nem avisa)', async () => {
    const r = rascunhoExemplo();
    const d = derivar(r);
    vi.useFakeTimers({ now: Date.now() + 4 * 3_600_000, toFake: ['Date'] });
    expect(await registrarEvidencia('x', r, d, { calculadoEm: { inicio: 'a', fim: 'b' } })).toBe(
      null,
    );
  });
});
