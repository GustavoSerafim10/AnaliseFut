/**
 * V4.0 seção 6 — travas automáticas da banca, calculadas a partir das apostas registradas.
 * Nunca aumenta stake para recuperar perda: as travas só reduzem ou bloqueiam.
 */

export const TETO_DIA = 0.06;
export const DRAWDOWN_REDUZ = 0.2;
export const DRAWDOWN_PAUSA = 0.3;
export const DIAS_PAUSA = 7;
export const PERDAS_ENCERRAM_DIA = 5;

export interface ApostaBanca {
  /** quando a aposta foi feita (ISO) */
  feitaEm: string;
  /** valor apostado em R$ */
  stake: number;
  /** lucro por unidade apostada, quando já apurada */
  lucro?: number;
  /** quando o resultado foi registrado (ISO) */
  apuradaEm?: string;
}

export interface TravasBanca {
  bancaInicial: number;
  bancaAtual: number;
  pico: number;
  drawdown: number;
  /** multiplicador das frações de Kelly (0,5 com drawdown ≥ 20%) */
  fatorKelly: number;
  /** ISO até quando as apostas estão pausadas (drawdown ≥ 30%) */
  pausadoAte: string | null;
  perdasHoje: number;
  diaEncerrado: boolean;
  /** fração da banca atual já apostada hoje */
  expostoHoje: number;
  motivos: string[];
}

const dia = (iso: string) => iso.slice(0, 10);

export function calcularTravas(
  bancaInicial: number,
  apostas: ApostaBanca[],
  /** ISO local do momento atual */
  agora: string,
): TravasBanca {
  const motivos: string[] = [];
  const apuradas = apostas
    .filter((a) => a.lucro !== undefined)
    .sort((a, b) => (a.apuradaEm ?? a.feitaEm).localeCompare(b.apuradaEm ?? b.feitaEm));
  let banca = bancaInicial;
  let pico = bancaInicial;
  let pausadoAte: string | null = null;
  for (const a of apuradas) {
    banca += a.stake * (a.lucro as number);
    pico = Math.max(pico, banca);
    if (pico > 0 && (pico - banca) / pico >= DRAWDOWN_PAUSA) {
      const t = new Date(Date.parse(a.apuradaEm ?? a.feitaEm) + DIAS_PAUSA * 86_400_000);
      pausadoAte = t.toISOString();
    }
  }
  const drawdown = pico > 0 ? Math.max(0, (pico - banca) / pico) : 0;
  const pausado = pausadoAte !== null && Date.parse(agora) < Date.parse(pausadoAte);
  if (pausado)
    motivos.push(
      `drawdown chegou a ${(DRAWDOWN_PAUSA * 100).toFixed(0)}%: pausa de ${DIAS_PAUSA} dias até ${pausadoAte!.slice(0, 10)} e revisão do registro`,
    );
  const fatorKelly = drawdown >= DRAWDOWN_REDUZ ? 0.5 : 1;
  if (fatorKelly < 1)
    motivos.push(`drawdown de ${(drawdown * 100).toFixed(1)}% ≥ 20%: frações de Kelly pela metade`);

  const hoje = dia(agora);
  const perdasHoje = apuradas.filter(
    (a) => dia(a.apuradaEm ?? a.feitaEm) === hoje && (a.lucro as number) < 0,
  ).length;
  const diaEncerrado = perdasHoje >= PERDAS_ENCERRAM_DIA;
  if (diaEncerrado) motivos.push(`${perdasHoje} perdas hoje: dia encerrado`);
  const apostadoHoje = apostas
    .filter((a) => dia(a.feitaEm) === hoje)
    .reduce((s, a) => s + a.stake, 0);
  const expostoHoje = banca > 0 ? apostadoHoje / banca : 1;
  if (expostoHoje >= TETO_DIA)
    motivos.push(`já apostado hoje ${(expostoHoje * 100).toFixed(1)}% da banca (teto 6%)`);

  return {
    bancaInicial,
    bancaAtual: banca,
    pico,
    drawdown,
    fatorKelly,
    pausadoAte: pausado ? pausadoAte : null,
    perdasHoje,
    diaEncerrado,
    expostoHoje,
    motivos,
  };
}
