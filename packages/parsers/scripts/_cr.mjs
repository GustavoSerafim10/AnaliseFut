import sharp from 'sharp';
import { Buffer } from 'node:buffer';
import { createWorker } from 'tesseract.js';
// Catmull-Rom (bicúbica a = -0,5), 4 pesos
const cr = (x) => {
  x = Math.abs(x);
  return x < 1
    ? 1.5 * x ** 3 - 2.5 * x ** 2 + 1
    : x < 2
      ? -0.5 * x ** 3 + 2.5 * x ** 2 - 4 * x + 2
      : 0;
};
const pesos = (s) =>
  Array.from({ length: s }, (_, r) => {
    const c = (r + 0.5) / s - 0.5;
    const ini = Math.floor(c) - 1;
    const w = Array.from({ length: 4 }, (_, k) => cr(c - (ini + k)));
    const so = w.reduce((a, b) => a + b, 0);
    return { ini, w: w.map((v) => v / so) };
  });
function ampliar(data, w, h, s) {
  const W = w * s,
    H = h * s,
    p = pesos(s),
    lim = (v, m) => (v < 0 ? 0 : v > m ? m : v);
  const tmp = new Float32Array(h * W);
  for (let y = 0; y < h; y++)
    for (let X = 0; X < W; X++) {
      const { ini, w: pw } = p[X % s];
      const base = Math.floor(X / s) + ini;
      let g = 0;
      for (let k = 0; k < 4; k++) {
        const i = (y * w + lim(base + k, w - 1)) * 4;
        g += (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * pw[k];
      }
      tmp[y * W + X] = g;
    }
  const d = new Uint8ClampedArray(W * H);
  for (let Y = 0; Y < H; Y++) {
    const { ini, w: pw } = p[Y % s];
    const base = Math.floor(Y / s) + ini;
    for (let X = 0; X < W; X++) {
      let g = 0;
      for (let k = 0; k < 4; k++) g += tmp[lim(base + k, h - 1) * W + X] * pw[k];
      d[Y * W + X] = g;
    }
  }
  return { d, W, H };
}
const [modo, ...arqs] = process.argv.slice(2);
const w = await createWorker(['por', 'eng']);
await w.setParameters({ tessedit_pageseg_mode: modo === 'lados' ? '11' : '6' });
for (const [esc, lim] of modo === 'lados'
  ? [
      [3, 200],
      [4, 200],
      [3, 0],
      [4, 0],
    ]
  : [
      [3, 160],
      [4, 160],
      [3, 0],
      [4, 0],
    ]) {
  let txt = '';
  for (const arq of arqs) {
    const { data, info } = await sharp(arq)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { d, W, H } = ampliar(data, info.width, info.height, esc);
    const b = Buffer.alloc(W * H);
    for (let i = 0; i < b.length; i++) {
      const v = 255 - d[i];
      b[i] = lim ? (v >= lim ? 255 : 0) : v;
    }
    txt +=
      (
        await w.recognize(
          await sharp(b, { raw: { width: W, height: H, channels: 1 } })
            .png()
            .toBuffer(),
        )
      ).data.text + '\n';
  }
  if (modo === 'lados')
    console.log(
      esc,
      lim,
      txt.split('\n').filter((l) => /[A-Z][a-z]{2,}/.test(l)).length,
      txt
        .split('\n')
        .filter((l) => /[A-Z][a-z]{2,}/.test(l))
        .join('|'),
    );
  else {
    const V = [
      ['Partidas', '32', '32'],
      ['marcados', '34', '44'],
      ['sofridos 5', '50', '51'],
      ['ssist', '20', '29'],
      ['partida 1', '11', '14'],
      ['certos por jogo', '39', '53'],
      ['Posse', '440', '476'],
      ['sem sofrer', '4', '5'],
      ['ntercep', '97', '79'],
      ['Cortes', '263', '256'],
      ['Defesas', '38', '38'],
      ['Faltas', '115', '134'],
      ['mpedimentos', '17', '08'],
      ['Tiros de meta', '83', '82'],
      ['Laterais', '194', '193'],
      ['amare', '21', '26'],
    ];
    let ok = 0;
    for (const [k, c, f] of V) {
      const l = (txt.split('\n').find((x) => x.includes(k)) ?? '')
        .replace(/[.,%]/g, '')
        .split(/\s+/);
      for (const v of [c, f]) if (l.includes(v)) ok++;
    }
    console.log(esc, lim, `${ok}/${V.length * 2}`);
  }
}
await w.terminate();
