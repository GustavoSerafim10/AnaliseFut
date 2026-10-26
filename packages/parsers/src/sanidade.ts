/**
 * Checagens de sanidade automáticas para a tela de conferência
 * (odd fora de faixa, margem estranha, linhas fora de ordem, lado sem par).
 */
import { chaveGrupo, normalizarLado, type LinhaOdd, type TipoMercado } from '@pe/engine';

export interface ProblemaLinha {
  indice: number;
  nivel: 'erro' | 'alerta';
  mensagem: string;
}

const LADOS: Partial<Record<TipoMercado, number>> = {
  '1X2': 3,
  DNB: 2,
  AH: 2,
  total: 2,
  total_time: 2,
  ambas: 2,
  par_impar: 2,
};

const PRECISA_LINHA: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'AH',
  'total',
  'total_time',
  'AH_europeu',
]);

export function checarSanidade(linhas: LinhaOdd[]): ProblemaLinha[] {
  const problemas: ProblemaLinha[] = [];
  const add = (indice: number, nivel: ProblemaLinha['nivel'], mensagem: string) =>
    problemas.push({ indice, nivel, mensagem });

  linhas.forEach((l, i) => {
    if (!Number.isFinite(l.odd) || l.odd < 1.01 || l.odd > 100)
      add(i, 'erro', `odd fora da faixa 1,01–100: ${l.odd}`);
    if (PRECISA_LINHA.has(l.mercado) && (l.linha === undefined || !Number.isFinite(l.linha)))
      add(i, 'erro', 'linha obrigatória neste mercado');
    if (l.mercado === 'total_time' && !l.time) add(i, 'erro', 'informar de qual time é o total');
    if (!l.horarioColeta) add(i, 'alerta', 'sem horário de coleta: não serve para o price gate');
  });

  // margem por casa + mercado
  const grupos = new Map<string, number[]>();
  linhas.forEach((l, i) => {
    const k = `${l.casa.toLowerCase()}#${chaveGrupo(l)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), i]);
  });
  for (const idx of grupos.values()) {
    const m = linhas[idx[0]].mercado;
    const esperado = LADOS[m];
    if (esperado === undefined) continue;
    if (idx.length < esperado) {
      idx.forEach((i) =>
        add(
          i,
          'alerta',
          m === 'AH'
            ? 'AH sem o outro lado (conferir sinal da linha)'
            : 'mercado sem todos os lados',
        ),
      );
      continue;
    }
    const margem = idx.reduce((s, i) => s + 1 / linhas[i].odd, 0) - 1;
    if (margem < 0 || margem > 0.3)
      idx.forEach((i) =>
        add(
          i,
          'erro',
          `margem do mercado ${(margem * 100).toFixed(1)}% fora de 0–30%: odd ou lado lido errado`,
        ),
      );
  }

  // ordem das linhas: over sobe com a linha, under desce
  const series = new Map<string, number[]>();
  linhas.forEach((l, i) => {
    if ((l.mercado !== 'total' && l.mercado !== 'total_time') || l.linha === undefined) return;
    const k = `${l.casa.toLowerCase()}#${l.mercado}#${l.periodo}#${l.time ?? '-'}#${normalizarLado(l.lado)}`;
    series.set(k, [...(series.get(k) ?? []), i]);
  });
  for (const idx of series.values()) {
    const ord = [...idx].sort((a, b) => (linhas[a].linha as number) - (linhas[b].linha as number));
    const over = normalizarLado(linhas[ord[0]].lado) === 'over';
    for (let j = 1; j < ord.length; j++) {
      const ant = linhas[ord[j - 1]].odd;
      const atual = linhas[ord[j]].odd;
      if (over ? atual < ant : atual > ant)
        add(
          ord[j],
          'alerta',
          `linhas fora de ordem: ${over ? 'over' : 'under'} ${linhas[ord[j]].linha} @ ${atual} vs ${linhas[ord[j - 1]].linha} @ ${ant}`,
        );
    }
  }
  return problemas;
}
