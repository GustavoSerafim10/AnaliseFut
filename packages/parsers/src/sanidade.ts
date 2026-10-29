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
  escanteios_total: 2,
  escanteios_time: 2,
  escanteios_ah: 2,
  escanteios_1x2: 3,
  cartoes_total: 2,
  cartoes_time: 2,
  cartoes_ah: 2,
  cartoes_1x2: 3,
};

const PRECISA_LINHA: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'AH',
  'total',
  'total_time',
  'AH_europeu',
  'escanteios_total',
  'escanteios_time',
  'escanteios_ah',
  'cartoes_total',
  'cartoes_time',
  'cartoes_ah',
]);
const POR_TIME: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'total_time',
  'escanteios_time',
  'cartoes_time',
]);
/** maior linha que existe de verdade (gols): acima disso é OCR ("1,5" → "13,5") */
const LINHA_MAXIMA: Partial<Record<TipoMercado, number>> = {
  total: 7.5,
  total_time: 5.5,
  AH: 4,
  AH_europeu: 4,
};

const HANDICAPS: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'AH',
  'escanteios_ah',
  'cartoes_ah',
]);

const TOTAIS: ReadonlySet<TipoMercado> = new Set<TipoMercado>([
  'total',
  'escanteios_total',
  'cartoes_total',
  ...POR_TIME,
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
    if (POR_TIME.has(l.mercado) && !l.time) add(i, 'erro', 'informar de qual time é o total');
    if (!l.horarioColeta) add(i, 'alerta', 'sem horário de coleta: não serve para o price gate');
    // linha de gols impossível: "1,5" lido como "13,5"
    const max = LINHA_MAXIMA[l.mercado];
    if (max !== undefined && l.linha !== undefined && Math.abs(l.linha) > max)
      add(i, 'erro', `linha ${l.linha} impossível neste mercado (máx. ±${max}): lida errado?`);
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
          m === 'AH' || m === 'escanteios_ah' || m === 'cartoes_ah'
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

  // primeiro gol tem de seguir o favorito do 1X2: favorito claro (odd 1X2 bem menor) com odd
  // maior para marcar primeiro é lado trocado na leitura (Bragantino 70% "@ 2.88" para marcar
  // primeiro era a odd da Chapecoense) → erro, sai da análise
  const odd = (casa: string, mercado: string, lado: string) =>
    linhas.findIndex(
      (l) =>
        l.casa.toLowerCase() === casa &&
        l.mercado === mercado &&
        l.periodo === 'FT' &&
        normalizarLado(l.lado) === lado,
    );
  for (const casa of new Set(linhas.map((l) => l.casa.toLowerCase()))) {
    // "sem gol" é sempre o menos provável dos três: time com odd ≥ a dele é odd trocada
    // (São Paulo "@ 13" para marcar primeiro era a odd de sem gol)
    const pn = odd(casa, 'primeiro_gol', 'nenhum');
    for (const lado of ['casa', 'fora'])
      for (const mercado of ['primeiro_gol', 'ultimo_gol']) {
        const i = odd(casa, mercado, lado);
        const n = mercado === 'primeiro_gol' ? pn : odd(casa, mercado, 'nenhum');
        if (i >= 0 && n >= 0 && linhas[i].odd >= linhas[n].odd)
          [i, n].forEach((k) =>
            add(
              k,
              'erro',
              `${mercado === 'primeiro_gol' ? 'primeiro' : 'último'} gol: ${lado} @ ${linhas[i].odd} não pode pagar o mesmo ou mais que "sem gol" @ ${linhas[n].odd}: odd trocada na leitura?`,
            ),
          );
      }
    const [c1, c2] = [odd(casa, '1X2', '1'), odd(casa, '1X2', '2')];
    const [p1, p2] = [odd(casa, 'primeiro_gol', 'casa'), odd(casa, 'primeiro_gol', 'fora')];
    if ([c1, c2, p1, p2].some((i) => i < 0)) continue;
    const favCasa = linhas[c1].odd * 1.25 < linhas[c2].odd;
    const favFora = linhas[c2].odd * 1.25 < linhas[c1].odd;
    const invertido =
      (favCasa && linhas[p1].odd > linhas[p2].odd) || (favFora && linhas[p2].odd > linhas[p1].odd);
    if (invertido)
      [p1, p2].forEach((i) =>
        add(
          i,
          'erro',
          `primeiro gol contra o favorito do 1X2 (1X2 ${linhas[c1].odd} × ${linhas[c2].odd}, primeiro gol ${linhas[p1].odd} × ${linhas[p2].odd}): lados trocados na leitura?`,
        ),
      );
  }

  // ordem das linhas: over sobe com a linha, under desce
  const series = new Map<string, number[]>();
  linhas.forEach((l, i) => {
    if (!TOTAIS.has(l.mercado) || l.linha === undefined) return;
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

  // handicap: quanto mais a linha ajuda o lado apostado, menor a odd. "Fiorentina -3.5 @ 1.85"
  // junto de "-1.5 @ 2.32" é impossível (era o handicap de CHUTES lido como de escanteios) → erro
  const handicaps = new Map<string, number[]>();
  linhas.forEach((l, i) => {
    if (!HANDICAPS.has(l.mercado) || l.linha === undefined) return;
    const k = `${l.casa.toLowerCase()}#${l.mercado}#${l.periodo}#${normalizarLado(l.lado)}`;
    handicaps.set(k, [...(handicaps.get(k) ?? []), i]);
  });
  for (const idx of handicaps.values()) {
    const ord = [...idx].sort((a, b) => (linhas[a].linha as number) - (linhas[b].linha as number));
    for (let j = 1; j < ord.length; j++) {
      const [a, b] = [linhas[ord[j - 1]], linhas[ord[j]]];
      if (b.linha !== a.linha && b.odd > a.odd)
        [ord[j - 1], ord[j]].forEach((i) =>
          add(
            i,
            'erro',
            `handicap fora de ordem: ${a.linha} @ ${a.odd} e ${b.linha} @ ${b.odd} (a linha mais fácil não pode pagar mais): uma das duas foi lida errado`,
          ),
        );
    }
  }
  return problemas;
}
