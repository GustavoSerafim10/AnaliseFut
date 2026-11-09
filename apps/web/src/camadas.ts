/**
 * As duas camadas do Histórico, cada uma com a sua pergunta e os seus números:
 * - Melhores entradas: a lista de alta chance (odds 1,40–2,00). Mede acerto × chance prometida.
 * - BET: a decisão técnica da V4 (preço contra a referência). Mede CLV, EV e ROI.
 * Um jogo pode estar nas duas: nada aqui soma uma camada com a outra.
 */
import { apurarAposta, chaveSelecao, type LinhaOdd, type TipoMercado } from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import {
  apostasDoJogo,
  apurar,
  clvDe,
  FAIXAS_ACERTO,
  oddDe,
  temPlacar,
  type EntradaHistorico,
  type Situacao,
} from './historico';

export type Camada = 'melhores' | 'bet';
/** primeira: 1ª da lista de cada jogo (amostra limpa); todas: a lista inteira; entrei: só as feitas */
export type RecorteMelhores = 'primeira' | 'todas' | 'entrei';
export type RecorteBet = 'todas' | 'entrei';

export interface ItemCamada {
  id: string;
  jogo: string;
  data: string;
  descricao: string;
  familia: string;
  odd: number;
  casa: string;
  /** chance estimada na hora da análise */
  chance: number;
  /** chance que a odd pede para empatar (1 ÷ odd, ou o mínimo da lista) */
  minimo: number;
  ev: number | null;
  clv: number | null;
  forte: boolean;
  entrou: boolean;
  situacao: Situacao;
  lucro: number;
}

/** Nome curto de cada família de mercado. */
export function familiaMercado(m: TipoMercado): string {
  if (m.startsWith('escanteios') || m === 'primeiro_escanteio') return 'Escanteios';
  if (m.startsWith('cartoes')) return 'Cartões';
  const nomes: Partial<Record<TipoMercado, string>> = {
    '1X2': '1X2',
    DC: 'Dupla chance',
    DNB: 'Empate anula',
    AH: 'Handicap',
    total: 'Gols',
    total_time: 'Gols por time',
    ambas: 'Ambas marcam',
    primeiro_gol: '1º gol',
  };
  return nomes[m] ?? 'Outros';
}

const chaveDe = (l: OddLine) => chaveSelecao(l as LinhaOdd);
const situacaoDe = (r: number): Situacao => (r > 0 ? 'green' : r < 0 ? 'red' : 'devolvida');

/** A aposta deste jogo feita nesta seleção, se houve. */
function apostaNaSelecao(lista: EntradaHistorico[], raiz: EntradaHistorico, k: string) {
  return apostasDoJogo(lista, raiz.id).find(
    (x) => x.resumo.entrada && chaveDe(x.resumo.entrada.linha) === k,
  );
}

export function itensMelhores(lista: EntradaHistorico[], recorte: RecorteMelhores): ItemCamada[] {
  const saida: ItemCamada[] = [];
  for (const e of lista) {
    if (e.irmaDe) continue;
    (e.resumo.confianca ?? []).forEach((c, i) => {
      if (recorte === 'primeira' && i > 0) return;
      const k = chaveDe(c.linha);
      const feita = apostaNaSelecao(lista, e, k);
      if (recorte === 'entrei' && !feita) return;
      // a lista vale pela odd sugerida; "só onde entrei" vale pela odd que você pegou
      const odd = recorte === 'entrei' && feita ? oddDe(feita) : c.odd;
      const pelaPartida =
        e.resultado && temPlacar(e)
          ? apurarAposta({ ...c.linha, odd } as LinhaOdd, e.resultado)
          : null;
      const marcada =
        feita ?? (e.resumo.entrada && chaveDe(e.resumo.entrada.linha) === k ? e : undefined);
      const a = pelaPartida?.ok ? pelaPartida : marcada ? apurar(marcada) : null;
      const resolvida = a?.ok ? a : null;
      saida.push({
        id: `${e.id}#${i}`,
        jogo: e.resumo.jogo,
        data: e.resumo.inicio.slice(0, 10),
        descricao: c.descricao,
        familia: familiaMercado(c.linha.mercado as TipoMercado),
        odd,
        casa: feita?.aposta?.casa ?? c.casa,
        chance: c.chance,
        minimo: c.minimo,
        ev: null,
        clv: feita ? clvDe(feita) : null,
        forte: c.forca === 'forte',
        entrou: !!feita,
        situacao: resolvida ? situacaoDe(resolvida.resultado) : 'pendente',
        lucro: !resolvida
          ? 0
          : pelaPartida?.ok
            ? resolvida.lucro
            : resolvida.resultado > 0
              ? odd - 1
              : resolvida.resultado,
      });
    });
  }
  return saida;
}

