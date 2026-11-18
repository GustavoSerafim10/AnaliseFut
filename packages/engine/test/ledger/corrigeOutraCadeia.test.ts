/**
 * `referencia_outra_cadeia` sobre `corrige` (decisão de arquitetura: a regra é MANTIDA para `corrige`).
 *
 * Quatro cenários, verificados em `verificarCadeia` (cadeia isolada) e em `verificarLedger` (cadeias
 * juntas). A regra só age em `verificarLedger` e só quando o hash apontado pertence a uma cadeia que
 * está no conjunto verificado. Ela NÃO reclassifica nada que um produtor correto gere: um `corrige`
 * legítimo sempre carrega o hash de um registro da PRÓPRIA cadeia, esteja ele presente ou não.
 *
 * Os resultados de `6c8c7cd` (antes da regra) estão no comentário de cada cenário, medidos com o
 * código daquele commit.
 */
import { describe, expect, it } from 'vitest';
import {
  criarRegistro,
  verificarCadeia,
  verificarLedger,
  type RegistroLedger,
} from '../../src/ledger';
import { codigos, T } from './apoioEsquema2';

const resultado = (n: number) => ({
  decisao: null,
  resultado: { casa: n, fora: 0, registradoEm: T(n) },
});
const CORRECAO = { motivo: 'placar digitado errado', novo: { casa: 9, fora: 0 } };

async function cadeia(
  id: string,
  passos: ('resultado' | { corrige: (l: RegistroLedger[]) => { seq: number; hash: string } })[],
): Promise<RegistroLedger[]> {
  const lista: RegistroLedger[] = [];
  for (const p of passos) {
    const n = lista.length + 1;
    lista.push(
      p === 'resultado'
        ? await criarRegistro(
            {
              tipo: 'resultado',
              cadeia: id,
              criadoEm: T(n),
              corpo: resultado(n),
              versaoMotor: 'teste',
              politicas: { x: 1 },
            },
            lista.at(-1) ?? null,
          )
        : await criarRegistro(
            {
              tipo: 'correcao',
              cadeia: id,
              criadoEm: T(n),
              corpo: CORRECAO,
              corrige: p.corrige(lista),
              versaoMotor: 'teste',
              politicas: { x: 1 },
            },
            lista.at(-1) ?? null,
          ),
    );
  }
  return lista;
}

const cadeiaDe = (rel: Awaited<ReturnType<typeof verificarLedger>>, id: string) =>
  rel.cadeias.find((c) => c.cadeia === id)!;
const unicos = (rel: { problemas: { codigo: string }[] }) => [...new Set(codigos(rel))].sort();

describe('corrige e referencia_outra_cadeia: os quatro cenários', () => {
  it('1. corrige LEGÍTIMO (mesma cadeia, hash certo): íntegra nas duas verificações, sem alteração', async () => {
    const b = await cadeia('B', ['resultado', 'resultado']);
    const a = await cadeia('A', ['resultado', { corrige: (l) => ({ seq: 1, hash: l[0].hash }) }]);
    // 6c8c7cd: integra / integra
    expect(unicos(await verificarCadeia(a))).toEqual([]);
    expect((await verificarCadeia(a)).estado).toBe('integra');
    const led = cadeiaDe(await verificarLedger([...a, ...b]), 'A');
    expect(led.estado).toBe('integra');
    expect(codigos(led)).toEqual([]);
  });

  it('2. seq existe em A, hash é de um registro de B: adulterada nas duas; o ledger acrescenta o código', async () => {
    const b = await cadeia('B', ['resultado', 'resultado']);
    const a = await cadeia('A', ['resultado', { corrige: () => ({ seq: 1, hash: b[0].hash }) }]);
    // 6c8c7cd: verificarCadeia adulterada[correcao_hash_diverge]; verificarLedger igual (sem o código novo)
    const so = await verificarCadeia(a);
    expect(so.estado).toBe('adulterada');
    expect(unicos(so)).toEqual(['correcao_hash_diverge']);
    const led = cadeiaDe(await verificarLedger([...a, ...b]), 'A');
    expect(led.estado).toBe('adulterada');
    expect(unicos(led)).toEqual(['correcao_hash_diverge', 'referencia_outra_cadeia']);
  });

  it('3. hash de B e seq AUSENTE em A (cópia parcial): incompleta isolada, ADULTERADA junto de B', async () => {
    const b = await cadeia('B', ['resultado', 'resultado']);
    const completa = await cadeia('A', [
      'resultado',
      'resultado',
      { corrige: () => ({ seq: 2, hash: b[1].hash }) },
    ]);
    const parcial = [completa[0], completa[2]]; // falta o seq 2
    // 6c8c7cd: verificarCadeia incompleta; verificarLedger(A+B) incompleta (a regra não existia)
    const so = await verificarCadeia(parcial);
    expect(so.estado).toBe('incompleta');
    expect(unicos(so)).toEqual(['correcao_referencia_ausente', 'lacuna_de_seq']);
    const led = cadeiaDe(await verificarLedger([...parcial, ...b]), 'A');
    expect(led.estado).toBe('adulterada'); // RECLASSIFICAÇÃO documentada: só em verificarLedger
    expect(unicos(led)).toEqual([
      'correcao_referencia_ausente',
      'lacuna_de_seq',
      'referencia_outra_cadeia',
    ]);
  });

  it('3b. a mesma cópia parcial SEM a cadeia B no conjunto: continua incompleta (a regra depende do conjunto)', async () => {
    const b = await cadeia('B', ['resultado', 'resultado']);
    const completa = await cadeia('A', [
      'resultado',
      'resultado',
      { corrige: () => ({ seq: 2, hash: b[1].hash }) },
    ]);
    const led = cadeiaDe(await verificarLedger([completa[0], completa[2]]), 'A');
    expect(led.estado).toBe('incompleta');
    expect(codigos(led)).not.toContain('referencia_outra_cadeia');
  });

  it('4. cópia parcial LEGÍTIMA (hash da própria cadeia, seq ausente): continua INCOMPLETA, com ou sem B', async () => {
    const b = await cadeia('B', ['resultado', 'resultado']);
    const completa = await cadeia('A', [
      'resultado',
      'resultado',
      { corrige: (l) => ({ seq: 2, hash: l[1].hash }) },
    ]);
    const parcial = [completa[0], completa[2]]; // falta o seq 2, que a correção aponta
    // 6c8c7cd: incompleta / incompleta
    const so = await verificarCadeia(parcial);
    expect(so.estado).toBe('incompleta');
    expect(unicos(so)).toEqual(['correcao_referencia_ausente', 'lacuna_de_seq']);
    for (const conjunto of [parcial, [...parcial, ...b]]) {
      const led = cadeiaDe(await verificarLedger(conjunto), 'A');
      expect(led.estado).toBe('incompleta');
      expect(unicos(led)).toEqual(['correcao_referencia_ausente', 'lacuna_de_seq']);
    }
  });

  it('a cadeia completa correspondente à cópia parcial legítima é íntegra', async () => {
    const completa = await cadeia('A', [
      'resultado',
      'resultado',
      { corrige: (l) => ({ seq: 2, hash: l[1].hash }) },
    ]);
    expect((await verificarCadeia(completa)).estado).toBe('integra');
  });
});
