/**
 * Classificação em várias passadas de OCR (site e `npm run ocr -- --tabela`):
 * 1. a imagem inteira, com a posição de cada palavra;
 * 2. o cabeçalho (P/J, W/V, D/E, L/D, DIFF/SG, GLS/Gols, PTS) dá a faixa x de cada coluna;
 * 3. cada coluna é lida de novo, sozinha e só com números: na leitura da página o "14" vira
 *    "wv"/"à" e o "32" vira "2" (SofaScore real: 4 falhas em 140 números, contra ~30);
 * 4. cores: os selos dos últimos jogos (verde, cinza ou amarelo, vermelho) e a faixa de zona
 *    na borda esquerda (Libertadores, rebaixamento...).
 * Sai texto: a linha lida + MARCA_TABELA + o que as passadas acharam ("J 32 · V 21 · …"); quem
 * interpreta e fecha as contas é lerClassificacao. Sem imports: o script de OCR (node) carrega
 * este arquivo direto.
 */

export interface CaixaOcr {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface PalavraOcr extends CaixaOcr {
  texto: string;
}
export interface LinhaOcr extends CaixaOcr {
  texto: string;
  palavras: PalavraOcr[];
}
/** Lê a imagem toda ou só a caixa (em pixels da imagem original); soNumeros: só 0-9 + - : */
export type ReconhecerOcr = (caixa?: CaixaOcr, soNumeros?: boolean) => Promise<LinhaOcr[]>;
export interface ImagemRgba {
  data: ArrayLike<number>;
  largura: number;
  altura: number;
}

/** separa a linha lida do que as passadas por coluna e por cor acharam */
export const MARCA_TABELA = ' ‖ ';
export const NUMEROS_TABELA = '0123456789+-:';

export type CampoTabela = 'J' | 'V' | 'E' | 'D' | 'SG' | 'Gols' | 'GP' | 'GC' | 'Pts';

interface Coluna {
  campo: CampoTabela;
  centro: number;
  x0: number;
  x1: number;
}

interface BlocoTesseract {
  paragraphs: {
    lines: { text: string; bbox: CaixaOcr; words: { text: string; bbox: CaixaOcr }[] }[];
  }[];
}

/** Blocos do Tesseract (imagem ampliada) → linhas com posição na imagem original. */
export function linhasDoTesseract(blocos: BlocoTesseract[], escala: number): LinhaOcr[] {
  const caixa = (b: CaixaOcr) => ({
    x0: b.x0 / escala,
    y0: b.y0 / escala,
    x1: b.x1 / escala,
    y1: b.y1 / escala,
  });
  return blocos.flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        texto: l.text.trim(),
        ...caixa(l.bbox),
        palavras: l.words.map((w) => ({ texto: w.text, ...caixa(w.bbox) })),
      })),
    ),
  );
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const centroX = (c: CaixaOcr) => (c.x0 + c.x1) / 2;
const centroY = (c: CaixaOcr) => (c.y0 + c.y1) / 2;
const mediana = (xs: number[]) => {
  const o = [...xs].sort((a, b) => a - b);
  return o.length ? o[Math.floor(o.length / 2)] : 0;
};

/** Rótulo do cabeçalho → campo. "P" é pontos quando há "J" (Globo); "D" é empate em inglês. */
function campoDoRotulo(
  palavra: string,
  ingles: boolean,
  temJ: boolean,
  temGC: boolean,
): CampoTabela | 'Forma' | null {
  // "Ww" (W lido duas vezes) → "w"
  const t = semAcento(palavra)
    .replace(/[^a-z+/:-]/g, '')
    .replace(/^([a-z])\1+$/, '$1');
  if (/^(j|mp|pj|jogos|pl)$/.test(t)) return 'J';
  if (t === 'p') return temJ ? 'Pts' : 'J';
  if (t === 'gp') return temGC ? 'GP' : 'J';
  if (t === 'gc') return 'GC';
  if (/^(w|v|vit)$/.test(t)) return 'V';
  if (/^(e|emp)$/.test(t)) return 'E';
  if (t === 'd') return ingles ? 'E' : 'D';
  if (/^(l|der)$/.test(t)) return 'D';
  if (/^(diff?|gd|sg|saldo|dg|\+\/-|\+-)$/.test(t)) return 'SG';
  if (/^(gls|g|gols?|goals)$/.test(t)) return 'Gols';
  if (/^(pts|pt|pontos|points)$/.test(t)) return 'Pts';
  if (/^(ultimos|ultimas|forma?|last)$/.test(t)) return 'Forma';
  return null;
}