export function itensBet(lista: EntradaHistorico[], recorte: RecorteBet): ItemCamada[] {
  const saida: ItemCamada[] = [];
  for (const e of lista) {
    const ent = e.resumo.entrada;
    if (e.irmaDe || e.resumo.decisao !== 'BET' || !ent) continue;
    // entrou em outra aposta do jogo: a seleção do BET original não ficou guardada
    if (e.aposta?.entrada && !e.aposta.entrada.nivel) continue;
    if (recorte === 'entrei' && !e.aposta) continue;
    const a = apurar(e);
    saida.push({
      id: e.id,
      jogo: e.resumo.jogo,
      data: e.resumo.inicio.slice(0, 10),
      descricao: ent.descricao,
      familia: familiaMercado(ent.linha.mercado as TipoMercado),
      odd: oddDe(e),
      casa: e.aposta?.casa ?? ent.casa,
      chance: ent.pFinal,
      minimo: 1 / oddDe(e),
      ev: ent.ev,
      clv: clvDe(e),
      forte: false,
      entrou: !!e.aposta,
      situacao: a?.ok ? situacaoDe(a.resultado) : 'pendente',
      lucro: a?.ok ? a.lucro : 0,
    });
  }
  return saida;
}

export interface PontoCamada {
  id: string;
  jogo: string;
  data: string;
  lucro: number;
  acumulado: number;
}

export interface ResumoCamada {
  total: number;
  apuradas: number;
  green: number;
  red: number;
  devolvidas: number;
  pendentes: number;
  /** green ÷ (green + red) */
  acerto: number | null;
  /** chance média prometida e a que a odd pedia, nas apostas com green ou red */
  prometido: number | null;
  pedia: number | null;
  unidades: number;
  roi: number | null;
  oddMedia: number | null;
  evMedio: number | null;
  clvMedio: number | null;
  nClv: number;
  /** resultado desse tamanho ou melhor, só por sorte, acertando apenas o que a odd pede */
  sorte: number | null;
  curva: PontoCamada[];
  /** apuradas, da mais antiga para a mais recente */
  apuradasEmOrdem: ItemCamada[];
}

