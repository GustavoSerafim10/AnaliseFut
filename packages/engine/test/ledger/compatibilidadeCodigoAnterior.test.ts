/**
 * Compatibilidade com cadeias produzidas pelo CÓDIGO ANTERIOR (commit 6c8c7cd, antes da Etapa 0 e da
 * V2). O fixture `fixtures/cadeias-6c8c7cd.json` foi gerado por esse código e NÃO deve ser regerado
 * com o código atual: ele é a prova de que registros antigos continuam sendo lidos.
 *
 * Semântica das referências `decisao` no esquema 1 (documentada no LEDGER.md): o código anterior só
 * conferia a FORMA da referência. A verificação atual também a cruza com a cadeia. Registros com
 * `decisao: null` ou com a referência real continuam íntegros; os que apontavam para um hash inventado,
 * para o tipo errado ou para um seq que não é anterior passam a ser acusados. O formato do registro e o
 * hash não mudaram.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hashDoRegistro, verificarCadeia, type RegistroLedger } from '../../src/ledger';

interface CadeiaDoFixture {
  descricao: string;
  esperado: { estado: string; codigos: string[] };
  registros: RegistroLedger[];
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/cadeias-6c8c7cd.json', import.meta.url), 'utf8'),
) as { geradoPor: string; cadeias: Record<string, CadeiaDoFixture> };

const cadeias = Object.entries(fixture.cadeias);
const ordenado = (x: string[]) => [...x].sort();

describe('fixture produzido por 6c8c7cd', () => {
  it('foi gerado pelo código anterior e tem as cinco cadeias', () => {
    expect(fixture.geradoPor).toMatch(/6c8c7cd/);
    expect(cadeias.map(([n]) => n)).toEqual([
      'cincoTiposComReferenciaReal',
      'decisaoNula',
      'referenciaArbitraria',
      'referenciaParaOTipoErrado',
      'referenciaNaoAnterior',
    ]);
  });

  it('todos os registros são do esquema 1 e os hashes recalculados pelo código atual são os gravados', async () => {
    for (const [nome, c] of cadeias)
      for (const r of c.registros) {
        expect(r.cabecalho.esquema, nome).toBe(1);
        expect(await hashDoRegistro(r.cabecalho, r.corpo), `${nome} #${r.cabecalho.seq}`).toBe(
          r.hash,
        );
      }
  });
});

describe('verificação atual (V2) de cadeias criadas pelo código anterior', () => {
  for (const [nome, c] of cadeias)
    it(`${nome}: ${c.descricao}`, async () => {
      const rel = await verificarCadeia(c.registros);
      expect(rel.estado).toBe(c.esperado.estado);
      expect(ordenado(rel.problemas.map((p) => p.codigo))).toEqual(ordenado(c.esperado.codigos));
    });

  it('o verificador da etapa anterior ao esquema 2 (V1, [1]) conclui o mesmo, cadeia a cadeia', async () => {
    for (const [nome, c] of cadeias) {
      const v2 = await verificarCadeia(c.registros);
      const v1 = await verificarCadeia(c.registros, { esquemasSuportados: [1] });
      expect(v1.estado, nome).toBe(v2.estado);
      expect(
        v1.problemas.map((p) => p.codigo),
        nome,
      ).toEqual(v2.problemas.map((p) => p.codigo));
      expect(v1.hashPonta).toBe(v2.hashPonta);
    }
  });

  it('as duas cadeias sem referência inventada continuam INTEGRAS (a compatibilidade que importa)', async () => {
    for (const nome of ['cincoTiposComReferenciaReal', 'decisaoNula']) {
      const rel = await verificarCadeia(fixture.cadeias[nome].registros);
      expect(rel.problemas, nome).toEqual([]);
      expect(rel.estado, nome).toBe('integra');
    }
  });

  it('as acusadas são só as que o código anterior aceitava por conferir apenas a forma (não por hash ou formato)', async () => {
    for (const nome of [
      'referenciaArbitraria',
      'referenciaParaOTipoErrado',
      'referenciaNaoAnterior',
    ]) {
      const rel = await verificarCadeia(fixture.cadeias[nome].registros);
      expect(rel.estado, nome).toBe('adulterada');
      // nenhuma delas é acusada por hash, encadeamento ou formato: só pela referência decisao
      expect(
        rel.problemas.every((p) => p.codigo.startsWith('decisao_')),
        `${nome}: ${rel.problemas.map((p) => p.codigo).join(',')}`,
      ).toBe(true);
    }
  });
});
