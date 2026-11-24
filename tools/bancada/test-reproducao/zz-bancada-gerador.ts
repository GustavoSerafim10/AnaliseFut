/**
 * Gerador da evidência demonstrativa. É COPIADO para <build>/apps/web/test/zz-bancada-gerador.test.ts
 * e roda com o vitest DAQUELE commit: o rascunho de exemplo, o derivar() e o montarEvidencia()
 * são os do build histórico, não os da árvore de trabalho. O relógio fica parado no instante
 * pedido (vira meta.calculadoEm.inicio), como o App faz ao calcular.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

const base = '../src/';
/** onde o MESMO especificador dos imports abaixo resolve: prova de procedência do código */
const origem = (m: string) => fileURLToPath(new URL(`${base}${m}.ts`, import.meta.url));

interface Pedido {
  idJogo: string;
  relogio: string;
  build: Record<string, unknown>;
}
type Modulo = Record<string, (...a: unknown[]) => unknown>;

it('bancada: gerar evidência com o código deste build', async () => {
  const p = JSON.parse(readFileSync(process.env.PE_BANCADA_PEDIDO as string, 'utf8')) as Pedido;
  const exemplo = (await import(/* @vite-ignore */ `${base}exemplo`)) as Modulo;
  const dados = (await import(/* @vite-ignore */ `${base}dados`)) as Modulo;
  const evid = (await import(/* @vite-ignore */ `${base}evidencias`)) as Modulo;
  vi.useFakeTimers({ now: Date.parse(p.relogio), toFake: ['Date'] });
  try {
    const r = { ...(exemplo.rascunhoExemplo() as object), idHistorico: p.idJogo };
    const inicio = new Date().toISOString();
    const d = dados.derivar(r);
    const e = (await evid.montarEvidencia(
      p.idJogo,
      r,
      d,
      { calculadoEm: { inicio, fim: inicio } },
      p.build,
      inicio,
    )) as { meta: Record<string, unknown> };
    writeFileSync(
      process.env.PE_BANCADA_SAIDA as string,
      JSON.stringify({
        evidencia: { ...e, meta: { ...e.meta, revisao: 1 } },
        origem: {
          exemplo: origem('exemplo'),
          dados: origem('dados'),
          evidencias: origem('evidencias'),
        },
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});
