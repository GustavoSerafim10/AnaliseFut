/**
 * Gerador de ENTRADAS DO HISTÓRICO para a suíte real da F1.2b. É COPIADO para
 * <build>/apps/web/test/zz-bancada-gerador-historico.test.ts e roda com o vitest DAQUELE commit:
 * rascunhoExemplo → derivar → salvarNoHistorico do build, com o relógio parado (salvoEm sai
 * exatamente como o site grava). Registra também de onde os módulos resolveram.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';

const base = '../src/';
const origem = (m: string) => fileURLToPath(new URL(`${base}${m}.ts`, import.meta.url));

type Modulo = Record<string, (...a: unknown[]) => unknown>;

it('bancada: gerar entradas do histórico com o código deste build', async () => {
  const p = JSON.parse(readFileSync(process.env.PE_BANCADA_PEDIDO as string, 'utf8')) as {
    ids: string[];
    relogio: string;
  };
  const exemplo = (await import(/* @vite-ignore */ `${base}exemplo`)) as Modulo;
  const dados = (await import(/* @vite-ignore */ `${base}dados`)) as Modulo;
  const hist = (await import(/* @vite-ignore */ `${base}historico`)) as Modulo;
  vi.useFakeTimers({ now: Date.parse(p.relogio), toFake: ['Date'] });
  try {
    const entradas = p.ids.map((id) => {
      const r = { ...(exemplo.rascunhoExemplo() as object), idHistorico: id };
      const salvo = hist.salvarNoHistorico([], r, dados.derivar(r), undefined, Date.now()) as {
        lista: unknown[];
      };
      return salvo.lista[0];
    });
    writeFileSync(
      process.env.PE_BANCADA_SAIDA as string,
      JSON.stringify({
        entradas,
        origem: {
          exemplo: origem('exemplo'),
          dados: origem('dados'),
          historico: origem('historico'),
        },
      }),
    );
  } finally {
    vi.useRealTimers();
  }
});
