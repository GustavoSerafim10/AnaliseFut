import { describe, expect, it } from 'vitest';
import {
  acharEscudos,
  areasDoCabecalho,
  coresDoEscudo,
  lerCompeticao,
  lerHora,
  limparNome,
  recortarEscudo,
  type Caixa,
} from '../src';

/** Imagem 600×400 de fundo escuro com retângulos coloridos. */
function imagem(rets: { c: Caixa; cor: number[] }[]) {
  const [w, h] = [600, 400];
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = rets.find(({ c }) => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);
      data.set([...(r?.cor ?? [20, 24, 28]), 255], (y * w + x) * 4);
    }
  return { data, largura: w, altura: h };
}
const vermelho = [220, 30, 40];
const azul = [40, 140, 210];
const casa = { x0: 80, y0: 30, x1: 120, y1: 80 };
const fora = { x0: 480, y0: 30, x1: 520, y1: 80 };

describe('achar os escudos', () => {
  it('dois do mesmo tamanho, na mesma altura e separados', () => {
    const r = acharEscudos(
      imagem([
        { c: casa, cor: vermelho },
        { c: fora, cor: azul },
      ]),
    )!;
    expect(r.casa).toMatchObject(casa);
    expect(r.fora).toMatchObject(fora);
  });
  it('foto maior mais abaixo não ganha do escudo', () => {
    const r = acharEscudos(
      imagem([
        { c: casa, cor: vermelho },
        { c: fora, cor: azul },
        { c: { x0: 60, y0: 170, x1: 140, y1: 210 + 60 }, cor: [200, 200, 200] },
        { c: { x0: 460, y0: 170, x1: 540, y1: 210 + 60 }, cor: [200, 200, 200] },
      ]),
    )!;
    expect(r.casa.y0).toBe(30);
  });
  it('ícones pequenos e botão largo não contam', () => {
    expect(
      acharEscudos(
        imagem([
          { c: { x0: 20, y0: 30, x1: 36, y1: 46 }, cor: [230, 230, 230] },
          { c: { x0: 560, y0: 30, x1: 576, y1: 46 }, cor: [230, 230, 230] },
          { c: { x0: 150, y0: 120, x1: 450, y1: 150 }, cor: [110, 110, 240] },
        ]),
      ),
    ).toBeNull();
  });
  it('um escudo só: nada', () => {
    expect(acharEscudos(imagem([{ c: casa, cor: vermelho }]))).toBeNull();
  });
});

describe('recorte e cores', () => {
  const img = imagem([
    { c: { x0: 90, y0: 40, x1: 110, y1: 70 }, cor: vermelho },
    { c: casa, cor: [245, 245, 245] },
  ]);
  const r = recortarEscudo(img, casa);
  it('o fundo em volta fica transparente', () => {
    expect(r.data[3]).toBe(0);
    const meio = (Math.floor(r.altura / 2) * r.largura + Math.floor(r.largura / 2)) * 4;
    expect(r.data[meio + 3]).toBe(255);
  });
  it('fundo escuro DENTRO do escudo continua (listras pretas)', () => {
    const c = imagem([
      { c: { x0: 95, y0: 45, x1: 105, y1: 65 }, cor: [20, 24, 28] },
      { c: casa, cor: [245, 245, 245] },
    ]);
    const x = recortarEscudo(c, casa);
    const meio = (Math.floor(x.altura / 2) * x.largura + Math.floor(x.largura / 2)) * 4;
    expect(x.data[meio + 3]).toBe(255);
  });
  it('a cor forte vem antes do miolo branco', () => {
    expect(coresDoEscudo(r)).toEqual({ cor1: '#dc1e28', cor2: '#f5f5f5' });
  });
  it('escudo preto e branco: branco', () => {
    const c = recortarEscudo(imagem([{ c: casa, cor: [250, 250, 250] }]), casa);
    expect(coresDoEscudo(c)?.cor1).toBe('#fafafa');
  });
});

describe('texto do cabeçalho', () => {
  it.each([
    ['Botafogo-SP', 'Botafogo-SP'],
    ['  Vasco da Gama  ', 'Vasco da Gama'],
    ['© Milan |', 'Milan'],
    ["O'Higgins", "O'Higgins"],
    ['Ferencváros', 'Ferencváros'],
  ])('nome: %s', (lido, nome) => expect(limparNome(lido)).toBe(nome));
  it.each(['Hoje', 'Detalhes', 'D UEFA Liga Europa = ER San Siro/Giuseppe', 'ab', '', '19:30'])(
    'não é nome: %s',
    (lido) => expect(limparNome(lido)).toBeNull(),
  );
  it('hora precisa dos dois dígitos', () => {
    expect(lerHora('19:30')).toBe('19:30');
    expect(lerHora('Hoje\n14:45\n')).toBe('14:45');
    expect(lerHora('4:45')).toBeUndefined();
    expect(lerHora('05/11/2026')).toBeUndefined();
  });
  it('competição', () => {
    expect(lerCompeticao('Brasil » Brasileirão Série B, Rodada 37')).toBe('Brasileirão Série B');
    expect(lerCompeticao('Futebol » Europa » UEFA Liga Europa , Rodada 4 » AC Milan')).toBe(
      'UEFA Liga Europa',
    );
    expect(lerCompeticao('Milan 14:45 Ferencváros')).toBeUndefined();
  });
  it('áreas: embaixo e do lado de fora de cada escudo, sem sair da imagem', () => {
    const a = areasDoCabecalho(
      { casa: { x0: 10, y0: 52, x1: 40, y1: 92 }, fora: { x0: 472, y0: 49, x1: 509, y1: 90 } },
      562,
      234,
    );
    expect(a.casa[0].y0).toBe(93);
    expect(a.casa[1].x1).toBe(8);
    expect(a.casa[1].x0).toBe(0);
    expect(a.fora[1].x0).toBe(511);
    expect(a.fora[1].x1).toBe(561);
    expect(a.hora.x0).toBeGreaterThan(40);
    expect(a.hora.x1).toBeLessThan(472);
    expect(a.topo).toMatchObject({ y0: 0, y1: 48 });
  });
});
