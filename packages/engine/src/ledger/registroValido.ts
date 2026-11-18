/**
 * MÓDULO INTERNO do Ledger: validadores de um registro isolado, usados por `cadeia.ts` (verificação e
 * conferência de escrita) e por `armazem.ts` (Fases A e B da gravação).
 *
 * NÃO é reexportado por `ledger/index.ts`, e portanto não faz parte da API pública de `@pe/engine`:
 * as mensagens e a ordem das verificações são detalhe de implementação, não contrato. Quem está fora
 * do Ledger verifica registros com `verificarCadeia` e `verificarLedger`. Importe daqui somente
 * dentro de `packages/engine/src/ledger` (e nos testes do Ledger).
 */
import { ehHashSha256 } from './hash';
import {
  ESQUEMAS_SUPORTADOS,
  TIPOS_DO_ESQUEMA,
  type RegistroLedger,
  type TipoDeRegistroLido,
} from './tipos';
import { ehDataIsoComDeslocamento, motivoCorpoIncompativel } from './validacao';

const ehObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Forma mínima de um registro: o suficiente para tentar verificar. Não olha o conteúdo do corpo.
 *
 * PRECEDÊNCIA DE ESQUEMA SOBRE TIPO: a lista de tipos válidos é do esquema. Num esquema que esta
 * versão conhece, um tipo fora da lista é registro malformado (adulteração). Num esquema que ela NÃO
 * conhece, o tipo pode ser legítimo de um formato mais novo: não é julgado aqui e o registro cai em
 * `esquema_incompativel` (incompatível, nem "ok" nem "adulterado"). O tipo ainda precisa ser texto.
 */
export function motivoMalformado(
  r: unknown,
  suportados: readonly number[] = ESQUEMAS_SUPORTADOS,
): string | null {
  if (!ehObjeto(r)) return 'registro não é um objeto';
  const c = r.cabecalho;
  if (!ehObjeto(c)) return 'sem cabeçalho';
  if (!ehObjeto(r.corpo)) return 'sem corpo';
  if (!ehHashSha256(r.hash)) return 'hash ausente ou fora do formato';
  if (typeof c.esquema !== 'number' || !Number.isInteger(c.esquema)) return 'esquema inválido';
  if (suportados.includes(c.esquema)) {
    if (!(TIPOS_DO_ESQUEMA[c.esquema] ?? []).includes(c.tipo as TipoDeRegistroLido))
      return 'tipo desconhecido';
  } else if (typeof c.tipo !== 'string' || !c.tipo) return 'tipo ausente';
  if (typeof c.cadeia !== 'string' || !c.cadeia) return 'cadeia ausente';
  if (typeof c.seq !== 'number' || !Number.isInteger(c.seq) || c.seq < 1) return 'seq inválido';
  if (c.prevHash !== null && !ehHashSha256(c.prevHash)) return 'prevHash fora do formato';
  if (typeof c.criadoEm !== 'string') return 'criadoEm ausente';
  return null;
}

/**
 * VALIDADOR DE LEITURA de um registro isolado: o motivo pelo qual ele não é um registro válido para
 * quem o lê, ou null se é. É o que `verificarCadeia` aplica a cada registro (forma, esquema
 * suportado, data, tipo × esquema e corpo × tipo), sem olhar o encadeamento nem o hash.
 *
 * É INDEPENDENTE dos bloqueios de escrita: aceita todo tipo que o verificador LÊ, inclusive os
 * somente leitura (o `fechamento`). Quem grava continua sujeito a `conferirRegistro`.
 */
export function motivoRegistroInvalido(
  r: unknown,
  suportados: readonly number[] = ESQUEMAS_SUPORTADOS,
): string | null {
  const malformado = motivoMalformado(r, suportados);
  if (malformado) return `registro malformado (${malformado})`;
  const { cabecalho, corpo } = r as RegistroLedger;
  if (!suportados.includes(cabecalho.esquema))
    return `esquema ${cabecalho.esquema} não suportado (suporta ${suportados.join(', ')})`;
  if (!ehDataIsoComDeslocamento(cabecalho.criadoEm))
    return `criadoEm não é uma data ISO 8601 válida com deslocamento: ${cabecalho.criadoEm}`;
  return motivoCorpoIncompativel(cabecalho, corpo);
}
