/**
 * Superfície pública do Ledger.
 *  - os validadores internos (`motivoMalformado`, `motivoRegistroInvalido`) vivem em
 *    `ledger/registroValido.ts`, que não é reexportado: não estão em `@pe/engine`;
 *  - UMA porta pública de escrita: `anexar` (e as duas metades dela, `verificarReferencias` +
 *    `anexarNaTransacao`, que só grava com a autorização emitida pela primeira). `aceitarAnexo`, que
 *    conferia o registro e a ponta sem as demais garantias, saiu da API; `conferirPonta` é interna;
 *  - `AnteriorVerificado` é exportado como TIPO, porque aparece no tipo público `ReferenciasVerificadas`
 *    (conferido em compilação: o typecheck do projeto inclui os testes).
 */
import { describe, expect, it } from 'vitest';
import * as engine from '../../src';
import type { AnteriorVerificado, ReferenciasVerificadas } from '../../src';
import * as ledger from '../../src/ledger';
import * as interno from '../../src/ledger/registroValido';

const INTERNOS = ['motivoMalformado', 'motivoRegistroInvalido'] as const;
const FORA_DA_API = [...INTERNOS, 'aceitarAnexo', 'conferirPonta'] as const;

describe('API pública do Ledger', () => {
  it('validadores internos, aceitarAnexo e conferirPonta NÃO saem pelo barrel do Ledger', () => {
    for (const nome of FORA_DA_API) expect(Object.keys(ledger), nome).not.toContain(nome);
  });

  it('...nem por @pe/engine', () => {
    for (const nome of FORA_DA_API) expect(Object.keys(engine), nome).not.toContain(nome);
  });

  it('o módulo interno continua exportando os validadores, para uso dentro do Ledger', () => {
    for (const nome of INTERNOS) expect(typeof interno[nome]).toBe('function');
  });

  it('nada que lembre a marca privada ou o registro de autorizações sai pelos barrels', () => {
    for (const nome of Object.keys(engine))
      expect(nome).not.toMatch(/verificadasPelaFaseA|autorizacoesEmitidas|congelarProfundo/);
  });

  it('a porta de escrita e a API de leitura continuam públicas', () => {
    for (const nome of [
      'anexar',
      'verificarReferencias',
      'anexarNaTransacao',
      'verificarCadeia',
      'verificarLedger',
      'criarRegistro',
      'conferirRegistro',
      'motivoCorpoIncompativel',
    ])
      expect(typeof (engine as Record<string, unknown>)[nome], nome).toBe('function');
  });

  it('AnteriorVerificado é um tipo público coerente com ReferenciasVerificadas', () => {
    // em compilação: o tipo é importável e é o mesmo do campo `anterior` do tipo público
    const anterior: AnteriorVerificado = { seq: 1, hash: 'h', canonico: 'c' };
    const doCampo: NonNullable<ReferenciasVerificadas['anterior']> = anterior;
    expect(doCampo).toBe(anterior);
  });
});
