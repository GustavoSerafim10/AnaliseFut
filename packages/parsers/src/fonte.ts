/** Detecção automática do site/casa pelo texto do print. */
import { semAcento } from './texto';

export type FonteDetectada = '1win' | 'sofascore' | 'superscore' | 'flashscore' | 'desconhecida';

const PISTAS: Record<
  Exclude<FonteDetectada, 'desconhecida'>,
  { marca: RegExp; pistas: RegExp[] }
> = {
  '1win': {
    marca: /\b1\s?win\b/,
    pistas: [/resultado do tempo regulamentar/, /abaixo de/, /acima de/, /\bv1\b/, /\bv2\b/],
  },
  sofascore: {
    marca: /sofascore/,
    pistas: [/gols esperados|expected goals/, /grandes chances|big chances/, /mapa de calor/],
  },
  superscore: { marca: /superscore/, pistas: [/palpites/, /estatisticas da equipe/] },
  flashscore: {
    marca: /flashscore/,
    pistas: [/\bh2h\b/, /resumo do jogo|resumo da partida/, /classificacao ao vivo/],
  },
};

export function detectarFonte(texto: string): { fonte: FonteDetectada; pontos: number } {
  const t = semAcento(texto);
  let melhor: FonteDetectada = 'desconhecida';
  let melhorPontos = 0;
  for (const [fonte, p] of Object.entries(PISTAS) as [
    Exclude<FonteDetectada, 'desconhecida'>,
    (typeof PISTAS)['1win'],
  ][]) {
    const pontos = (p.marca.test(t) ? 3 : 0) + p.pistas.filter((r) => r.test(t)).length;
    if (pontos > melhorPontos) {
      melhor = fonte;
      melhorPontos = pontos;
    }
  }
  return melhorPontos >= 2
    ? { fonte: melhor, pontos: melhorPontos }
    : { fonte: 'desconhecida', pontos: melhorPontos };
}
