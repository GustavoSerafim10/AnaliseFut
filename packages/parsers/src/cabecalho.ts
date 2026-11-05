/**
 * Print do cabeçalho do jogo (SofaScore e parecidos): acha os dois escudos, recorta com fundo
 * transparente, tira as cores e lê os nomes, a hora e a competição. Só cálculo sobre pixels e
 * texto: roda igual no navegador e nos testes.
 */
import type { ImagemRgba } from './tabelaOcr';

export interface Caixa {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Cor mais comum da imagem: o fundo do cartão. */
function corDeFundo(img: ImagemRgba): [number, number, number] {
  const conta = new Map<number, number>();
  for (let i = 0; i < img.largura * img.altura * 4; i += 16) {
    const k = ((img.data[i] >> 3) << 10) | ((img.data[i + 1] >> 3) << 5) | (img.data[i + 2] >> 3);
    conta.set(k, (conta.get(k) ?? 0) + 1);
  }
  let melhor = 0;
  let n = -1;
  for (const [k, v] of conta)
    if (v > n) {
      melhor = k;
      n = v;
    }
  return [((melhor >> 10) & 31) * 8 + 4, ((melhor >> 5) & 31) * 8 + 4, (melhor & 31) * 8 + 4];
}

const DIFERENCA_DO_FUNDO = 45;

function componentes(img: ImagemRgba): (Caixa & { area: number })[] {
  const { largura: w, altura: h } = img;
  const fundo = corDeFundo(img);
  const frente = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (
        Math.max(
          Math.abs(img.data[i] - fundo[0]),
          Math.abs(img.data[i + 1] - fundo[1]),
          Math.abs(img.data[i + 2] - fundo[2]),
        ) > DIFERENCA_DO_FUNDO
      )
        frente[y * w + x] = 1;
    }
  // junta o que está a 2 px (letra do escudo, estrela colada), sem misturar com o texto ao lado
  const visitado = new Uint8Array(w * h);
  const saida: (Caixa & { area: number })[] = [];
  const pilha: number[] = [];
  for (let ini = 0; ini < w * h; ini++) {
    if (!frente[ini] || visitado[ini]) continue;
    const c = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    visitado[ini] = 1;
    pilha.push(ini);
    while (pilha.length) {
      const p = pilha.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.x0 = Math.min(c.x0, x);
      c.x1 = Math.max(c.x1, x);
      c.y0 = Math.min(c.y0, y);
      c.y1 = Math.max(c.y1, y);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (frente[q] && !visitado[q]) {
            visitado[q] = 1;
            pilha.push(q);
          }
        }
    }
    saida.push(c);
  }
  return saida;
}

/**
 * Os dois escudos: o par do mesmo tamanho, na mesma altura e bem separado que está mais acima no
 * print (na página inteira, as fotos dos jogadores vêm depois e são maiores); na mesma faixa de
 * altura, o maior (os ícones de "favoritar" e de compartilhar são menores).
 */
export function acharEscudos(img: ImagemRgba): { casa: Caixa; fora: Caixa } | null {
  const larg = (c: Caixa) => c.x1 - c.x0 + 1;
  const alt = (c: Caixa) => c.y1 - c.y0 + 1;
  const candidatos = componentes(img).filter((c) => {
    const proporcao = larg(c) / alt(c);
    return (
      alt(c) >= 24 &&
      alt(c) <= img.largura * 0.3 &&
      proporcao >= 0.55 &&
      proporcao <= 1.45 &&
      c.area / (larg(c) * alt(c)) >= 0.3 &&
      c.y0 < img.altura * 0.55
    );
  });
  const pares: { casa: Caixa; fora: Caixa; nota: number; y: number; alt: number }[] = [];
  for (const a of candidatos)
    for (const b of candidatos) {
      if ((a.x0 + a.x1) / 2 >= (b.x0 + b.x1) / 2) continue;
      const distancia = (b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2;
      const altura = Math.min(alt(a), alt(b));
      if (
        distancia < img.largura * 0.15 ||
        Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) > altura * 0.35 ||
        Math.max(alt(a), alt(b)) / altura > 1.5
      )
        continue;
      pares.push({
        casa: a,
        fora: b,
        nota: alt(a) * larg(a) * alt(b) * larg(b),
        y: (a.y0 + a.y1 + b.y0 + b.y1) / 4,
        alt: altura,
      });
    }
  if (!pares.length) return null;
  const topo = pares.reduce((p, q) => (q.y < p.y ? q : p));
  const melhor = pares
    .filter((p) => p.y - topo.y < topo.alt)
    .reduce((p, q) => (q.nota > p.nota ? q : p));
  return { casa: melhor.casa, fora: melhor.fora };
}

