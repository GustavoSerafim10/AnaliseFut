/**
 * Leitor das últimas partidas de um time (lista "Todos | Em casa | Visitante"). Cada jogo vem
 * como "Competição > dia dd mês" + duas linhas "time placar" (mandante em cima). O resultado
 * sai do placar, não da letra do selo (que o OCR troca: "E" vira "B" ou "[="). Jogo cortado no
 * fim do print fica de fora.
 */
import type { NomesTimes, Time } from '@pe/engine';
import { semAcento } from './texto';
import { similaridadeTime } from './times';

export type Resultado = 'V' | 'E' | 'D';

export interface PartidaRecente {
  /** "23 out", como o site mostra */
  data: string;
  adversario: string;
  local: 'casa' | 'fora';
  golsPro: number;
  golsContra: number;
  resultado: Resultado;
}

export interface ResumoUltimas {
  /** da mais recente para a mais antiga */
  partidas: PartidaRecente[];
  forma: Resultado[];
  emCasa: Record<Resultado, number>;
  fora: Record<Resultado, number>;
  golsProPorJogo: number;
  golsContraPorJogo: number;
  avisos: string[];
}

const RE_DATA = /\b(seg|ter|qua|qui|sex|sab|dom)\w*\.?\s+(\d{1,2})\s+([a-z]{3})/;

/** "& Remo E 1 D" → { nome: "Remo", gols: 1 }; sem placar → null */
function linhaTime(linha: string): { nome: string; gols: number } | null {
  const tokens = linha.split(/\s+/).filter(Boolean);
  const gols = tokens
    .map((t) => t.replace(/[[\]().,!|]/g, ''))
    .filter((t) => /^\d{1,2}$/.test(t))
    .map(Number)
    .filter((n) => n <= 15);
  const nome = tokens
    .filter((t) => /[A-Za-zÀ-ú]{3,}/.test(t))
    .map((t) => t.replace(/[^A-Za-zÀ-ú-]/g, ''))
    .join(' ');
  return nome && gols.length ? { nome, gols: gols[gols.length - 1] } : null;
}

function resumir(partidas: PartidaRecente[], avisos: string[]): ResumoUltimas {
  const conta = (local: 'casa' | 'fora') => {
    const r: Record<Resultado, number> = { V: 0, E: 0, D: 0 };
    for (const p of partidas) if (p.local === local) r[p.resultado]++;
    return r;
  };
  const n = partidas.length || 1;
  return {
    partidas,
    forma: partidas.map((p) => p.resultado),
    emCasa: conta('casa'),
    fora: conta('fora'),
    golsProPorJogo: partidas.reduce((s, p) => s + p.golsPro, 0) / n,
    golsContraPorJogo: partidas.reduce((s, p) => s + p.golsContra, 0) / n,
    avisos,
  };
}

/** Lê o print das últimas partidas de UM time do jogo. */
export function lerUltimas(texto: string, jogo: NomesTimes, time: Time): ResumoUltimas {
  const nomeTime = jogo[time];
  const linhas = texto
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const partidas: PartidaRecente[] = [];
  const avisos: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const d = RE_DATA.exec(semAcento(linhas[i]).toLowerCase());
    if (!d) continue;
    const data = `${d[2]} ${d[3]}`;
    const a = linhas[i + 1] ? linhaTime(linhas[i + 1]) : null;
    const b = linhas[i + 2] ? linhaTime(linhas[i + 2]) : null;
    if (!a || !b) {
      avisos.push(`jogo de ${data} cortado ou ilegível: fora do resumo`);
      continue;
    }
    const nosEmCasa = similaridadeTime(a.nome, nomeTime) >= 0.5;
    const nosFora = similaridadeTime(b.nome, nomeTime) >= 0.5;
    if (nosEmCasa === nosFora) {
      avisos.push(`jogo de ${data}: não achei ${nomeTime} ("${a.nome}" × "${b.nome}")`);
      continue;
    }
    const [nos, eles] = nosEmCasa ? [a, b] : [b, a];
    partidas.push({
      data,
      adversario: eles.nome,
      local: nosEmCasa ? 'casa' : 'fora',
      golsPro: nos.gols,
      golsContra: eles.gols,
      resultado: nos.gols > eles.gols ? 'V' : nos.gols === eles.gols ? 'E' : 'D',
    });
    i += 2;
  }
  return resumir(partidas, avisos);
}

/** Vários prints do mesmo time (rolando a lista): junta sem repetir o mesmo jogo. */
export function juntarUltimas(resumos: ResumoUltimas[]): ResumoUltimas | null {
  if (!resumos.length) return null;
  const vistos = new Set<string>();
  const partidas = resumos
    .flatMap((r) => r.partidas)
    .filter((p) => {
      const k = `${p.data}|${p.adversario}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  return resumir(
    partidas,
    resumos.flatMap((r) => r.avisos),
  );
}
