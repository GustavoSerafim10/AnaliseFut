/**
 * Renderização do formulário de resultado: o estado inicial vem do resultado salvo (ou da leitura do
 * print), então um valor inválido já aparece com a mensagem, a borda de dúvida e o botão Salvar
 * desabilitado. Sem interação: renderToString, como as demais telas de fumaça.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ResultadoLido } from '@pe/parsers';
import { FormResultado } from '../src/abas/AbaHistorico';
import type { EntradaHistorico, ResultadoJogo } from '../src/historico';

const REGISTRADO = '2026-11-13T15:00:00-03:00';

const entrada = (resultado?: Partial<ResultadoJogo>): EntradaHistorico =>
  ({
    id: 'x',
    salvoEm: REGISTRADO,
    rascunho: {} as never,
    resumo: { jogo: 'Flamengo × Vasco' } as never,
    resultado: resultado
      ? ({ casa: 2, fora: 1, registradoEm: REGISTRADO, ...resultado } as ResultadoJogo)
      : undefined,
  }) as EntradaHistorico;

/** o React separa textos vizinhos com `<!-- -->`; tirá-los deixa "Gols: ..." contíguo para comparar */
const render = (resultado?: Partial<ResultadoJogo>, lido?: ResultadoLido) =>
  renderToString(
    createElement(FormResultado, { e: entrada(resultado), lido, onSalvar: () => {} }),
  ).replace(/<!-- -->/g, '');

/** o botão Salvar (classe "primario") está desabilitado? */
const salvarDesabilitado = (html: string) => /<button class="primario"[^>]*\sdisabled/.test(html);
const temErro = (html: string) => html.includes('role="alert"');

describe('FormResultado: placar válido', () => {
  it('placar inteiro: sem erro e com o botão Salvar habilitado', () => {
    const html = render({ casa: 2, fora: 1 });
    expect(temErro(html)).toBe(false);
    expect(salvarDesabilitado(html)).toBe(false);
  });

  it('0 x 0 e placares de dois dígitos', () => {
    for (const [casa, fora] of [
      [0, 0],
      [10, 12],
    ]) {
      const html = render({ casa, fora });
      expect(temErro(html)).toBe(false);
      expect(salvarDesabilitado(html)).toBe(false);
    }
  });

  it('com intervalo, escanteios e amarelos inteiros', () => {
    const html = render({
      casa: 3,
      fora: 1,
      intervalo: { casa: 1, fora: 0 },
      escanteios: { casa: 7, fora: 4 },
      cartoes: { casa: 2, fora: 3 },
    });
    expect(temErro(html)).toBe(false);
    expect(salvarDesabilitado(html)).toBe(false);
  });
});

describe('FormResultado: placar inválido bloqueia o Salvar e explica', () => {
  for (const [nome, resultado] of [
    ['decimal na casa', { casa: 1.5, fora: 0 }],
    ['decimal no visitante', { casa: 1, fora: 0.5 }],
    ['negativo na casa', { casa: -1, fora: 0 }],
    ['negativo no visitante', { casa: 2, fora: -3 }],
  ] as const)
    it(nome, () => {
      const html = render(resultado);
      expect(temErro(html)).toBe(true);
      expect(html).toContain('Gols:');
      expect(html).toMatch(/inteiro/);
      expect(salvarDesabilitado(html)).toBe(true);
      expect(html).toContain('celula-duvida'); // o campo ruim fica marcado
    });

  it('um lado só do intervalo: "preencha os dois lados"', () => {
    const html = render({ casa: 2, fora: 1, intervalo: { casa: 1 } as never });
    expect(html).toContain('Intervalo:');
    expect(html).toContain('preencha os dois lados');
    expect(salvarDesabilitado(html)).toBe(true);
  });

  for (const campo of ['intervalo', 'escanteios', 'cartoes'] as const)
    it(`${campo} com decimal ou negativo`, () => {
      for (const par of [
        { casa: 1.5, fora: 0 },
        { casa: 1, fora: -1 },
      ]) {
        const html = render({ casa: 2, fora: 1, [campo]: par });
        expect(temErro(html)).toBe(true);
        expect(salvarDesabilitado(html)).toBe(true);
      }
    });
});

describe('FormResultado: odds de fechamento', () => {
  it('fechamento e outros lados válidos (maiores que 1)', () => {
    const html = render({ casa: 2, fora: 1, oddFechamento: 1.85, fechamentoOutros: [3.4, 5.2] });
    expect(temErro(html)).toBe(false);
    expect(salvarDesabilitado(html)).toBe(false);
  });

  for (const odd of [1, 0.5, 0, -2])
    it(`oddFechamento = ${odd} é recusada`, () => {
      const html = render({ casa: 2, fora: 1, oddFechamento: odd });
      expect(html).toContain('Fechamento:');
      expect(salvarDesabilitado(html)).toBe(true);
    });

  for (const outros of [[1], [3.4, 1], [0.9], [-3]])
    it(`fechamentoOutros = ${JSON.stringify(outros)} é recusado (antes era descartado em silêncio)`, () => {
      const html = render({ casa: 2, fora: 1, fechamentoOutros: outros });
      expect(html).toContain('Outros lados:');
      expect(salvarDesabilitado(html)).toBe(true);
    });

  it('só o fechamento, sem placar (NaN no app): habilita o Salvar e não inventa placar', () => {
    const html = render({ casa: Number.NaN, fora: Number.NaN, oddFechamento: 1.85 });
    expect(temErro(html)).toBe(false);
    expect(salvarDesabilitado(html)).toBe(false);
  });

  it('sem placar e sem fechamento: Salvar desabilitado, sem erro (só falta preencher)', () => {
    const html = render({ casa: Number.NaN, fora: Number.NaN });
    expect(temErro(html)).toBe(false);
    expect(salvarDesabilitado(html)).toBe(true);
  });

  it('fechamento inválido e placar válido: bloqueia', () => {
    const html = render({ casa: 2, fora: 1, oddFechamento: 1 });
    expect(salvarDesabilitado(html)).toBe(true);
  });
});

describe('FormResultado: leitura do print (OCR)', () => {
  it('placar lido do print, inteiro: pré-preenche e habilita', () => {
    const html = render(undefined, { placar: { casa: 2, fora: 1 }, faltando: [] });
    expect(temErro(html)).toBe(false);
    expect(salvarDesabilitado(html)).toBe(false);
  });

  it('print sem placar e sem fechamento: Salvar desabilitado', () => {
    const html = render(undefined, { faltando: ['placar'] });
    expect(salvarDesabilitado(html)).toBe(true);
  });
});
