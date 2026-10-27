/**
 * Figurinhas: fotos que VOCÊ escolhe no seu aparelho para os três jogadores da animação.
 * Ficam só no localStorage deste navegador — nunca vão para o código, o GitHub ou o site
 * publicado. Cada foto é recortada em quadrado e reduzida para caber no armazenamento.
 */
export type Figurinhas = [string | null, string | null, string | null];

const CHAVE = 'pe-figurinhas-v1';
const LADO = 240;

export function carregarFigurinhas(): Figurinhas {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as unknown;
    if (Array.isArray(v) && v.length === 3)
      return v.map((x) => (typeof x === 'string' ? x : null)) as Figurinhas;
  } catch {
    /* sem storage ou dado estragado: começa sem fotos */
  }
  return [null, null, null];
}

/** false = o aparelho não deixou guardar (aba privada ou armazenamento cheio). */
export function gravarFigurinhas(f: Figurinhas): boolean {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(f));
    return true;
  } catch {
    return false;
  }
}

async function abrirImagem(arquivo: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Arquivo de imagem → JPEG quadrado de 240 px (recorte central), como data URL. */
export async function prepararFoto(arquivo: File): Promise<string> {
  const img = await abrirImagem(arquivo);
  const lado = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = LADO;
  canvas.height = LADO;
  canvas.getContext('2d')!.drawImage(
    img,
    (img.naturalWidth - lado) / 2,
    // foto em pé: o rosto costuma estar no alto, então o recorte sobe
    (img.naturalHeight - lado) * 0.15,
    lado,
    lado,
    0,
    0,
    LADO,
    LADO,
  );
  return canvas.toDataURL('image/jpeg', 0.85);
}

// ---------- galeria de fundo ----------
const CHAVE_GALERIA = 'pe-galeria-v1';
export const MAX_GALERIA = 8;
const LARGURA_FUNDO = 900;

export function carregarGaleria(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE_GALERIA) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function gravarGaleria(g: string[]): boolean {
  try {
    localStorage.setItem(CHAVE_GALERIA, JSON.stringify(g.slice(0, MAX_GALERIA)));
    return true;
  } catch {
    return false;
  }
}

/** Foto de fundo: até 900 px de largura, JPEG mais leve (fica escurecida atrás do conteúdo). */
export async function prepararFundo(arquivo: File): Promise<string> {
  const img = await abrirImagem(arquivo);
  const escala = Math.min(1, LARGURA_FUNDO / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * escala);
  canvas.height = Math.round(img.naturalHeight * escala);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}
