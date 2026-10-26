/**
 * OCR local com Tesseract.js (português + inglês). Nada sai do aparelho além do download
 * dos dados de idioma na primeira vez. Mesmo tratamento do script `npm run ocr`
 * (calibrado com prints reais do SofaScore/SuperScore).
 */
import { createWorker, PSM, type Worker } from 'tesseract.js';

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

/** Cinza → inverte tema escuro → amplia (até 3x, ~3000 px) → preto-e-branco por limiar. */
async function preprocessar(arquivo: File): Promise<HTMLCanvasElement> {
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
    px[i] = px[i + 1] = px[i + 2] = v > 160 ? 255 : 0;
  }
  ctx.putImageData(dados, 0, 0);
  return canvas;
}

export async function lerImagem(arquivo: File, progresso?: (p: number) => void): Promise<string> {
  const w = await obterWorker();
  aoProgredir = progresso ?? null;
  try {
    const { data } = await w.recognize(await preprocessar(arquivo));
    return data.text;
  } finally {
    aoProgredir = null;
  }
}
