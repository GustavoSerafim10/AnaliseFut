import { chaveSelecao, type LinhaOdd } from '@pe/engine';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { juntarLinhas, lerOddsCasa, lerOddsCasaConsenso } from '../src';

const ctx = {
  jogo: { casa: 'Toulouse', fora: 'Strasbourg' },
  casa: 'CasaDeApostas',
  data: '2026-11-06',
};
const mapa = (r: ReturnType<typeof lerOddsCasa>) =>
  new Map(juntarLinhas(r.linhas).linhas.map((l) => [chaveSelecao(l as LinhaOdd), l.odd]));
// OCR real dos prints a 100% (odds conferidas) e dos mesmos prints reduzidos a 75%
const verdade = mapa(
  lerOddsCasa(
    readFileSync(new URL('./fixtures-reais/casadeapostas-toulouse.txt', import.meta.url), 'utf8')
      .split(/^===== .* =====$/m)
      .filter((t) => t.trim()),
    ctx,
  ),
);
const prints: { texto: string; releituras: string[] }[] = JSON.parse(
  readFileSync(
    new URL('./fixtures-reais/casadeapostas-toulouse-releituras-75.json', import.meta.url),
    'utf8',
  ),
);
const nota = (lido: Map<string, number>) => {
  let certas = 0;
  let erradas = 0;
  for (const [k, v] of lido)
    if (verdade.get(k) === v) certas++;
    else erradas++;
  return { certas, erradas };
};

describe('votação entre leituras das odds', () => {
  it('prints reais a 75%: a votação acha mais odds e tira as erradas', () => {
    const uma = nota(
      mapa(
        lerOddsCasa(
          prints.map((p) => p.texto),
          ctx,
        ),
      ),
    );
    const votada = nota(mapa(lerOddsCasaConsenso(prints, ctx)));
    expect(uma.erradas).toBeGreaterThan(0);
    expect(votada.erradas).toBe(0);
    expect(votada.certas).toBeGreaterThan(uma.certas);
    expect(votada.certas).toBeGreaterThanOrEqual(verdade.size - 1);
  });

  const texto = (over: string) => `Total\nMais de 2.5 ${over}\nMenos de 2.5 2.10`;
  const over = (r: ReturnType<typeof lerOddsCasa>) => r.linhas.find((l) => l.lado === 'over')?.odd;
  it('sem releituras, é a leitura de sempre', () => {
    const p = [{ texto: texto('1.75') }];
    expect(over(lerOddsCasaConsenso(p, ctx))).toBe(1.75);
    expect(lerOddsCasaConsenso(p, ctx)).toEqual(lerOddsCasa([p[0].texto], ctx));
  });
  it('dois contra um: ganha a odd com mais votos', () => {
    const p = [{ texto: texto('1.15'), releituras: [texto('1.75'), texto('1.75')] }];
    expect(over(lerOddsCasaConsenso(p, ctx))).toBe(1.75);
  });
  it('odd que só uma releitura viu não entra; com duas concordando, entra', () => {
    const vazio = 'Total';
    expect(
      lerOddsCasaConsenso([{ texto: vazio, releituras: [texto('1.75'), vazio] }], ctx).linhas,
    ).toEqual([]);
    expect(
      over(
        lerOddsCasaConsenso([{ texto: vazio, releituras: [texto('1.75'), texto('1.75')] }], ctx),
      ),
    ).toBe(1.75);
  });
});
