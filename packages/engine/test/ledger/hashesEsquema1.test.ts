/**
 * PRESERVAÇÃO do esquema 1: os hashes dos cinco tipos NÃO mudam entre versões do verificador.
 * Os valores abaixo foram gerados pelo código ANTERIOR (commit 6c8c7cd, antes da Etapa 0 e da V2) para
 * a cadeia definida aqui. Se qualquer um mudar, o formato mudou: isso exige NOVO esquema, nunca ajuste
 * do teste.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  criarRegistro,
  hashDoRegistro,
  serializarCanonico,
  verificarCadeia,
  type CorpoLedger,
  type RegistroLedger,
  type TipoRegistro,
} from '../../src/ledger';

const T = (i: number) => `2026-11-13T15:${String(i).padStart(2, '0')}:00-03:00`;
const STAKE = {
  autorizada: true,
  kellyCheio: 0.2,
  fracaoKelly: 0.25,
  fracaoBanca: 0.02,
  limites: ['teto'],
  teto: 0.02,
  valor: 20,
};
const TRAVAS = {
  bancaInicial: 1000,
  bancaAtual: 1000,
  pico: 1000,
  drawdown: 0,
  fatorKelly: 1,
  pausadoAte: null,
  perdasHoje: 0,
  diaEncerrado: false,
  expostoHoje: 0,
  motivos: [],
};

/** hashes gerados pelo código de 6c8c7cd para esta cadeia */
const HASHES_6C8C7CD = [
  'ac005e7b7c269a5dd2d53b329ccbcf81b038ca928780e69034c5f87560b6c715',
  '660c6e80be62855026eec0528b46d7bd8db58ed6c30ba6ca710721d3127323f5',
  '9c4ae78214a44cf26088d8d9d32ddf83ab0bbe6ef02427e40f2594a090c79a7d',
  'c1d4fd151b7e899c51260739d8eba2b17b306123fdd25a1f073fbaa2b36df212',
  'c0e0c48da37310759a614dced1407c18e3ca3a23f126f9a64c0a86fa61db6193',
];

async function cadeiaDosCincoTipos(): Promise<RegistroLedger[]> {
  const lista: RegistroLedger[] = [];
  const criar = async (
    tipo: TipoRegistro,
    n: number,
    corpo: CorpoLedger,
    corrige?: { seq: number; hash: string },
  ) => {
    const r = await criarRegistro(
      {
        tipo,
        cadeia: 'A',
        criadoEm: T(n),
        corpo,
        versaoMotor: 'teste',
        politicas: { x: 1 },
        ...(corrige ? { corrige } : {}),
      },
      lista.at(-1) ?? null,
    );
    lista.push(r);
    return r;
  };
  const d = await criar('decisao', 1, {
    entradaMotor: { v4: null, lista: null },
    saida: { v4: null },
    snapshot: {
      odds: [],
      estatisticas: {},
      contexto: {},
      prints: { p: 'b'.repeat(64) },
    },
    impressao: 'abc',
  });
  await criar('aposta_registrada', 2, {
    decisao: { seq: 1, hash: d.hash },
    aposta: { odd: 2, casa: '1win', valor: 10, feitaEm: T(2) },
    stakeAutorizada: STAKE,
    travas: TRAVAS,
  });
  const r = await criar('resultado', 3, {
    decisao: { seq: 1, hash: d.hash },
    resultado: { casa: 2, fora: 1, registradoEm: T(3), escanteios: { casa: 5, fora: 3 } },
  });
  await criar('correcao', 4, { motivo: 'm', novo: { casa: 3, fora: 1 } }, { seq: 3, hash: r.hash });
  await criar('exclusao', 5, { motivo: null });
  return lista;
}

describe('esquema 1: hashes preservados', () => {
  it('os cinco hashes são exatamente os gerados pelo código anterior (6c8c7cd)', async () => {
    const lista = await cadeiaDosCincoTipos();
    expect(lista.map((r) => r.hash)).toEqual(HASHES_6C8C7CD);
    expect(lista.every((r) => r.cabecalho.esquema === 1)).toBe(true);
  });

  it('o hash continua SHA-256 de "pe-ledger/v1\\n" + JSON canônico, calculado por fora', async () => {
    for (const r of await cadeiaDosCincoTipos()) {
      const canonico = serializarCanonico({ cabecalho: r.cabecalho, corpo: r.corpo });
      const independente = createHash('sha256')
        .update('pe-ledger/v1\n' + canonico, 'utf8')
        .digest('hex');
      expect(r.hash).toBe(independente);
      expect(await hashDoRegistro(r.cabecalho, r.corpo)).toBe(independente);
    }
  });

  it('a cadeia dos cinco tipos continua íntegra', async () => {
    const rel = await verificarCadeia(await cadeiaDosCincoTipos());
    expect(rel.problemas).toEqual([]);
    expect(rel.estado).toBe('integra');
  });
});