interface Cabecalho {
  linha: LinhaOcr;
  colunas: Coluna[];
  /** x onde começa o primeiro rótulo: à esquerda dele, no cabeçalho, pode vir o nome da zona */
  inicio: number;
}

function acharCabecalho(linhas: LinhaOcr[], largura: number): Cabecalho | null {
  let melhor: Cabecalho | null = null;
  for (const linha of linhas) {
    const ts = linha.palavras.map((p) => semAcento(p.texto).replace(/[^a-z]/g, ''));
    const ingles = ts.some((t) => /^(w+|l)$/.test(t));
    const temJ = ts.includes('j');
    const temGC = ts.includes('gc');
    const achados: { campo: CampoTabela; centro: number }[] = [];
    let inicio = Infinity;
    for (const p of linha.palavras) {
      const c = campoDoRotulo(p.texto, ingles, temJ, temGC);
      if (!c) continue;
      inicio = Math.min(inicio, p.x0);
      if (c !== 'Forma' && !achados.some((a) => a.campo === c))
        achados.push({ campo: c, centro: centroX(p) });
    }
    if (achados.length < 4 || (melhor && achados.length <= melhor.colunas.length)) continue;
    achados.sort((a, b) => a.centro - b.centro);
    // meia largura: metade da distância à vizinha, no máximo 1,5× a do passo típico (a coluna
    // dos pontos, depois dos últimos jogos, não pode engolir os selos)
    const passos = achados.slice(1).map((a, i) => a.centro - achados[i].centro);
    const teto = (mediana(passos) / 2) * 1.5;
    const colunas = achados.map((a, i) => {
      const esq = i > 0 ? (a.centro - achados[i - 1].centro) / 2 : Infinity;
      const dir = i < achados.length - 1 ? (achados[i + 1].centro - a.centro) / 2 : Infinity;
      const meia = Math.min(esq, dir, teto);
      return { ...a, x0: Math.max(0, a.centro - meia), x1: Math.min(largura, a.centro + meia) };
    });
    melhor = { linha, colunas, inicio };
  }
  return melhor;
}

/** 1 vitória (verde), 2 cinza, 3 amarelo/laranja (empate), 4 derrota (vermelho), 0 nada */
function classeDaCor(r: number, g: number, b: number): number {
  if (g >= 100 && g - r >= 50 && g - b >= 25) return 1;
  if (r >= 150 && r - g >= 100 && r - b >= 50) return 4;
  if (r >= 180 && g >= 110 && b <= 110 && r - b >= 100 && r >= g) return 3;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min <= 32 && min >= 105 && max <= 215) return 2;
  return 0;
}

interface Selo {
  x0: number;
  x1: number;
  cy: number;
  h: number;
  classe: number;
}

/**
 * Selos dos últimos jogos: manchas de uma cor só, do tamanho de uma letra grande, cheias
 * (a letra branca no meio fura pouco). Componentes conexos na região à direita do nome.
 */
