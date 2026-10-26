/**
 * OCR local com Tesseract.js (português + inglês). Nada sai do aparelho além do download
 * dos dados de idioma na primeira vez.
 */
import { createWorker, type Worker } from 'tesseract.js';

let worker: Promise<Worker> | null = null;
let aoProgredir: ((p: number) => void) | null = null;

function obterWorker(): Promise<Worker> {
  worker ??= createWorker(['por', 'eng'], 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') aoProgredir?.(m.progress);
    },
  });
  return worker;
}

/** Escala de cinza + contraste + ampliação: melhora bastante a leitura de números pequenos. */
async function preprocessar(arquivo: File): Promise<HTMLCanvasElement> {
  const img = await createImageBitmap(arquivo);
  const escala = img.width < 1400 ? 2 : 1;
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
    px[i] = px[i + 1] = px[i + 2] = cinza;
    soma += cinza;
  }
  // tema escuro (fundo escuro, texto claro) → inverte para texto escuro em fundo claro
  const inverter = soma / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    let v = inverter ? 255 - px[i] : px[i];
    v = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128));
    px[i] = px[i + 1] = px[i + 2] = v;
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