/** P(X ≥ k) em n tentativas independentes com chance p. */
export function caudaBinomial(n: number, k: number, p: number): number {
  let termo = (1 - p) ** n;
  let soma = k <= 0 ? termo : 0;
  for (let i = 1; i <= n; i++) {
    termo *= ((n - i + 1) / i) * (p / (1 - p));
    if (i >= k) soma += termo;
  }
  return Math.min(1, soma);
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function resumirCamada(itens: ItemCamada[]): ResumoCamada {
  const ordem = [...itens].sort((a, b) => a.data.localeCompare(b.data));
  const feitas = ordem.filter((i) => i.situacao !== 'pendente');
  const decididas = feitas.filter((i) => i.situacao !== 'devolvida');
  const green = feitas.filter((i) => i.situacao === 'green').length;
  const red = feitas.filter((i) => i.situacao === 'red').length;
  let acumulado = 0;
  const curva = feitas.map((i) => {
    acumulado += i.lucro;
    return { id: i.id, jogo: i.jogo, data: i.data, lucro: i.lucro, acumulado };
  });
  const pedia = media(decididas.map((i) => i.minimo));
  const clvs = itens.flatMap((i) => (i.clv === null ? [] : [i.clv]));
  return {
    total: itens.length,
    apuradas: feitas.length,
    green,
    red,
    devolvidas: feitas.length - green - red,
    pendentes: itens.length - feitas.length,
    acerto: decididas.length ? green / decididas.length : null,
    prometido: media(decididas.map((i) => i.chance)),
    pedia,
    unidades: acumulado,
    roi: feitas.length ? acumulado / feitas.length : null,
    oddMedia: media(feitas.map((i) => i.odd)),
    evMedio: media(itens.flatMap((i) => (i.ev === null ? [] : [i.ev]))),
    clvMedio: media(clvs),
    nClv: clvs.length,
    sorte: pedia === null ? null : caudaBinomial(decididas.length, green, pedia),
    curva,
    apuradasEmOrdem: feitas,
  };
}

export interface LinhaPrometido {
  nome: string;
  n: number;
  green: number;
  red: number;
  acerto: number;
  prometido: number;
  pedia: number;
}

/** Prometido × real, só nas faixas de chance que já têm green ou red. */
export function prometidoPorFaixa(itens: ItemCamada[]): LinhaPrometido[] {
  return FAIXAS_ACERTO.flatMap(([nome, de, ate]) => {
    const f = itens.filter(
      (i) => (i.situacao === 'green' || i.situacao === 'red') && i.chance >= de && i.chance < ate,
    );
    if (!f.length) return [];
    const green = f.filter((i) => i.situacao === 'green').length;
    return [
      {
        nome,
        n: f.length,
        green,
        red: f.length - green,
        acerto: green / f.length,
        prometido: media(f.map((i) => i.chance))!,
        pedia: media(f.map((i) => i.minimo))!,
      },
    ];
  });
}

export const COLUNAS_ODD: [string, number, number][] = [
  ['até 1,59', 0, 1.6],
  ['1,60–1,79', 1.6, 1.8],
  ['1,80–1,99', 1.8, 2],
  ['2,00 ou mais', 2, Infinity],
];

export interface CelulaCalor {
  green: number;
  red: number;
  devolvidas: number;
  unidades: number;
}

export interface LinhaCalor {
  familia: string;
  celulas: (CelulaCalor | null)[];
}

/** Mercado × faixa de odd; só as linhas com aposta apurada, da maior amostra para a menor. */
export function mapaDeCalor(itens: ItemCamada[]): LinhaCalor[] {
  const feitas = itens.filter((i) => i.situacao !== 'pendente');
  return [...new Set(feitas.map((i) => i.familia))]
    .map((familia) => {
      const daFamilia = feitas.filter((i) => i.familia === familia);
      return {
        familia,
        n: daFamilia.length,
        celulas: COLUNAS_ODD.map(([, de, ate]) => {
          const f = daFamilia.filter((i) => i.odd >= de && i.odd < ate);
          if (!f.length) return null;
          return {
            green: f.filter((i) => i.situacao === 'green').length,
            red: f.filter((i) => i.situacao === 'red').length,
            devolvidas: f.filter((i) => i.situacao === 'devolvida').length,
            unidades: f.reduce((s, i) => s + i.lucro, 0),
          };
        }),
      };
    })
    .sort((a, b) => b.n - a.n)
    .map(({ familia, celulas }) => ({ familia, celulas }));
}

/** A aposta do histórico é da lista "Melhores entradas" daquele jogo? */
export function ehMelhorEntrada(lista: EntradaHistorico[], e: EntradaHistorico): boolean {
  const ent = e.resumo.entrada;
  if (!ent) return false;
  const raiz = e.irmaDe ? lista.find((x) => x.id === e.irmaDe) : e;
  const k = chaveDe(ent.linha);
  return !!raiz?.resumo.confianca?.some((c) => chaveDe(c.linha) === k);
}
