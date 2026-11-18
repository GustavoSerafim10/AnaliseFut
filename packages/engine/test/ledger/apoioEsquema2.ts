/**
 * Apoio dos testes do esquema 2 (V2, somente leitura). Como esta versão NÃO escreve `fechamento`, os
 * registros deste tipo são montados à mão aqui, com o hash correto para o prefixo "pe-ledger/v2".
 */
import {
  criarRegistro,
  hashDoRegistro,
  type CabecalhoLedger,
  type CorpoLedger,
  type RegistroLedger,
  type TipoRegistro,
} from '../../src/ledger';

export const T = (i: number) => `2026-11-13T15:${String(i % 60).padStart(2, '0')}:00-03:00`;
export const clonar = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
export const codigos = (r: { problemas: { codigo: string }[] }) => r.problemas.map((p) => p.codigo);

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

/** [decisao (seq 1), aposta_registrada → decisao (seq 2), resultado → decisao (seq 3)] */
export async function cadeiaBase(cadeia = 'A'): Promise<RegistroLedger[]> {
  const lista: RegistroLedger[] = [];
  const criar = async (tipo: TipoRegistro, n: number, corpo: CorpoLedger) => {
    const r = await criarRegistro(
      {
        tipo,
        cadeia,
        criadoEm: T(n),
        corpo,
        versaoMotor: 'teste',
        politicas: { x: 1 },
      },
      lista.at(-1) ?? null,
    );
    lista.push(r);
    return r;
  };
  const d = await criar('decisao', 1, {
    entradaMotor: { v4: null, lista: null },
    saida: {},
    snapshot: { odds: [], estatisticas: {}, contexto: {}, prints: {} },
    impressao: 'abc',
  });
  await criar('aposta_registrada', 2, {
    decisao: { seq: 1, hash: d.hash },
    aposta: { odd: 2, casa: '1win', valor: 10, feitaEm: T(2) },
    stakeAutorizada: STAKE,
    travas: TRAVAS,
  });
  await criar('resultado', 3, {
    decisao: { seq: 1, hash: d.hash },
    resultado: { casa: 2, fora: 1, registradoEm: T(3) },
  });
  return lista;
}

/** O corpo de um fechamento válido da aposta do seq 2 da cadeia base. */
export const corpoDeFechamento = (
  base: RegistroLedger[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  aposta: { seq: 2, hash: base[1].hash },
  oddFechamento: 1.85,
  fechamentoOutros: [],
  registradoEm: T(4),
  ...extra,
});

/**
 * Um registro de OUTRO tipo/esquema, montado à mão: continua `base` (seq e prevHash), com o hash
 * correto para o prefixo do esquema dele.
 */
export async function registroMontado(
  anterior: RegistroLedger,
  esquema: number,
  tipo: string,
  corpo: unknown,
  cabecalhoExtra: Record<string, unknown> = {},
): Promise<RegistroLedger> {
  const cabecalho = {
    ...clonar(anterior.cabecalho),
    esquema,
    tipo,
    seq: anterior.cabecalho.seq + 1,
    prevHash: anterior.hash,
    criadoEm: T(anterior.cabecalho.seq + 1),
    ...cabecalhoExtra,
  } as unknown as CabecalhoLedger;
  return {
    cabecalho,
    corpo,
    hash: await hashDoRegistro(cabecalho, corpo as never),
  } as unknown as RegistroLedger;
}

/** Um fechamento (esquema 2) válido, ligado à aposta do seq 2, logo após `anterior`. */
export const fechamentoApos = (
  anterior: RegistroLedger,
  base: RegistroLedger[],
  extra: Record<string, unknown> = {},
) => registroMontado(anterior, 2, 'fechamento', corpoDeFechamento(base, extra));

/** Refaz o hash depois de uma alteração (o hash confere; só a regra nova acusa). */
export async function refazerHash(r: RegistroLedger, alterar: (c: RegistroLedger) => void) {
  const f = clonar(r);
  alterar(f);
  f.hash = await hashDoRegistro(f.cabecalho, f.corpo);
  return f;
}
