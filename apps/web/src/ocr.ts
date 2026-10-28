/**
 * OCR local com Tesseract.js (português + inglês). Nada sai do aparelho além do download
 * dos dados de idioma na primeira vez. Mesmo tratamento do script `npm run ocr`
 * (calibrado com prints reais do SofaScore/SuperScore).
 */
import { MARCA_DIREITA, MARCA_ESQUERDA } from '@pe/parsers';
import { createWorker, PSM, type Worker } from 'tesseract.js';

/** bloco: texto corrido (estatísticas, odds). lados: metade esquerda e direita em separado (escalação). */
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

/**
 * Cinza → inverte tema escuro → amplia (até 3x, ~3000 px) → preto-e-branco por limiar.
 * Sem limiar (escalação): o gramado verde viraria preto junto com os nomes; o Tesseract binariza.
 */
async function preprocessar(arquivo: File, limiar = true): Promise<HTMLCanvasElement> {
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
  let soma = 0;
  for (let i = 0; i < px.length; i += 4) {
    const cinza = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = cinza;
    soma += cinza;
  }
  const inverter = soma / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    const v = inverter ? 255 - px[i] : px[i];
    px[i] = px[i + 1] = px[i + 2] = limiar ? (v > 160 ? 255 : 0) : v;
  }
  ctx.putImageData(dados, 0, 0);
  return canvas;
}

/** Recorta uma faixa vertical do canvas (fração 0–1 da largura). */
function recortar(c: HTMLCanvasElement, de: number, ate: number): HTMLCanvasElement {
  const x = Math.round(c.width * de);
  const out = document.createElement('canvas');
  out.width = Math.round(c.width * ate) - x;
  out.height = c.height;
  out.getContext('2d')!.drawImage(c, x, 0, out.width, c.height, 0, 0, out.width, c.height);
  return out;
}

export async function lerImagem(
  arquivo: File,
  progresso?: (p: number) => void,
  modo: ModoOcr = 'bloco',
): Promise<string> {
  const w = await obterWorker();
  try {
    if (modo === 'bloco') {
      aoProgredir = progresso ?? null;
      const { data } = await w.recognize(await preprocessar(arquivo));
      return data.text;
    }
    // escalação: cada metade sozinha, texto esparso (nomes espalhados pelo campo)
    const canvas = await preprocessar(arquivo, false);
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const partes: string[] = [];
    for (const [i, [marca, de, ate]] of (
      [
        [MARCA_ESQUERDA, 0, 0.5],
        [MARCA_DIREITA, 0.5, 1],
      ] as const
    ).entries()) {
      aoProgredir = (p) => progresso?.((i + p) / 2);
      const { data } = await w.recognize(recortar(canvas, de, ate));
      partes.push(marca, data.text);
    }
    return partes.join('\n');
  } finally {
    aoProgredir = null;
    if (modo !== 'bloco') await w.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  }
}
