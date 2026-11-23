/**
 * Tipo de aposta de uma linha, pelo liquidador que o MOTOR usaria (criarLiquidador): é ele que
 * define o modelo de probabilidade daquele mercado. Mercados de nível 3 (escanteios e cartões)
 * formam o grupo "nicho", sempre analisado à parte dos principais.
 */
import { chaveGrupo, chaveSelecao, criarLiquidador, type LinhaOdd } from '@pe/engine';

export type TipoAposta =
  /** placar do jogo todo (1X2, totais, handicap, ambas...) */
  | 'gols-jogo'
  /** placar do 1º ou do 2º tempo */
  | 'gols-tempo'
  /** os dois tempos combinados (intervalo/final, marcar nos dois tempos) */
  | 'tempos'
  /** 1º ou último gol */
  | 'sequencia'
  /** escanteios e cartões (contagem) */
  | 'contagem'
  /** 1º escanteio */
  | 'primeira-contagem'
  /** o motor não sabe liquidar esta linha */
  | 'desconhecido';

export interface ClasseMercado {
  mercado: string;
  periodo: string;
  tipoAposta: TipoAposta;
  nivel: 1 | 2 | 3 | null;
  grupo: 'principal' | 'nicho' | null;
  /** chave da seleção (mercado|período|time|linha|lado), a mesma da V4 */
  chave: string;
  /** chave do grupo de mercado: os lados complementares compartilham esta chave */
  chaveGrupo: string;
  motivo?: string;
}

export function classificarMercado(l: LinhaOdd): ClasseMercado {
  const base = {
    mercado: l.mercado,
    periodo: l.periodo,
    chave: chaveSelecao(l),
    chaveGrupo: chaveGrupo(l),
  };
  const r = criarLiquidador(l);
  if (!r.ok)
    return { ...base, tipoAposta: 'desconhecido', nivel: r.nivel, grupo: null, motivo: r.motivo };
  const grupo = r.nivel === 3 ? 'nicho' : 'principal';
  const tipoAposta: TipoAposta =
    r.liq.tipo === 'placar'
      ? r.liq.periodo === 'FT'
        ? 'gols-jogo'
        : 'gols-tempo'
      : r.liq.tipo === 'tempos'
        ? 'tempos'
        : r.liq.tipo === 'sequencia'
          ? 'sequencia'
          : r.liq.tipo === 'contagem'
            ? 'contagem'
            : 'primeira-contagem';
  return { ...base, tipoAposta, nivel: r.nivel, grupo };
}
