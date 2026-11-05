import { describe, expect, it } from 'vitest';
import { juntarCopias, migrarHistorico, type Deposito } from '../src/armazem';

interface Item {
  id: string;
  salvoEm: string;
  x?: number;
}
const item = (id: string, salvoEm = '2026-11-05T10:00', x?: number): Item => ({ id, salvoEm, x });

function deposito(inicial?: Item[], m: { falhaGravar?: boolean; corrompe?: boolean } = {}) {
  let dados = inicial;
  const d: Deposito<Item> = {
    ler: async () => dados,
    gravar: async (l) => {
      if (m.falhaGravar) throw new Error('sem espaço');
      dados = m.corrompe ? l.slice(1) : l;
    },
  };
  return { d, dados: () => dados };
}
function copia(texto: string | null) {
  let t = texto;
  return { ler: () => t, apagar: () => (t = null), atual: () => t };
}

describe('migração do histórico', () => {
  it('copia para o banco e só então apaga a cópia antiga', async () => {
    const dep = deposito();
    const c = copia(JSON.stringify([item('a'), item('b')]));
    expect((await migrarHistorico(dep.d, c)).map((e) => e.id)).toEqual(['a', 'b']);
    expect(dep.dados()).toHaveLength(2);
    expect(c.atual()).toBeNull();
  });
  it('banco falhou ao gravar: a cópia antiga fica', async () => {
    const c = copia(JSON.stringify([item('a')]));
    await expect(
      migrarHistorico(deposito(undefined, { falhaGravar: true }).d, c),
    ).rejects.toThrow();
    expect(c.atual()).not.toBeNull();
  });
  it('banco devolveu diferente do gravado: a cópia antiga fica', async () => {
    const c = copia(JSON.stringify([item('a'), item('b')]));
    await expect(migrarHistorico(deposito(undefined, { corrompe: true }).d, c)).rejects.toThrow(
      /não devolveu/,
    );
    expect(c.atual()).not.toBeNull();
  });
  it('já migrado, sem cópia antiga: lê do banco', async () => {
    expect(await migrarHistorico(deposito([item('a')]).d, copia(null))).toEqual([item('a')]);
  });
  it('cópia antiga ilegível: fica guardada e o banco segue valendo', async () => {
    const c = copia('{quebrado');
    expect(await migrarHistorico(deposito([item('a')]).d, c)).toEqual([item('a')]);
    expect(c.atual()).toBe('{quebrado');
  });
  it('sem nada em lugar nenhum: lista vazia', async () => {
    expect(await migrarHistorico(deposito().d, copia(null))).toEqual([]);
  });
});

describe('juntar as duas cópias', () => {
  it('não perde item de nenhum lado', () => {
    expect(juntarCopias([item('a')], [item('b')]).map((e) => e.id)).toEqual(['a', 'b']);
  });
  it('mesmo id: vale a versão salva por último', () => {
    const banco = [item('a', '2026-11-05T10:00', 1)];
    expect(juntarCopias(banco, [item('a', '2026-11-05T11:00', 2)])[0].x).toBe(2);
    expect(juntarCopias(banco, [item('a', '2026-11-05T09:00', 3)])[0].x).toBe(1);
  });
});
