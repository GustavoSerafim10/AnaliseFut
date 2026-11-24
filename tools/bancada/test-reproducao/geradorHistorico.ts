/**
 * Apoio da suíte real da F1.2b: roda o gerador de entradas do histórico DENTRO do build
 * histórico isolado (código daquele commit) e devolve as entradas e a procedência dos módulos.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntradaHistorico } from '../../../apps/web/src/historico';
import type { BuildPreparado } from '../src/reproducao/build';
import { FUSO_ESPERADO, LOCALIDADE_ESPERADA } from '../src/reproducao/contrato';
import { ambienteFilho, executarProcesso } from '../src/reproducao/processo';

const GERADOR = fileURLToPath(new URL('./zz-bancada-gerador-historico.ts', import.meta.url));
export const ARQUIVO_GERADOR_HISTORICO = 'apps/web/test/zz-bancada-gerador-historico.test.ts';

export async function gerarEntradasNoBuild(
  b: BuildPreparado,
  pedido: { ids: string[]; relogio: string },
  pasta: string,
): Promise<{ entradas: EntradaHistorico[]; origem: Record<string, string> }> {
  mkdirSync(pasta, { recursive: true });
  const arqPedido = join(pasta, 'pedido-historico.json');
  const saida = join(pasta, 'entradas.json');
  writeFileSync(arqPedido, JSON.stringify(pedido));
  copyFileSync(GERADOR, join(b.fonte, ARQUIVO_GERADOR_HISTORICO));
  const r = await executarProcesso(
    process.execPath,
    [
      join(b.fonte, 'node_modules', 'vitest', 'vitest.mjs'),
      'run',
      ARQUIVO_GERADOR_HISTORICO,
      '--reporter=dot',
    ],
    {
      cwd: b.fonte,
      tempoLimiteMs: 120_000,
      env: ambienteFilho({
        TZ: FUSO_ESPERADO,
        LANG: `${LOCALIDADE_ESPERADA.replace('-', '_')}.UTF-8`,
        LC_ALL: `${LOCALIDADE_ESPERADA.replace('-', '_')}.UTF-8`,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        PE_BANCADA_PEDIDO: arqPedido,
        PE_BANCADA_SAIDA: saida,
      }),
    },
  );
  if (!existsSync(saida))
    throw new Error(
      `o gerador de histórico não gravou (código ${String(r.codigo)}, tempo esgotado: ${r.tempoEsgotado})\n${r.erro.slice(-3000)}`,
    );
  return JSON.parse(readFileSync(saida, 'utf8')) as {
    entradas: EntradaHistorico[];
    origem: Record<string, string>;
  };
}
