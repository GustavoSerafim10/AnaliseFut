/**
 * Desfecho na régua do motor. A apuração é a do próprio motor (apurarAposta, que usa
 * criarLiquidador): nada de liquidação reescrita. A régua (y, peso) reproduz probEfetiva:
 *   média ponderada de y = (ganho + meioGanho/2) / (ganho + meioGanho/2 + perda + meiaPerda/2)
 *
 * E3: a apuração automática prevalece. Marcação manual nunca vira desfecho; se o placar é
 * apurável e a marcação diverge, o estado é "conflito-manual". Sem placar, é "sem-placar".
 */
import { apurarAposta, criarLiquidador, type LinhaOdd, type PlacarFinal } from '@pe/engine';
import type { PlacarNormalizado } from '../normalizar/jogos';
import type { Desfecho, ResultadoApuracao } from './contratoDerivacoes';

/** A régua: y e peso de cada resultado do motor. */
export function regua(resultado: ResultadoApuracao): Pick<Desfecho, 'y' | 'peso'> {
  switch (resultado) {
    case 1:
      return { y: 1, peso: 1 };
    case 0.5:
      return { y: 1, peso: 0.5 };
    case 0:
      return { y: null, peso: 0 };
    case -0.5:
      return { y: 0, peso: 0.5 };
    case -1:
      return { y: 0, peso: 1 };
  }
}

const placarDoMotor = (p: PlacarNormalizado): PlacarFinal => ({
  casa: p.casa,
  fora: p.fora,
  ...(p.intervalo ? { intervalo: p.intervalo } : {}),
  ...(p.escanteios ? { escanteios: p.escanteios } : {}),
  ...(p.cartoes ? { cartoes: p.cartoes } : {}),
});

/** A marcação manual concorda com o resultado automático? */
const concordaManual = (manual: string, r: ResultadoApuracao) =>
  manual === 'green' ? r > 0 : manual === 'red' ? r < 0 : manual === 'devolvida' ? r === 0 : false;

const vazio = (estado: Desfecho['estado'], motivo: string, manual: string | null): Desfecho => ({
  estado,
  resultado: null,
  y: null,
  peso: 0,
  rotulo: null,
  manual,
  motivo,
});

export function apurarDesfecho(
  linha: LinhaOdd,
  jogo: { placar: PlacarNormalizado | null; conflitoPlacar: boolean },
  manual: string | null = null,
): Desfecho {
  const liq = criarLiquidador(linha);
  if (!liq.ok) return vazio('mercado-desconhecido', liq.motivo, manual);
  if (jogo.conflitoPlacar)
    return vazio('placar-em-conflito', 'entradas do mesmo jogo com placares diferentes', manual);
  if (!jogo.placar) return vazio('sem-placar', 'sem placar registrado', manual);
  const a = apurarAposta(linha, placarDoMotor(jogo.placar));
  if (!a.ok) return vazio('dado-insuficiente', a.falta, manual);
  const resultado = a.resultado as ResultadoApuracao;
  if (manual && !concordaManual(manual, resultado))
    return {
      ...vazio(
        'conflito-manual',
        `apuração automática "${a.rotulo}" × marcação manual "${manual}": a automática prevalece, mas o caso fica para revisão`,
        manual,
      ),
      resultado,
      rotulo: a.rotulo,
    };
  return {
    estado: 'apurado',
    resultado,
    ...regua(resultado),
    rotulo: a.rotulo,
    manual,
    motivo: null,
  };
}
