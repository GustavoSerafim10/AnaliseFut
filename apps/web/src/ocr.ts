/**
 * OCR local com Tesseract.js (português + inglês). Nada sai do aparelho além do download
 * dos dados de idioma na primeira vez. Mesmo tratamento do script `npm run ocr`
 * (calibrado com prints reais do SofaScore/SuperScore).
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

/**
 * Linha do meio de campo: a reta fina e clara que atravessa o gramado. Horizontal = campo em
 * pé (mandante em cima: SuperScore, SofaScore); vertical = campo deitado (mandante à esquerda:
 * Flashscore). Calibrado com prints reais: força 0,89 × 0,13 e 0,86 × 0,60.
 */
function acharMeio(px: Uint8ClampedArray, W: number, H: number, d: number) {
  const g = (x: number, y: number) => cinzaDe(px, (y * W + x) * 4);
  const passo = Math.max(1, Math.round(d / 3));
  let melhorY = { pos: 0.5, forca: 0 };
  for (let y = Math.round(H * 0.2); y < H * 0.9; y += passo) {
    let n = 0;
    for (let x = 0; x < W; x += 2) {
      const v = g(x, y);
      if (v - g(x, y - d) > 12 && v - g(x, y + d) > 12) n++;
    }
    const forca = n / (W / 2);
    if (forca > melhorY.forca) melhorY = { pos: y / H, forca };
  }
  let melhorX = { pos: 0.5, forca: 0 };
  for (let x = Math.round(W * 0.2); x < W * 0.8; x += passo) {
    let n = 0;
    for (let y = 0; y < H; y += 2) {
      const v = g(x, y);
      if (v - g(x - d, y) > 12 && v - g(x + d, y) > 12) n++;
    }
    const forca = n / (H / 2);
    if (forca > melhorX.forca) melhorX = { pos: x / W, forca };
  }
  return melhorY.forca > melhorX.forca
    ? { eixo: 'y' as const, ...melhorY }
    : { eixo: 'x' as const, ...melhorX };
}

interface Preparado {
  canvas: HTMLCanvasElement;
  meio?: ReturnType<typeof acharMeio>;
}

/**
 * Cinza → inverte tema escuro → amplia (até 3x, ~3000 px) → preto-e-branco por limiar.
 * Escalação (nomes brancos sobre o campo), pelo fundo mediano:
 * - escuro (Flashscore, SuperScore): inverte e corta em 200 (print real: 22 de 22 nomes);
 * - médio (gramado verde do SofaScore): só pixel branco (menor canal RGB > 150) vira tinta;
 * - claro: limiar normal.
 */
async function preprocessar(arquivo: File, modo: ModoOcr = 'bloco'): Promise<Preparado> {
  const img = await createImageBitmap(arquivo);
  const escala = Math.max(1, Math.min(3, Math.round(3000 / img.width)));
  const canvas = document.createElement('canvas');
  canvas.width = img.width * escala;
  canvas.height = img.height * escala;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = dados.data;
  if (modo === 'lados') {
    const meio = acharMeio(px, canvas.width, canvas.height, 3 * escala);
    const hist = new Array<number>(256).fill(0);
    for (let i = 0; i < px.length; i += 4) hist[Math.round(cinzaDe(px, i))]++;
    let mediana = 0;
    for (let acc = 0; mediana < 255 && (acc += hist[mediana]) < px.length / 8;) mediana++;
    for (let i = 0; i < px.length; i += 4) {
      const cinza = cinzaDe(px, i);
      const tinta =
        mediana < 70
          ? 255 - cinza <= 200
          : mediana <= 170
            ? Math.min(px[i], px[i + 1], px[i + 2]) > 150
            : cinza <= 160;
      px[i] = px[i + 1] = px[i + 2] = tinta ? 0 : 255;
    }
    ctx.putImageData(dados, 0, 0);
    return { canvas, meio };
  }
  let soma = 0;
  for (let i = 0; i < px.length; i += 4) {
    const cinza = cinzaDe(px, i);
    px[i] = cinza;
    soma += cinza;
  }
  const inverter = soma / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    const v = inverter ? 255 - px[i] : px[i];
    px[i] = px[i + 1] = px[i + 2] = v > 160 ? 255 : 0;
  }
  ctx.putImageData(dados, 0, 0);
  return { canvas };
}

export async function lerImagem(
  arquivo: File,
  progresso?: (p: number) => void,
  modo: ModoOcr = 'bloco',
): Promise<string> {
  const w = await obterWorker();
  aoProgredir = progresso ?? null;
  try {
    const { canvas, meio } = await preprocessar(arquivo, modo);
    if (modo === 'bloco') return (await w.recognize(canvas)).data.text;
    // escalação: texto esparso (nomes espalhados pelo campo), cada linha com o seu centro
    // em milésimos da imagem; o leitor separa os times pela linha do meio
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
    const W = canvas.width;
    const H = canvas.height;
    const linhas = [MARCA_POSICOES];
    if (meio) linhas.push(`${MARCA_MEIO} ${meio.eixo} ${Math.round(meio.pos * 1000)}`);
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines) {
          const t = l.text.trim();
          if (!t) continue;
          const cx = Math.round(((l.bbox.x0 + l.bbox.x1) / 2 / W) * 1000);
          const cy = Math.round(((l.bbox.y0 + l.bbox.y1) / 2 / H) * 1000);
          linhas.push(`@${cx},${cy} ${t}`);
        }
    return linhas.join('\n');
  } finally {
    aoProgredir = null;
    if (modo !== 'bloco') await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  }
}
