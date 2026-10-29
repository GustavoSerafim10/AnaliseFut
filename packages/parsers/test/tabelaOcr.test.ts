import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lerClassificacao, lerTabelaOcr, type CaixaOcr, type LinhaOcr } from '../src';

const fx = (nome: string) =>
  readFileSync(new URL(`./fixtures-reais/${nome}`, import.meta.url), 'utf8');

// Saída de `npm run ocr -- --tabela` no print real do SofaScore (Brasileirão, 29/10/2026)
describe('classificação lida em colunas (SofaScore real)', () => {
  const { linhas, avisos } = lerClassificacao(fx('sofascore-classificacao-tabela.txt'), {
    casa: 'Atlético-MG',
    fora: 'Cruzeiro',
  });
  const time = (n: string) => linhas.find((l) => l.time.includes(n))!;

  it('20 de 20 com J, V, E, D, gols, saldo e pontos, e as contas fecham', () => {
    expect(linhas.map((l) => l.pontos)).toEqual([
      70, 70, 54, 54, 54, 53, 50, 47, 44, 43, 39, 39, 38, 38, 37, 35, 34, 33, 29, 21,
    ]);
    expect(linhas.map((l) => l.jogos)).toEqual([
      32, 33, 32, 32, 33, 33, 32, 33, 33, 33, 33, 32, 31, 32, 32, 33, 32, 32, 33, 32,
    ]);
    for (const l of linhas) {
      expect(l.jogos).toBe(l.vitorias! + l.empates! + l.derrotas!);
      expect(l.pontos).toBe(3 * l.vitorias! + l.empates!);
      expect(l.saldo).toBe(l.golsPro! - l.golsContra!);
      expect(l.conferir).toEqual([]);
    }
  });
  it('o que o OCR perdeu sai da conta e fica marcado', () => {
    expect(time('Flamengo')).toMatchObject({ derrotas: 4, calculados: ['derrotas'] });
    expect(time('Bragantino')).toMatchObject({ pontos: 44, calculados: ['pontos'] });
    expect(time('Chapecoense')).toMatchObject({ vitorias: 4, saldo: -34 });
    expect([...time('Chapecoense').calculados].sort()).toEqual(['saldo', 'vitorias']);
    // "5146" sem os dois-pontos: o saldo +5 diz onde partir
    expect(time('Cruzeiro')).toMatchObject({ golsPro: 51, golsContra: 46, calculados: [] });
  });
  it('times do jogo e os últimos 5 pela cor dos selos', () => {
    expect(linhas.find((l) => l.doJogo === 'casa')).toMatchObject({
      posicao: 7,
      time: 'Atlético-MG',
      forma: ['V', 'E', 'V', 'V', 'D'],
    });
    expect(linhas.find((l) => l.doJogo === 'fora')).toMatchObject({
      posicao: 3,
      forma: ['V', 'V', 'D', 'V', 'V'],
    });
    expect(time('Santos').forma).toEqual(['E', 'D', 'V', 'E', 'E']);
    expect(avisos).toEqual([]);
  });
  it('zonas pela faixa colorida (sem zona do 12º ao 16º)', () => {
    expect(linhas.map((l) => l.zona?.nome ?? '-')).toEqual([
      ...Array<string>(4).fill('Libertadores'),
      'Pré-Libertadores',
      ...Array<string>(6).fill('Sul-Americana'),
      ...Array<string>(5).fill('-'),
      ...Array<string>(4).fill('Rebaixamento'),
    ]);
    expect(time('Grêmio').zona?.cor).toBe('#ef5158');
  });
});

