/**
 * V4.0 S1/S2 e regra 20.1 — movimento de linha entre prints da mesma casa.
 * Atraso = a referência afiada encurtou a odd e uma casa mole continua no preço antigo:
 * é exatamente a janela que a V4.0 procura. Se a própria casa mole já se moveu a favor da
 * tese, está no preço (PASS).
 */
import { descreverAposta } from './descricao';
import { chaveSelecao } from './precificacao';
import type { LinhaOdd, NomesTimes } from './tipos';
import { ehAfiada } from './v4';

/** variação mínima da odd para contar como movimento */
export const MOVIMENTO_MINIMO = 0.03;

export interface Movimento {
  chave: string;
  descricao: string;
  casa: string;
  de: number;
  para: number;
  horarioDe: string;
  horarioPara: string;
}

export interface Atraso {
  movimento: Movimento;
  casaMole: string;
  oddMole: number;
  horarioMole?: string;
}

/** `versoes`: todas as leituras de todos os prints, SEM juntar duplicadas. */
export function detectarMovimentos(
  versoes: LinhaOdd[],
  nomes: NomesTimes,
): { movimentos: Movimento[]; atrasos: Atraso[] } {
  const grupos = new Map<string, LinhaOdd[]>();
  for (const l of versoes) {
    if (!l.horarioColeta) continue;
    const k = `${l.casa.trim().toLowerCase()}#${chaveSelecao(l)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const movimentos: Movimento[] = [];
  const ultimaPorSelecao = new Map<string, LinhaOdd[]>();
  for (const ls of grupos.values()) {
    const ord = [...ls].sort((a, b) => a.horarioColeta!.localeCompare(b.horarioColeta!));
    const [ini, fim] = [ord[0], ord[ord.length - 1]];
    const chave = chaveSelecao(fim);
    ultimaPorSelecao.set(chave, [...(ultimaPorSelecao.get(chave) ?? []), fim]);
    if (ini.horarioColeta === fim.horarioColeta) continue;
    if (Math.abs(fim.odd / ini.odd - 1) < MOVIMENTO_MINIMO) continue;
    movimentos.push({
      chave,
      descricao: descreverAposta(fim, nomes).replace('Ganha se: ', ''),
      casa: fim.casa,
      de: ini.odd,
      para: fim.odd,
      horarioDe: ini.horarioColeta!,
      horarioPara: fim.horarioColeta!,
    });
  }
  const atrasos: Atraso[] = [];
  for (const m of movimentos) {
    if (!ehAfiada(m.casa) || m.para >= m.de) continue;
    for (const l of ultimaPorSelecao.get(m.chave) ?? []) {
      if (ehAfiada(l.casa)) continue;
      // a casa mole segue pagando (quase) o preço de antes do movimento da referência
      if (l.odd >= m.de * (1 - MOVIMENTO_MINIMO / 3))
        atrasos.push({
          movimento: m,
          casaMole: l.casa,
          oddMole: l.odd,
          horarioMole: l.horarioColeta,
        });
    }
  }
  return { movimentos, atrasos };
}
