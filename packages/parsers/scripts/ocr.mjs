// Roda o mesmo OCR do site (Tesseract, por+eng) em imagens locais e imprime o texto.
// Uso: npm run ocr -- caminho/print1.png caminho/print2.png
// Serve para transformar prints reais em fixtures de teste dos parsers.
// Aplica o mesmo pré-processamento do site (apps/web/src/ocr.ts):
// cinza, inverte tema escuro, amplia 3x, preto-e-branco por limiar; Tesseract em modo bloco (psm 6).
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error('uso: npm run ocr -- imagem.png [mais imagens]');
  process.exit(1);
}

async function preprocessar(arq) {
  const { width } = await sharp(arq).metadata();
  const { channels } = await sharp(arq).grayscale().stats();
  let p = sharp(arq).grayscale();
  if (channels[0].mean < 128) p = p.negate({ alpha: false });
  const escala = Math.max(1, Math.min(3, Math.round(3000 / width)));
  return p.resize({ width: width * escala, kernel: 'lanczos3' }).threshold(160).png().toBuffer();
}

const worker = await createWorker(['por', 'eng']);
await worker.setParameters({ tessedit_pageseg_mode: '6' });
for (const arq of arquivos) {
  const { data } = await worker.recognize(await preprocessar(arq));
  console.log(`===== ${arq} =====`);
  console.log(data.text);
}
await worker.terminate();
