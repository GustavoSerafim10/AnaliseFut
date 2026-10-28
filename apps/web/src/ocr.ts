/**
 * OCR local com Tesseract.js (português + inglês). Nada sai do aparelho além do download
 * dos dados de idioma na primeira vez. Mesmo tratamento do script `npm run ocr`
 * (calibrado com prints reais do SofaScore, SuperScore e Flashscore).
 */
import { MARCA_MEIO, MARCA_POSICOES } from '@pe/parsers';
import { createWorker, PSM, type Worker } from 'tesseract.js';

/** bloco: texto corrido (estatísticas, odds). lados: nomes com posição no campo (escalação). */
export type ModoOcr = 'bloco' | 'lados';

let worker: Promise<Worker> | null = null;
let aoProgredir: ((p: number) => void) | null = null;

function obterWorker(): Promise<Worker> {
  worker ??= createWorker(['por', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') aoProgredir?.(m.progress);
    },
  }).then(async (w) => {
    await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    return w;
  });
  return worker;
}

const cinzaDe = (px: Uint8ClampedArray, i: number) =>
  0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

interface CandidatoMeio {
  eixo: 'x' | 'y';
  pos: number;
  forca: number;
}

/**
 * Candidatas a linha do meio de campo: retas finas e claras que atravessam a imagem.
 * Horizontal = campo em pé (mandante em cima: SuperScore, SofaScore); vertical = campo
 * deitado (mandante à esquerda: Flashscore). A divisória do cabeçalho da página também é uma
 * reta assim, por isso vão as 3 mais fortes de cada eixo e o leitor escolhe a que divide os
 * nomes ao meio.
 */
function acharMeio(px: Uint8ClampedArray, W: number, H: number, d: number): CandidatoMeio[] {
  const g = (x: number, y: number) => cinzaDe(px, (y * W + x) * 4);
  const passo = Math.max(1, Math.round(d / 3));
  const picos = (eixo: 'x' | 'y', tam: number, outro: number, forcaEm: (i: number) => number) => {
    const todos: CandidatoMeio[] = [];
    for (let i = Math.round(tam * 0.15); i < tam * 0.9; i += passo)
      todos.push({ eixo, pos: i / tam, forca: forcaEm(i) / (outro / 2) });
    const escolhidos: CandidatoMeio[] = [];
    for (const c of todos.sort((a, b) => b.forca - a.forca)) {
      if (escolhidos.length === 3) break;
      if (escolhidos.every((e) => Math.abs(e.pos - c.pos) > 0.05)) escolhidos.push(c);
    }
    return escolhidos;
  };
  return [
    ...picos('y', H, W, (y) => {
      let n = 0;
      for (let x = 0; x < W; x += 2) {
        const v = g(x, y);
        if (v - g(x, y - d) > 12 && v - g(x, y + d) > 12) n++;
      }
      return n;
    }),
    ...picos('x', W, H, (x) => {
      let n = 0;
      for (let y = 0; y < H; y += 2) {
        const v = g(x, y);
        if (v - g(x - d, y) > 12 && v - g(x + d, y) > 12) n++;
      }
      return n;
    }),
  ];
}

const lanczos3 = (x: number) => {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const p = Math.PI * x;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
};

/** Pesos Lanczos-3 de cada pixel de saída (a escala é inteira: s jogos de 6 pesos). */
function pesos(s: number): { ini: number; w: number[] }[] {
  return Array.from({ length: s }, (_, r) => {
    const centro = (r + 0.5) / s - 0.5;
    const ini = Math.floor(centro) - 2;
    const w = Array.from({ length: 6 }, (_, k) => lanczos3(centro - (ini + k)));
    const soma = w.reduce((a, b) => a + b, 0);
    return { ini, w: w.map((v) => v / soma) };
  });
}

/**
 * Amplia com Lanczos-3 (o mesmo código do script `npm run ocr`). O drawImage do navegador
 * amplia quase linear e borra os números pequenos ("34" virava "MH", "1.1" virava "nu").
 */
function ampliar(src: ImageData, s: number, ctx: CanvasRenderingContext2D): ImageData {
  const { width: w, height: h, data } = src;
  const W = w * s;
  const H = h * s;
  const p = pesos(s);
  const lim = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);
  // horizontal: h linhas × W colunas × 3 canais
  const tmp = new Float32Array(h * W * 3);
  for (let y = 0; y < h; y++)
    for (let X = 0; X < W; X++) {
      const { ini, w: pw } = p[X % s];
      const base = Math.floor(X / s) + ini;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 6; k++) {
        const i = (y * w + lim(base + k, w - 1)) * 4;
        r += data[i] * pw[k];
        g += data[i + 1] * pw[k];
        b += data[i + 2] * pw[k];
      }
      const o = (y * W + X) * 3;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
    }
  // vertical
  const out = ctx.createImageData(W, H);
  const d = out.data;
  for (let Y = 0; Y < H; Y++) {
    const { ini, w: pw } = p[Y % s];
    const base = Math.floor(Y / s) + ini;
    for (let X = 0; X < W; X++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 6; k++) {
        const i = (lim(base + k, h - 1) * W + X) * 3;
        r += tmp[i] * pw[k];
        g += tmp[i + 1] * pw[k];
        b += tmp[i + 2] * pw[k];
      }
      const o = (Y * W + X) * 4;
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = 255;
    }
  }
  return out;
}

interface Preparado {
  /** a imagem em cinza (tema escuro invertido): o Tesseract binariza sozinho */
  cinza: HTMLCanvasElement;
  /** escalação: preto-e-branco pelo fundo, segunda leitura que pega o que o cinza perde */
  binario?: HTMLCanvasElement;
  meio?: ReturnType<typeof acharMeio>;
}