function acharSelos(img: ImagemRgba, regiao: CaixaOcr, passo: number): Selo[] {
  const rx0 = Math.max(0, Math.floor(regiao.x0));
  const ry0 = Math.max(0, Math.floor(regiao.y0));
  const W = Math.min(img.largura, Math.ceil(regiao.x1)) - rx0;
  const H = Math.min(img.altura, Math.ceil(regiao.y1)) - ry0;
  if (W <= 0 || H <= 0) return [];
  const cls = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = ((y + ry0) * img.largura + x + rx0) * 4;
      cls[y * W + x] = classeDaCor(img.data[i], img.data[i + 1], img.data[i + 2]);
    }
  const visto = new Uint8Array(W * H);
  const selos: Selo[] = [];
  const pilha: number[] = [];
  for (let s = 0; s < W * H; s++) {
    const c = cls[s];
    if (!c || visto[s]) continue;
    let area = 0;
    let [mx, Mx, my, My] = [W, 0, H, 0];
    visto[s] = 1;
    pilha.push(s);
    while (pilha.length) {
      const p = pilha.pop() as number;
      const px = p % W;
      const py = (p - px) / W;
      area++;
      mx = Math.min(mx, px);
      Mx = Math.max(Mx, px);
      my = Math.min(my, py);
      My = Math.max(My, py);
      const viz = [
        px > 0 ? p - 1 : -1,
        px < W - 1 ? p + 1 : -1,
        py > 0 ? p - W : -1,
        py < H - 1 ? p + W : -1,
      ];
      for (const q of viz)
        if (q >= 0 && !visto[q] && cls[q] === c) {
          visto[q] = 1;
          pilha.push(q);
        }
    }
    const w = Mx - mx + 1;
    const h = My - my + 1;
    if (h < passo * 0.3 || h > passo * 1.1 || w < h * 0.5 || w > h * 2.2 || area < w * h * 0.45)
      continue;
    selos.push({ x0: mx + rx0, x1: Mx + rx0, cy: (my + My) / 2 + ry0, h, classe: c });
  }
  return selos;
}

/** A maior sequência de selos lado a lado (≥ 3) → "VEDVV"; o "?" cinza do próximo jogo sai. */
function formaDosSelos(selos: Selo[]): string | undefined {
  const ord = [...selos].sort((a, b) => a.x0 - b.x0);
  let melhor: Selo[] = [];
  let atual: Selo[] = [];
  for (const s of ord) {
    const ant = atual[atual.length - 1];
    const junto =
      ant &&
      s.x0 - ant.x1 <= 0.8 * (ant.x1 - ant.x0 + 1) &&
      s.h / ant.h > 0.75 &&
      s.h / ant.h < 1.33;
    atual = junto ? [...atual, s] : [s];
    if (atual.length >= melhor.length) melhor = atual;
  }
  let classes = melhor.map((s) => s.classe);
  // empate em amarelo (Flashscore): o cinza é o "?" do próximo jogo, não empate
  if (classes.includes(3)) classes = classes.filter((c) => c !== 2);
  while (classes.length > 5 && (classes[0] === 2 || classes[classes.length - 1] === 2))
    if (classes[0] === 2) classes.shift();
    else classes.pop();
  if (classes.length < 3) return undefined;
  return classes.map((c) => (c === 1 ? 'V' : c === 4 ? 'D' : 'E')).join('');
}

const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');

/**
 * Faixa colorida da zona na borda esquerda, antes da coluna das posições (xMax): a primeira
 * coluna x com ≥ 35% da altura da linha numa cor saturada só. A franja do ClearType nas
 * bordas dos dígitos também é saturada, mas fica depois de xMax e muda de cor.
 */
function corDaFaixa(img: ImagemRgba, linha: LinhaOcr, xMax: number): string | undefined {
  const y0 = Math.max(0, Math.round(linha.y0));
  const y1 = Math.min(img.altura - 1, Math.round(linha.y1));
  const minimo = (y1 - y0 + 1) * 0.35;
  for (let x = 0; x <= xMax; x++) {
    const cores: number[][] = [];
    for (let y = y0; y <= y1; y++) {
      const i = (y * img.largura + x) * 4;
      const c = [img.data[i], img.data[i + 1], img.data[i + 2]];
      if (Math.max(...c) - Math.min(...c) >= 60 && Math.max(...c) >= 100) cores.push(c);
    }
    if (cores.length < minimo) continue;
    const med = [0, 1, 2].map((k) => mediana(cores.map((c) => c[k])));
    const iguais = cores.filter((c) => c.every((v, k) => Math.abs(v - med[k]) <= 24));
    if (iguais.length >= minimo) return `#${med.map(hex).join('')}`;
  }
  return undefined;
}

