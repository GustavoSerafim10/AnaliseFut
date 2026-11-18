/**
 * Backup com evidências (campo opcional "evidencias"): compatível com backups antigos, ida e volta
 * sem perda, itens estranhos contados (não escondidos) e restauração sem sobrescrever revisões.
 */
import { describe, expect, it, vi } from 'vitest';
import { derivar } from '../src/dados';
import { canonico, montarEvidencia, planejarImportacao, type Evidencia } from '../src/evidencias';
import { rascunhoExemplo } from '../src/exemplo';
import { rascunhoNovo } from '../src/estado';
import {
  exportarJson,
  importarJson,
  lerExtrasBackup,
  type EntradaHistorico,
} from '../src/historico';

const entrada = (id: string): EntradaHistorico =>
  ({
    id,
    salvoEm: '2026-11-18T15:00:00-03:00',
    rascunho: { ...rascunhoNovo(), idHistorico: id },
    resumo: {
      jogo: 'A × B',
      competicao: '',
      inicio: '',
      decisao: null,
      rotulo: '',
      dq: null,
      motivos: [],
    },
  }) as EntradaHistorico;

async function umaEvidencia(id: string): Promise<Evidencia> {
  vi.useFakeTimers({ now: new Date('2026-11-18T15:00:00Z'), toFake: ['Date'] });
  const r = rascunhoExemplo();
  const d = derivar(r);
  const ev = await montarEvidencia(id, r, d, { calculadoEm: { inicio: 'a', fim: 'b' } });
  vi.useRealTimers();
  return { ...ev, meta: { ...ev.meta, revisao: 1 } };
}

describe('backup com evidências', () => {
  it('backup antigo (sem o campo) importa igual e não traz evidências', () => {
    const antigo = JSON.stringify({ versao: 2, exportadoEm: 'x', historico: [entrada('1')] });
    const r = importarJson(antigo, []);
    expect('lista' in r && r.lista).toHaveLength(1);
    const x = lerExtrasBackup(antigo);
    expect(x.evidencias).toBeUndefined();
    expect(x.evidenciasInvalidas).toBeUndefined();
  });

  it('ida e volta: as evidências voltam idênticas e o histórico não muda por causa delas', async () => {
    const ev = await umaEvidencia('1');
    const texto = exportarJson([entrada('1')], { evidencias: [ev] });
    const x = lerExtrasBackup(texto);
    expect(x.evidencias).toHaveLength(1);
    expect(canonico(x.evidencias![0])).toBe(canonico(ev));
    const semEv = importarJson(exportarJson([entrada('1')]), []);
    const comEv = importarJson(texto, []);
    expect('lista' in comEv && JSON.stringify(comEv.lista)).toBe(
      'lista' in semEv && JSON.stringify(semEv.lista),
    );
  });

  it('item que não parece evidência é contado, não some calado', async () => {
    const ev = await umaEvidencia('1');
    const texto = exportarJson([entrada('1')], {
      evidencias: [ev, { lixo: true } as unknown as Evidencia],
    });
    const x = lerExtrasBackup(texto);
    expect(x.evidencias).toHaveLength(1);
    expect(x.evidenciasInvalidas).toBe(1);
  });

  it('restaurar em outro aparelho com revisões conflitantes preserva os dois conteúdos', async () => {
    const ev = await umaEvidencia('1');
    const daqui = { revisao: 1, hash: 'conteudo-diferente-deste-aparelho' };
    const planos = planejarImportacao(
      [daqui],
      lerExtrasBackup(exportarJson([], { evidencias: [ev] })).evidencias!,
    );
    expect(planos).toHaveLength(1);
    expect(planos[0]).toMatchObject({
      acao: 'gravar',
      evidencia: { meta: { revisao: 2, hash: ev.meta.hash, importacao: { revisaoOriginal: 1 } } },
    });
  });
});
