/**
 * Estado da análise em edição (rascunho). Fica no localStorage do aparelho só como
 * conveniência; o histórico de verdade (IndexedDB) é a Fase 4.
 */
import type { ContextoAnalise, DQ, EstatisticasTime } from '@pe/engine';
import type { OddLine } from '@pe/schemas';

export const FUSO = '-03:00';
const CHAVE = 'pe-rascunho-v1';

export interface StatsForm {
  jogos: string;
  golsPro: string;
  golsContra: string;
  xg: string;
  chutesNoAlvo: string;
  chutesNoAlvoContra: string;
}

export interface Rascunho {
  jogo: { casa: string; fora: string; competicao: string; data: string; hora: string };
  dq: DQ;
  lambda: {
    modo: 'stats' | 'manual';
    manualCasa: string;
    manualFora: string;
    statsCasa: StatsForm;
    statsFora: StatsForm;
    mediaGols: string;
    mando: string;
  };
  linhas: OddLine[];
  conferido: boolean;
  contexto: ContextoAnalise;
  redTeam: { argumentos: string[]; atacaPremissa: boolean; sobreviveu: boolean };
  banca: string;
}

const statsVazio = (): StatsForm => ({
  jogos: '',
  golsPro: '',
  golsContra: '',
  xg: '',
  chutesNoAlvo: '',
  chutesNoAlvoContra: '',
});

export function rascunhoNovo(): Rascunho {
  const hoje = new Date().toISOString().slice(0, 10);
  return {
    jogo: { casa: '', fora: '', competicao: '', data: hoje, hora: '16:00' },
    dq: 'C',
    lambda: {
      modo: 'stats',
      manualCasa: '',
      manualFora: '',
      statsCasa: statsVazio(),
      statsFora: statsVazio(),
      mediaGols: '1.30',
      mando: '1.12',
    },
    linhas: [],
    conferido: false,
    contexto: {},
    redTeam: { argumentos: ['', '', ''], atacaPremissa: false, sobreviveu: false },
    banca: '',
  };
}

export function carregarRascunho(): Rascunho {
  try {
    const s = localStorage.getItem(CHAVE);
    if (s) return { ...rascunhoNovo(), ...(JSON.parse(s) as Rascunho) };
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

export function statsDoForm(f: StatsForm): EstatisticasTime | null {
  const jogos = num(f.jogos);
  const golsPro = num(f.golsPro);
  const golsContra = num(f.golsContra);
  if (jogos === undefined || golsPro === undefined || golsContra === undefined) return null;
  return {
    jogos,
    golsPro,
    golsContra,
    xg: num(f.xg),
    chutesNoAlvo: num(f.chutesNoAlvo),
    chutesNoAlvoContra: num(f.chutesNoAlvoContra),
  };
}

export const inicioIso = (r: Rascunho) => `${r.jogo.data}T${r.jogo.hora}:00${FUSO}`;

export const pct = (x: number | null | undefined, casas = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(casas)}%`;

export const dec = (x: number | null | undefined, casas = 2) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(casas);