/** palavras do cabeçalho antes dos rótulos que não são nome de zona */
const NAO_ZONA = /^(#|pos|time|team|equipe|clube|club|asr|rating|nota|[a-z]{0,2})$/;

export async function lerTabelaOcr(
  reconhecer: ReconhecerOcr,
  img: ImagemRgba,
  aoAvancar?: (fracao: number) => void,
): Promise<string> {
  const linhas = await reconhecer();
  const cab = acharCabecalho(linhas, img.largura);
  if (!cab) return linhas.map((l) => l.texto).join('\n');
  const { colunas } = cab;
  const naColuna = (p: PalavraOcr) => colunas.some((c) => centroX(p) >= c.x0 && centroX(p) <= c.x1);
  const dados = linhas.filter(
    (l) => l !== cab.linha && l.y0 >= cab.linha.y1 - 2 && l.palavras.filter(naColuna).length >= 2,
  );
  if (!dados.length) return linhas.map((l) => l.texto).join('\n');
  const cys = dados.map(centroY);
  const passo =
    dados.length > 1
      ? mediana(cys.slice(1).map((y, i) => y - cys[i]))
      : (dados[0].y1 - dados[0].y0) * 1.6;
  const maisPerto = (y: number) => {
    let k = -1;
    let dist = Infinity;
    cys.forEach((c, j) => {
      if (Math.abs(c - y) < dist) [k, dist] = [j, Math.abs(c - y)];
    });
    return dist <= passo * 0.6 ? { k, dist } : null;
  };

  // cada coluna de novo, sozinha e só com números
  const topo = cab.linha.y1;
  const base = Math.min(img.altura, Math.max(...dados.map((d) => d.y1)) + passo / 2);
  const valores = dados.map(() => new Map<CampoTabela, string>());
  for (const [i, col] of colunas.entries()) {
    const lidas = await reconhecer({ x0: col.x0, y0: topo, x1: col.x1, y1: base }, true);
    const distancias = new Map<number, number>();
    for (const l of lidas) {
      const v = l.texto.replace(/\s+/g, '');
      const alvo = /\d/.test(v) ? maisPerto(centroY(l)) : null;
      if (!alvo || alvo.dist >= (distancias.get(alvo.k) ?? Infinity)) continue;
      distancias.set(alvo.k, alvo.dist);
      valores[alvo.k].set(col.campo, v);
    }
    aoAvancar?.((i + 1) / colunas.length);
  }

  // selos dos últimos jogos, à direita do começo das colunas de números
  const selos = acharSelos(
    img,
    { x0: Math.min(...colunas.map((c) => c.x0)), y0: topo, x1: img.largura, y1: base },
    passo,
  );
  const formas = dados.map((_, j) => formaDosSelos(selos.filter((s) => maisPerto(s.cy)?.k === j)));
  // a faixa de zona fica antes da coluna das posições
  const xFaixa = Math.min(
    img.largura * 0.08,
    mediana(dados.map((d) => d.palavras[0]?.x0 ?? 0)) - 2,
  );

  const saida: string[] = [];
  for (const l of linhas) {
    if (l === cab.linha) {
      const zona = l.palavras
        .filter((p) => p.x1 < cab.inicio)
        .map((p) => p.texto)
        .filter((t) => !NAO_ZONA.test(semAcento(t).replace(/[^a-z#]/g, '')))
        .join(' ');
      const cor = /[A-Za-zÀ-ú]{4,}/.test(zona) ? corDaFaixa(img, l, xFaixa) : undefined;
      if (cor) saida.push(`${zona}${MARCA_TABELA}Zona ${cor}`);
      saida.push(`${l.texto}${MARCA_TABELA}Colunas ${colunas.map((c) => c.campo).join(' ')}`);
      continue;
    }
    const j = dados.indexOf(l);
    const partes: string[] = [];
    if (j >= 0) {
      for (const c of colunas) {
        const v = valores[j].get(c.campo);
        if (v !== undefined) partes.push(`${c.campo} ${v}`);
      }
      if (formas[j]) partes.push(`Forma ${formas[j]}`);
    }
    const cor = l.y0 >= cab.linha.y0 ? corDaFaixa(img, l, xFaixa) : undefined;
    if (cor) partes.push(`Zona ${cor}`);
    saida.push(partes.length ? `${l.texto}${MARCA_TABELA}${partes.join(' · ')}` : l.texto);
  }
  return saida.join('\n');
}