export interface Recorte {
  data: Uint8ClampedArray;
  largura: number;
  altura: number;
}

/** Recorta o escudo; o fundo que encosta na borda do recorte fica transparente. */
export function recortarEscudo(img: ImagemRgba, c: Caixa): Recorte {
  const m = 2;
  const x0 = Math.max(0, c.x0 - m);
  const y0 = Math.max(0, c.y0 - m);
  const w = Math.min(img.largura - 1, c.x1 + m) - x0 + 1;
  const h = Math.min(img.altura - 1, c.y1 + m) - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const de = ((y + y0) * img.largura + x + x0) * 4;
      const para = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) data[para + k] = img.data[de + k];
    }
  const fundo = corDeFundo(img);
  const ehFundo = (p: number) =>
    Math.max(
      Math.abs(data[p * 4] - fundo[0]),
      Math.abs(data[p * 4 + 1] - fundo[1]),
      Math.abs(data[p * 4 + 2] - fundo[2]),
    ) <= DIFERENCA_DO_FUNDO;
  const pilha: number[] = [];
  const empurra = (p: number) => {
    if (data[p * 4 + 3] !== 0 && ehFundo(p)) {
      data[p * 4 + 3] = 0;
      pilha.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    empurra(x);
    empurra((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    empurra(y * w);
    empurra(y * w + w - 1);
  }
  while (pilha.length) {
    const p = pilha.pop()!;
    const x = p % w;
    if (x > 0) empurra(p - 1);
    if (x < w - 1) empurra(p + 1);
    if (p >= w) empurra(p - w);
    if (p < w * (h - 1)) empurra(p + w);
  }
  return { data, largura: w, altura: h };
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * Cores do escudo recortado. A cor forte vem antes do branco (o miolo branco de um escudo não é a
 * cor do time), salvo detalhe pequeno: um filete dourado em escudo preto e branco não conta.
 */
export function coresDoEscudo(r: Recorte): { cor1: string; cor2?: string } | null {
  const grupos = new Map<number, { n: number; r: number; g: number; b: number; cor: boolean }>();
  let validos = 0;
  for (let i = 0; i < r.data.length; i += 4) {
    if (r.data[i + 3] === 0) continue;
    const [cr, cg, cb] = [r.data[i], r.data[i + 1], r.data[i + 2]];
    const max = Math.max(cr, cg, cb);
    const min = Math.min(cr, cg, cb);
    const colorido = max > 70 && (max - min) / max > 0.4;
    if (!colorido && min <= 190) continue;
    validos++;
    const k = ((cr >> 5) << 6) | ((cg >> 5) << 3) | (cb >> 5);
    const g = grupos.get(k) ?? { n: 0, r: 0, g: 0, b: 0, cor: colorido };
    g.n++;
    g.r += cr;
    g.g += cg;
    g.b += cb;
    grupos.set(k, g);
  }
  if (!validos) return null;
  const lista = [...grupos.values()]
    .map((g) => ({ ...g, r: g.r / g.n, g: g.g / g.n, b: g.b / g.n }))
    .sort((a, b) => b.n - a.n);
  const coloridos = lista.filter((g) => g.cor);
  const somaCor = coloridos.reduce((s, g) => s + g.n, 0);
  const a = somaCor / validos >= 0.15 ? coloridos[0] : lista[0];
  const outra = lista.find(
    (g) => g.n >= validos * 0.08 && Math.hypot(g.r - a.r, g.g - a.g, g.b - a.b) > 90,
  );
  return { cor1: hex(a.r, a.g, a.b), ...(outra ? { cor2: hex(outra.r, outra.g, outra.b) } : {}) };
}

const NAO_E_TIME =
  /^(hoje|amanha|ontem|favorito|detalhes|formac|estatist|classifica|insights|partidas|visualiza|tela|cheia|h2h|midia|ao vivo|futebol|finalizado)/;

/** "Botafogo-SP", "Vasco da Gama", "O'Higgins"; lixo do OCR nas pontas sai, símbolo no meio não passa. */
export function limparNome(texto: string): string | null {
  const nome = texto
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}\d)]+$/gu, '')
    .replace(/\s+/g, ' ');
  if (!/^\p{Lu}[\p{L}\d .'’-]*$/u.test(nome)) return null;
  if ((nome.match(/\p{L}/gu) ?? []).length < 3) return null;
  const min = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return NAO_E_TIME.test(min) ? null : nome;
}

/** Hora com dois dígitos: "4:45" é "14:45" com o 1 perdido, e hora errada é pior que em branco. */
export function lerHora(texto: string): string | undefined {
  const h = /(?:^|[^\d])([01]\d|2[0-3])[:.h]([0-5]\d)(?!\d)/.exec(texto);
  return h ? `${h[1]}:${h[2]}` : undefined;
}

/** "Brasil » Brasileirão Série B, Rodada 37" → "Brasileirão Série B". */
export function lerCompeticao(texto: string): string | undefined {
  for (const l of texto.split('\n')) {
    const m = /([^»>▸›|]+?)\s*,\s*(rodada|round|jornada|grupo)\b/i.exec(l);
    if (m) return m[1].trim();
  }
  return undefined;
}

/**
 * Onde reler com zoom: embaixo do escudo (celular) e do lado de fora dele (computador), a hora
 * entre os dois e a faixa de cima, com a competição.
 */
export function areasDoCabecalho(
  caixas: { casa: Caixa; fora: Caixa },
  largura: number,
  altura: number,
): { casa: Caixa[]; fora: Caixa[]; hora: Caixa; topo: Caixa | null } {
  const dentro = (c: Caixa): Caixa => ({
    x0: Math.max(0, Math.round(c.x0)),
    y0: Math.max(0, Math.round(c.y0)),
    x1: Math.min(largura - 1, Math.round(c.x1)),
    y1: Math.min(altura - 1, Math.round(c.y1)),
  });
  const alt = (c: Caixa) => c.y1 - c.y0;
  const embaixo = (c: Caixa) => {
    const cx = (c.x0 + c.x1) / 2;
    return dentro({
      x0: cx - alt(c) * 2,
      x1: cx + alt(c) * 2,
      y0: c.y1 + 1,
      y1: c.y1 + alt(c) * 0.75,
    });
  };
  const aoLado = (c: Caixa, lado: -1 | 1) => {
    const cy = (c.y0 + c.y1) / 2;
    const [a, b] = lado < 0 ? [c.x0 - alt(c) * 4, c.x0 - 2] : [c.x1 + 2, c.x1 + alt(c) * 4];
    return dentro({ x0: a, x1: b, y0: cy - alt(c) * 0.4, y1: cy + alt(c) * 0.4 });
  };
  const { casa, fora } = caixas;
  const topoY = Math.min(casa.y0, fora.y0) - 1;
  return {
    casa: [embaixo(casa), aoLado(casa, -1)],
    fora: [embaixo(fora), aoLado(fora, 1)],
    hora: dentro({
      x0: casa.x1 + 2,
      x1: fora.x0 - 2,
      y0: Math.min(casa.y0, fora.y0),
      y1: Math.max(casa.y1, fora.y1),
    }),
    topo: topoY >= 10 ? dentro({ x0: 0, x1: largura - 1, y0: 0, y1: topoY }) : null,
  };
}
