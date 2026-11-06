/**
 * Múltiplas: várias apostas de jogos diferentes em um bilhete só. As odds se multiplicam, e o
 * bilhete só paga se todas baterem. O resultado vem sozinho dos placares registrados no Histórico;
 * uma perna perdida já encerra o bilhete, mesmo com os outros jogos pendentes.
 */
import { apurarAposta, chaveSelecao, type ApostaBanca, type LinhaOdd } from '@pe/engine';
import type { OddLine } from '@pe/schemas';
import type { EntradaHistorico } from './historico';

const CHAVE = 'pe-multiplas-v1';
const CHAVE_MONTANDO = 'pe-multipla-montando-v1';

export interface PernaMultipla {
  jogo: string;
  inicio: string;
  linha: OddLine;
  descricao: string;
  odd: number;
  casa: string;
  chanceGreen: number;
  ev: number;
  /** false = o site não tem estimativa de chance para esta aposta */
  temEstimativa: boolean;
}

export interface Multipla {
  id: string;
  criadaEm: string;
  /** a odd total que o usuário pegou na casa */
  odd: number;
  casa: string;
  valor?: number;
  pernas: PernaMultipla[];
}

function ler<T>(chave: string): T[] {
  try {
    const s = localStorage.getItem(chave);
    const lista = s ? (JSON.parse(s) as T[]) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

function gravar<T>(chave: string, lista: T[]): boolean {
  try {
    localStorage.setItem(chave, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  }
}

export const carregarMultiplas = () => ler<Multipla>(CHAVE);
export const gravarMultiplas = (l: Multipla[]) => gravar(CHAVE, l);
export const carregarMontando = () => ler<PernaMultipla>(CHAVE_MONTANDO);
export const gravarMontando = (l: PernaMultipla[]) => gravar(CHAVE_MONTANDO, l);

/** Identifica a aposta na casa, como em registradas e na lista de opções. */
export const chaveDaPerna = (p: Pick<PernaMultipla, 'casa' | 'linha'>) =>
  `${p.casa.trim().toLowerCase()}#${chaveSelecao(p.linha as LinhaOdd)}`;

/** Duas apostas do mesmo jogo não são independentes: a conta da múltipla deixaria de valer. */
export function juntarPerna(
  pernas: PernaMultipla[],
  nova: PernaMultipla,
): { pernas: PernaMultipla[]; erro?: string } {
  const doJogo = (p: PernaMultipla) => p.jogo === nova.jogo && p.inicio === nova.inicio;
  if (pernas.some(doJogo))
    return {
      pernas,
      erro: `Já há uma aposta de ${nova.jogo} na múltipla. Apostas do mesmo jogo costumam ganhar ou perder juntas, e a casa paga outra odd para elas. Remova a anterior para trocar.`,
    };
  return { pernas: [...pernas, nova] };
}

export interface ResumoMultipla {
  odd: number;
  /** chance de todas baterem; null se alguma perna não tem estimativa */
  chance: number | null;
  /** acerto mínimo para a odd total não dar prejuízo */
  minimo: number;
  /** resultado médio por unidade pela chance do site; null se alguma não tem estimativa */
  ev: number | null;
}

const arredondar = (x: number) => Math.round(x * 100) / 100;

export function resumirMultipla(pernas: PernaMultipla[]): ResumoMultipla {
  const todas = pernas.every((p) => p.temEstimativa);
  const odd = arredondar(pernas.reduce((s, p) => s * p.odd, 1));
  return {
    odd,
    chance: todas ? pernas.reduce((s, p) => s * p.chanceGreen, 1) : null,
    minimo: 1 / odd,
    ev: todas ? pernas.reduce((s, p) => s * (1 + p.ev), 1) - 1 : null,
  };
}

export type SituacaoPerna = 'green' | 'red' | 'devolvida' | 'meio-green' | 'meio-red' | 'pendente';

export interface ApuracaoMultipla {
  situacao: 'green' | 'red' | 'devolvida' | 'pendente';
  /** lucro por unidade apostada, quando encerrada */
  lucro?: number;
  pernas: { situacao: SituacaoPerna; falta?: string }[];
  apuradaEm?: string;
}

const NOME: Record<string, SituacaoPerna> = {
  '1': 'green',
  '0.5': 'meio-green',
  '0': 'devolvida',
  '-0.5': 'meio-red',
  '-1': 'red',
};

/** Quanto a perna multiplica o bilhete: devolvida vale 1; meio resultado, metade do caminho. */
function fator(resultado: number, odd: number): number {
  if (resultado === 1) return odd;
  if (resultado === 0.5) return (1 + odd) / 2;
  if (resultado === 0) return 1;
  if (resultado === -0.5) return 0.5;
  return 0;
}

export function apurarMultipla(m: Multipla, historico: EntradaHistorico[]): ApuracaoMultipla {
  let retorno = 1;
  let oddsLidas = 1;
  let faltando = false;
  let perdeu = false;
  let apuradaEm: string | undefined;
  const pernas = m.pernas.map((p): ApuracaoMultipla['pernas'][number] => {
    oddsLidas *= p.odd;
    const e = historico.find(
      (x) =>
        x.resumo.jogo === p.jogo &&
        x.resumo.inicio === p.inicio &&
        Number.isFinite(x.resultado?.casa) &&
        Number.isFinite(x.resultado?.fora),
    );
    if (!e?.resultado) {
      faltando = true;
      return { situacao: 'pendente', falta: 'registrar o placar deste jogo no Histórico' };
    }
    const a = apurarAposta({ ...p.linha, odd: p.odd } as LinhaOdd, e.resultado);
    if (!a.ok) {
      faltando = true;
      return { situacao: 'pendente', falta: a.falta };
    }
    if (a.resultado === -1) perdeu = true;
    retorno *= fator(a.resultado, p.odd);
    if (e.resultado.registradoEm > (apuradaEm ?? '')) apuradaEm = e.resultado.registradoEm;
    return { situacao: NOME[String(a.resultado)] ?? 'pendente' };
  });
  if (perdeu) return { situacao: 'red', lucro: -1, pernas, apuradaEm };
  if (faltando) return { situacao: 'pendente', pernas };
  // a casa pode ter pago uma odd total diferente do produto: vale a que o usuário pegou
  const lucro = retorno * (m.odd / oddsLidas) - 1;
  return {
    situacao: Math.abs(lucro) < 1e-9 ? 'devolvida' : lucro > 0 ? 'green' : 'red',
    lucro,
    pernas,
    apuradaEm,
  };
}

export interface BalancoMultiplas {
  total: number;
  pendentes: number;
  green: number;
  red: number;
  devolvidas: number;
  unidades: number;
}

export function balancoMultiplas(lista: Multipla[], historico: EntradaHistorico[]): BalancoMultiplas {
  const b: BalancoMultiplas = {
    total: lista.length,
    pendentes: 0,
    green: 0,
    red: 0,
    devolvidas: 0,
    unidades: 0,
  };
  for (const m of lista) {
    const a = apurarMultipla(m, historico);
    if (a.situacao === 'pendente') b.pendentes++;
    else if (a.situacao === 'green') b.green++;
    else if (a.situacao === 'red') b.red++;
    else b.devolvidas++;
    b.unidades += a.lucro ?? 0;
  }
  return b;
}

/** As múltiplas com valor em R$ também mexem na banca e nas travas. */
export function apostasDeMultiplas(
  lista: Multipla[],
  historico: EntradaHistorico[],
): ApostaBanca[] {
  return lista
    .filter((m) => (m.valor ?? 0) > 0)
    .map((m) => {
      const a = apurarMultipla(m, historico);
      return {
        feitaEm: m.criadaEm,
        stake: m.valor!,
        lucro: a.lucro,
        apuradaEm: a.apuradaEm,
      };
    });
}

/** Junta as múltiplas de um backup às deste aparelho: as que já existem aqui ficam. */
export function juntarMultiplas(atuais: Multipla[], novas: Multipla[]): Multipla[] {
  const ids = new Set(atuais.map((m) => m.id));
  return [...atuais, ...novas.filter((m) => !ids.has(m.id))];
}
