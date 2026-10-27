/**
 * Estado da análise em edição. Guardamos o TEXTO lido de cada print (não a imagem):
 * tudo o mais é recalculado a partir dele, então corrigir o leitor corrige análises antigas.
 * Fica no localStorage do aparelho só como conveniência; histórico de verdade é a Fase 4.
 */
import type { OddLine } from '@pe/schemas';

export const FUSO = '-03:00';
const CHAVE = 'pe-rascunho-v2';

export interface Leitura {
  arquivo: string;
  texto: string;
  /** hora em que o print foi salvo (ISO, fuso de Brasília): serve de horário de coleta */
  capturadoEm?: string;
}

/** Date → "2026-10-26T16:13:00-03:00" no horário local do aparelho. */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${FUSO}`;
}

export type NivelDesfalque = 'auto' | 'nenhum' | 'baixo' | 'medio' | 'alto' | 'critico';

/** 'auto' é resolvido em dados.ts pela sugestão automática antes de virar fator. */
export const FATOR_DESFALQUE: Record<NivelDesfalque, number> = {
  auto: 1,
  nenhum: 1,
  baixo: 0.98,
  medio: 0.95,
  alto: 0.9,
  critico: 0.85,
};

export const ROTULO_DESFALQUE: Record<NivelDesfalque, string> = {
  auto: 'automático (pelo texto do Flashscore)',
  nenhum: 'nenhum impacto',
  baixo: 'baixo (−2%)',
  medio: 'médio (−5%)',
  alto: 'alto (−10%)',
  critico: 'crítico (−15%)',
};

export interface Rascunho {
  jogo: { casa: string; fora: string; competicao: string; data: string; hora: string };
  config: {
    ligaTop: boolean;
    favoritoLigaMaisForte: boolean;
    escalacaoProvavel: boolean;
    escalacaoIncerta: boolean;
    mercadoMuitoLiquido: boolean;
    mediaGols: string;
    mando: string;
    mediaEscanteios: string;
    mediaCartoes: string;
  };
  /** textos de OCR por grupo: sofascore, superscore, classificacao, desfalques, ultimas, odds:<casa> */
  prints: Record<string, Leitura[]>;
  flashscore: string;
  /** correções manuais das estatísticas: `${campo}.${time}` → valor */
  correcoes: Record<string, number>;
  desfalqueAtaque: { casa: NivelDesfalque; fora: NivelDesfalque };
  desfalqueDefesa: { casa: NivelDesfalque; fora: NivelDesfalque };
  casas: string[];
  odds: OddLine[];
  explicacaoDivergencia: string;
  redTeam: { argumentos: string[]; atacaPremissa: boolean; sobreviveu: boolean };
  banca: string;
}

export function rascunhoNovo(): Rascunho {
  return {
    jogo: {
      casa: '',
      fora: '',
      competicao: '',
      data: new Date().toISOString().slice(0, 10),
      hora: '',
    },
    config: {
      ligaTop: true,
      favoritoLigaMaisForte: false,
      escalacaoProvavel: false,
      escalacaoIncerta: false,
      mercadoMuitoLiquido: false,
      mediaGols: '1.30',
      mando: '1.12',
      mediaEscanteios: '5.0',
      mediaCartoes: '2.2',
    },
    prints: {},
    flashscore: '',
    correcoes: {},
    desfalqueAtaque: { casa: 'auto', fora: 'auto' },
    desfalqueDefesa: { casa: 'nenhum', fora: 'nenhum' },
    casas: ['1win'],
    odds: [],
    explicacaoDivergencia: '',
    redTeam: { argumentos: ['', '', ''], atacaPremissa: false, sobreviveu: false },
    banca: '',
  };
}

export function carregarRascunho(): Rascunho {
  try {
    const s = localStorage.getItem(CHAVE);
    if (s) {
      const salvo = JSON.parse(s) as Partial<Rascunho>;
      const novo = rascunhoNovo();
      return { ...novo, ...salvo, config: { ...novo.config, ...salvo.config } };
    }
  } catch {
    /* sem storage (aba privada etc.): começa vazio */
  }
  return rascunhoNovo();
}

export function salvarRascunho(r: Rascunho): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(r));
  } catch {
    /* ignora: é só conveniência */
  }
}

/** "1,85" ou "1.85" → 1.85; vazio → undefined */
export function num(s: string): number | undefined {
  const t = s.trim().replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export const inicioIso = (r: Rascunho) => `${r.jogo.data}T${r.jogo.hora || '00:00'}:00${FUSO}`;

export const pct = (x: number | null | undefined, casas = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(casas)}%`;

export const dec = (x: number | null | undefined, casas = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(casas);
