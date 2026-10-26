import { calcularLambdaModelo, type Lambdas } from '@pe/engine';
import { num, statsDoForm, type Rascunho } from './estado';

export type LambdaDoRascunho =
  | { ok: true; lambdas: Lambdas; declaracoes: string[]; priorNeutro: boolean }
  | { ok: false; erro: string };

/** λ do modelo: pelas estatísticas (9.2) ou digitado. Sem dado → erro, nunca valor inventado. */
export function lambdaDoRascunho(r: Rascunho): LambdaDoRascunho {
  const l = r.lambda;
  if (l.modo === 'manual') {
    const casa = num(l.manualCasa);
    const fora = num(l.manualFora);
    if (casa === undefined || fora === undefined || casa <= 0 || fora <= 0)
      return { ok: false, erro: 'informe λ casa e λ fora (> 0)' };
    return {
      ok: true,
      lambdas: { casa, fora },
      declaracoes: ['λ digitado manualmente'],
      priorNeutro: false,
    };
  }
  const casa = statsDoForm(l.statsCasa);
  const fora = statsDoForm(l.statsFora);
  if (!casa || !fora)
    return { ok: false, erro: 'preencha jogos, gols pró e gols contra dos dois times' };
  const res = calcularLambdaModelo(casa, fora, {
    mediaGolsPorTime: num(l.mediaGols),
    mando: num(l.mando),
  });
  return {
    ok: true,
    lambdas: res.lambdas,
    declaracoes: res.declaracoes,
    priorNeutro: res.priorNeutro,
  };
}
