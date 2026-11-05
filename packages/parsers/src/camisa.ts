/**
 * Cores do time pela camisa desenhada no print da escalação (SofaScore: a camisa fica logo abaixo
 * da formação). Roda igual no navegador e nos testes.
 */
import type { ImagemRgba } from './tabelaOcr';

export interface CoresCamisa {
  cor1: string;
  cor2?: string;
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Lê a caixa abaixo do centro (cx, cy) da formação, em pixels. O fundo do cartão e as listras
 * pretas são escuros e sem cor, então só contam pixels com cor forte ou quase brancos: camisa
 * preta com detalhe verde devolve o verde. Sem pixels suficientes (print sem camisa) → null.
 */
export function coresDaCamisa(img: ImagemRgba, cx: number, cy: number): CoresCamisa | null {
  const e = img.largura / 1000;
  const x0 = Math.max(0, Math.round(cx - 14 * e));
  const x1 = Math.min(img.largura - 1, Math.round(cx + 14 * e));
  const y0 = Math.max(0, Math.round(cy + 10 * e));
  const y1 = Math.min(img.altura - 1, Math.round(cy + 44 * e));
  const grupos = new Map<number, { n: number; r: number; g: number; b: number; cor: boolean }>();
  let total = 0;
  let validos = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      total++;
      const i = (y * img.largura + x) * 4;
      const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const colorido = max > 70 && (max - min) / max > 0.4;
      const branco = min > 190;
      if (!colorido && !branco) continue;
      validos++;
      const chave = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const c = grupos.get(chave) ?? { n: 0, r: 0, g: 0, b: 0, cor: colorido };
      c.n++;
      c.r += r;
      c.g += g;
      c.b += b;
      grupos.set(chave, c);
    }
  if (!total || validos / total < 0.03) return null;
  const media = [...grupos.values()]
    .sort((p, q) => q.n - p.n)
    .map((c) => ({ n: c.n, r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }));
  const [a] = media;
  const outra = media.find(
    (c) => c.n >= validos * 0.08 && Math.hypot(c.r - a.r, c.g - a.g, c.b - a.b) > 90,
  );
  return {
    cor1: hex(a.r, a.g, a.b),
    ...(outra ? { cor2: hex(outra.r, outra.g, outra.b) } : {}),
  };
}