/**
 * Amplia com Lanczos (até 4x, ~4000 px, no máximo ~16 Mpx) e entrega em cinza, tema escuro
 * invertido. Limiar fixo deixava o OCR instável (7 a 29 valores certos em 38 conforme o corte,
 * no SofaScore real); em cinza deu 31, e a classificação e os desfalques reais seguem certos.
 * Escalação ganha uma segunda imagem preto-e-branco, pelo fundo mediano:
 * - escuro (Flashscore, SuperScore): corta em 200;
 * - médio (gramado verde do SofaScore): só pixel branco (menor canal RGB > 150) vira tinta;
 * - claro: limiar normal.
 */
async function preprocessar(arquivo: File, modo: ModoOcr = 'bloco'): Promise<Preparado> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.max(
    1,
    Math.min(
      4,
      Math.round(4000 / img.width),
      Math.floor(Math.sqrt(16e6 / (img.width * img.height))),
    ),
  );
  const origem = document.createElement('canvas');
  origem.width = img.width;
  origem.height = img.height;
  const octx = origem.getContext('2d')!;
  octx.drawImage(img, 0, 0);
  const novo = () => {
    const c = document.createElement('canvas');
    c.width = img.width * escala;
    c.height = img.height * escala;
    return c;
  };
  const cinza = novo();
  const ctx = cinza.getContext('2d')!;
  const original = octx.getImageData(0, 0, img.width, img.height);
  // a linha do meio é medida na imagem original: ampliada, a reta de 1 px fica suave demais
  const meio = modo === 'lados' ? acharMeio(original.data, img.width, img.height, 3) : undefined;
  const dados = ampliar(original, escala, ctx);
  const px = dados.data;

  let binario: HTMLCanvasElement | undefined;
  if (modo === 'lados') {
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < px.length; i += 4) hist[Math.round(cinzaDe(px, i))]++;
    let mediana = 0;
    for (let acc = 0; mediana < 255 && (acc += hist[mediana]) < px.length / 8;) mediana++;
    binario = novo();
    const bctx = binario.getContext('2d')!;
    const bin = bctx.createImageData(binario.width, binario.height);
    for (let i = 0; i < px.length; i += 4) {
      const c = cinzaDe(px, i);
      const tinta =
        mediana < 70
          ? 255 - c <= 200
          : mediana <= 170
            ? Math.min(px[i], px[i + 1], px[i + 2]) > 150
            : c <= 160;
      bin.data[i] = bin.data[i + 1] = bin.data[i + 2] = tinta ? 0 : 255;
      bin.data[i + 3] = 255;
    }
    bctx.putImageData(bin, 0, 0);
  }

  let soma = 0;
  for (let i = 0; i < px.length; i += 4) {
    const c = cinzaDe(px, i);
    px[i] = c;
    soma += c;
  }
  const inverter = soma / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4)
    px[i] = px[i + 1] = px[i + 2] = inverter ? 255 - px[i] : px[i];
  ctx.putImageData(dados, 0, 0);
  return { cinza, binario, meio };
}

export async function lerImagem(
  arquivo: File,
  progresso?: (p: number) => void,
  modo: ModoOcr = 'bloco',
): Promise<string> {
  const w = await obterWorker();
  try {
    const { cinza, binario, meio } = await preprocessar(arquivo, modo);
    if (modo === 'bloco') {
      aoProgredir = progresso ?? null;
      return (await w.recognize(cinza)).data.text;
    }
    // escalação: texto esparso (nomes espalhados pelo campo), cada linha com o seu centro
    // em milésimos da imagem; duas leituras (cinza e preto-e-branco) que o leitor junta pela
    // posição; os times se separam pela linha do meio
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const linhas = [MARCA_POSICOES];
    for (const m of meio ?? [])
      linhas.push(`${MARCA_MEIO} ${m.eixo} ${Math.round(m.pos * 1000)} ${m.forca.toFixed(2)}`);
    const imagens = [cinza, binario].filter((c): c is HTMLCanvasElement => !!c);
    for (const [n, canvas] of imagens.entries()) {
      aoProgredir = (p) => progresso?.((n + p) / imagens.length);
      const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
      for (const b of data.blocks ?? [])
        for (const p of b.paragraphs)
          for (const l of p.lines) {
            // "15 Vitor Bu. 19 Gabriel...": dois jogadores na mesma linha; o número da camisa
            // abre um trecho novo, cada um com a sua posição
            const trechos: (typeof l.words)[] = [];
            for (const wd of l.words) {
              const atual = trechos[trechos.length - 1];
              if (!atual || (/^\d/.test(wd.text) && atual.some((x) => !/^\d/.test(x.text))))
                trechos.push([wd]);
              else atual.push(wd);
            }
            for (const ws of trechos) {
              const t = ws
                .map((x) => x.text)
                .join(' ')
                .trim();
              if (!t) continue;
              const x0 = Math.min(...ws.map((x) => x.bbox.x0));
              const x1 = Math.max(...ws.map((x) => x.bbox.x1));
              const y0 = Math.min(...ws.map((x) => x.bbox.y0));
              const y1 = Math.max(...ws.map((x) => x.bbox.y1));
              const cx = Math.round(((x0 + x1) / 2 / canvas.width) * 1000);
              const cy = Math.round(((y0 + y1) / 2 / canvas.height) * 1000);
              linhas.push(`@${cx},${cy} ${t}`);
            }
          }
    }
    return linhas.join('\n');
  } finally {
    aoProgredir = null;
    if (modo !== 'bloco') await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  }
}