describe('leitura em colunas (imagem sintética, cabeçalho em português)', () => {
  const largura = 400;
  const altura = 120;
  const data = new Uint8ClampedArray(largura * altura * 4);
  const pintar = (x0: number, y0: number, x1: number, y1: number, cor: number[]) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) data.set([...cor, 255], (y * largura + x) * 4);
  };
  pintar(0, 0, largura, altura, [23, 28, 31]);
  pintar(3, 40, 5, 61, [59, 181, 82]); // faixa da zona só na 1ª linha
  const cor: Record<string, number[]> = {
    V: [57, 181, 122],
    E: [164, 169, 179],
    D: [227, 92, 71],
  };
  const selos = (forma: string, y: number) =>
    [...forma].forEach((f, i) => {
      pintar(250 + i * 23, y, 272 + i * 23, y + 18, cor[f]);
      pintar(258 + i * 23, y + 5, 264 + i * 23, y + 13, [255, 255, 255]); // a letra
    });
  selos('VVEDV', 41);
  selos('DDEVV', 71);

  const palavra = (texto: string, x0: number, y0: number) => ({
    texto,
    x0,
    x1: x0 + 6 * texto.length,
    y0,
    y1: y0 + 20,
  });
  const linha = (y0: number, ...ps: [string, number][]): LinhaOcr => ({
    texto: ps.map(([t]) => t).join(' '),
    x0: 0,
    x1: largura,
    y0,
    y1: y0 + 20,
    palavras: ps.map(([t, x]) => palavra(t, x, y0)),
  });
  const pagina = [
    linha(
      5,
      ['#', 10],
      ['Time', 30],
      ['J', 120],
      ['V', 145],
      ['E', 170],
      ['D', 195],
      ['Últimos', 250],
      ['Pts', 375],
    ),
    // o "21" lido como "wv" na página inteira: a releitura da coluna corrige
    linha(
      40,
      ['1', 10],
      ['Flamengo', 30],
      ['32', 118],
      ['wv', 143],
      ['7', 170],
      ['4', 195],
      ['70', 375],
    ),
    linha(
      70,
      ['2', 10],
      ['Palmeiras', 30],
      ['33', 118],
      ['20', 143],
      ['10', 168],
      ['3', 195],
      ['70', 375],
    ),
  ];
  const porColuna: [number, string[]][] = [
    [123, ['32', '33']],
    [148, ['21', '20']],
    [173, ['7', '10']],
    [198, ['4', '3']],
    [384, ['70', '70']],
  ];
  const reconhecer = async (caixa?: CaixaOcr, soNumeros?: boolean): Promise<LinhaOcr[]> => {
    if (!caixa) return pagina;
    expect(soNumeros).toBe(true);
    const [, vs] = porColuna.find(([x]) => x >= caixa.x0 && x <= caixa.x1) ?? [0, []];
    return vs.map((v, i) => linha(40 + 30 * i, [v, caixa.x0 + 2]));
  };

  it('sai a linha lida + colunas, últimos jogos e zona', async () => {
    const texto = await lerTabelaOcr(reconhecer, { data, largura, altura });
    expect(texto.split('\n')).toEqual([
      '# Time J V E D Últimos Pts ‖ Colunas J V E D Pts',
      '1 Flamengo 32 wv 7 4 70 ‖ J 32 · V 21 · E 7 · D 4 · Pts 70 · Forma VVEDV · Zona #3bb552',
      '2 Palmeiras 33 20 10 3 70 ‖ J 33 · V 20 · E 10 · D 3 · Pts 70 · Forma DDEVV',
    ]);
    const { linhas } = lerClassificacao(texto, { casa: 'Flamengo', fora: 'Palmeiras' });
    expect(linhas[0]).toMatchObject({
      vitorias: 21,
      derrotas: 4,
      forma: ['V', 'V', 'E', 'D', 'V'],
    });
    expect(linhas[0].zona).toEqual({ nome: '', cor: '#3bb552' });
    expect(linhas[1].zona).toBeUndefined();
  });
  it('sem cabeçalho de tabela: devolve o texto corrido', async () => {
    const texto = await lerTabelaOcr(async () => pagina.slice(1), { data, largura, altura });
    expect(texto).toBe('1 Flamengo 32 wv 7 4 70\n2 Palmeiras 33 20 10 3 70');
  });
});
