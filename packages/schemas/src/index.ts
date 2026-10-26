/**
 * Schemas zod compartilhados: tudo que entra no motor (OCR, JSON importado ou digitado)
 * passa por aqui antes. Dado inválido é rejeitado com mensagem, nunca "consertado".
 */
import { MERCADOS } from '@pe/engine';
import { z } from 'zod';

export const PeriodoSchema = z.enum(['FT', '1T', '2T']);
export const TimeSchema = z.enum(['casa', 'fora']);
export const FonteLeituraSchema = z.enum(['ocr', 'json', 'manual']);

export const OddLineSchema = z.object({
  casa: z.string().trim().min(1, 'casa de apostas obrigatória'),
  mercado: z.enum(MERCADOS),
  linha: z.number().finite().optional(),
  lado: z.string().trim().min(1, 'lado obrigatório'),
  odd: z.number().gt(1, 'odd deve ser > 1').lt(1000),
  /** ISO 8601 */
  horarioColeta: z.string().optional(),
  periodo: PeriodoSchema.default('FT'),
  time: TimeSchema.optional(),
  /** de onde veio a leitura e quão confiável foi (0–1) */
  fonte: FonteLeituraSchema.optional(),
  confianca: z.number().min(0).max(1).optional(),
});
export type OddLine = z.infer<typeof OddLineSchema>;

export const FonteStatsSchema = z.enum(['sofascore', 'superscore', 'flashscore']);

/** Médias por jogo. */
export const StatsTimeSchema = z.object({
  fonte: FonteStatsSchema,
  time: z.string().min(1),
  jogos: z.number().int().nonnegative(),
  gf: z.number().nonnegative(),
  ga: z.number().nonnegative(),
  xg: z.number().nonnegative().optional(),
  xga: z.number().nonnegative().optional(),
  chutesNoAlvo: z.number().nonnegative().optional(),
  chutesNoAlvoContra: z.number().nonnegative().optional(),
  grandesChances: z.number().nonnegative().optional(),
  escanteiosFavor: z.number().nonnegative().optional(),
  escanteiosContra: z.number().nonnegative().optional(),
  cartoes: z.number().nonnegative().optional(),
  faltas: z.number().nonnegative().optional(),
  posse: z.number().min(0).max(100).optional(),
  casaFora: z.enum(['casa', 'fora', 'geral']).optional(),
  ultimos5: z.string().optional(),
  desfalques: z.array(z.string()).default([]),
  escalacao: z.array(z.string()).optional(),
});
export type StatsTime = z.infer<typeof StatsTimeSchema>;

export const JogoSchema = z.object({
  casa: z.string().trim().min(1),
  fora: z.string().trim().min(1),
  competicao: z.string().optional(),
  /** ISO 8601 */
  inicio: z.string().min(1),
});
export type Jogo = z.infer<typeof JogoSchema>;

/** Formato do botão "Importar JSON" (gerado no chat do Claude a partir dos prints). */
export const ImportacaoSchema = z.object({
  jogo: JogoSchema.partial().optional(),
  odds: z.array(OddLineSchema).default([]),
  stats: z.array(StatsTimeSchema).default([]),
});
export type Importacao = z.infer<typeof ImportacaoSchema>;

export interface ResultadoImportacao {
  ok: boolean;
  dados?: Importacao;
  erros: string[];
}

export function importarJson(texto: string): ResultadoImportacao {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch (e) {
    return { ok: false, erros: [`JSON inválido: ${(e as Error).message}`] };
  }
  // aceita também uma lista pura de odds
  const r = ImportacaoSchema.safeParse(Array.isArray(bruto) ? { odds: bruto } : bruto);
  if (!r.success) {
    return {
      ok: false,
      erros: r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    };
  }
  return {
    ok: true,
    dados: { ...r.data, odds: r.data.odds.map((o) => ({ ...o, fonte: o.fonte ?? 'json' })) },
    erros: [],
  };
}
