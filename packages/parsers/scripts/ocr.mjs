// Roda o mesmo OCR do site (Tesseract, por+eng) em imagens locais e imprime o texto.
// Uso: npm run ocr -- caminho/print1.png caminho/print2.png
//      npm run ocr -- --tabela classificacao.png   (leitura em colunas, como a do site)
// Serve para transformar prints reais em fixtures de teste dos parsers.
// Mesmo tratamento do site (apps/web/src/ocr.ts, modo "bloco"): amplia com Lanczos-3 (até 4x,
// ~4000 px, no máximo ~16 Mpx), cinza, inverte tema escuro; Tesseract em modo bloco (psm 6).
// O código da ampliação é o mesmo do site: o filtro do sharp dá outro resultado no OCR.
import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { lerTabelaOcr, linhasDoTesseract, NUMEROS_TABELA } from '../src/tabelaOcr.ts';

const tabela = process.argv.includes('--tabela');
const arquivos = process.argv.slice(2).filter((a) => a !== '--tabela');
if (!arquivos.length) {
  console.error('uso: npm run ocr -- imagem.png [mais imagens]');
  process.exit(1);
}

const lanczos3 = (x) => {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const p = Math.PI * x;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
};

function pesos(s) {
  return Array.from({ length: s }, (_, r) => {
    const centro = (r + 0.5) / s - 0.5;
    const ini = Math.floor(centro) - 2;
    const w = Array.from({ length: 6 }, (_, k) => lanczos3(centro - (ini + k)));
    const soma = w.reduce((a, b) => a + b, 0);
    return { ini, w: w.map((v) => v / soma) };
  });
}

/** RGBA → cinza ampliado com Lanczos-3 (separável, como no site). */
function ampliarCinza(data, w, h, s) {
  const W = w * s;
  const H = h * s;
  const p = pesos(s);
  const lim = (v, max) => (v < 0 ? 0 : v > max ? max : v);
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
  const cinza = new Uint8ClampedArray(W * H);
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
      // o site arredonda cada canal (ImageData) antes de tirar o cinza
      const c = (v) => Math.min(255, Math.max(0, Math.round(v)));
      cinza[Y * W + X] = 0.299 * c(r) + 0.587 * c(g) + 0.114 * c(b);
    }
  }
  return { cinza, W, H };
}

async function preprocessar(arq) {
  const { data, info } = await sharp(arq).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const s = Math.max(1, Math.min(4, Math.round(4000 / w), Math.floor(Math.sqrt(16e6 / (w * h)))));
  const { cinza, W, H } = ampliarCinza(data, w, h, s);
  let soma = 0;
  for (const v of cinza) soma += v;
  if (soma / cinza.length < 128) for (let i = 0; i < cinza.length; i++) cinza[i] = 255 - cinza[i];
  const png = await sharp(Buffer.from(cinza), { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toBuffer();
  return { png, original: { data, largura: w, altura: h }, escala: s };
}

const worker = await createWorker(['por', 'eng']);
await worker.setParameters({ tessedit_pageseg_mode: '6' });
for (const arq of arquivos) {
  const { png, original, escala } = await preprocessar(arq);
  console.log(`===== ${arq} =====`);
  if (!tabela) {
    console.log((await worker.recognize(png)).data.text);
    continue;
  }
  const reconhecer = async (caixa, soNumeros) => {
    await worker.setParameters({ tessedit_char_whitelist: soNumeros ? NUMEROS_TABELA : '' });
    const opcoes = caixa
      ? {
          rectangle: {
            left: Math.round(caixa.x0 * escala),
            top: Math.round(caixa.y0 * escala),
            width: Math.round((caixa.x1 - caixa.x0) * escala),
            height: Math.round((caixa.y1 - caixa.y0) * escala),
          },
        }
      : {};
    const { data } = await worker.recognize(png, opcoes, { blocks: true, text: true });
    return linhasDoTesseract(data.blocks ?? [], escala);
  };
  console.log(await lerTabelaOcr(reconhecer, original));
  await worker.setParameters({ tessedit_char_whitelist: '' });
}
await worker.terminate();
