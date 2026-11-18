/**
 * Reprodução histórica: reexecuta o motor com o que foi gravado e COMPARA com o que o motor
 * devolveu na época. Só relata. Nunca altera, corrige nem regrava um registro: o passado do
 * Ledger não muda porque o motor de hoje pensa diferente. Uma divergência é informação
 * (o motor mudou? algum número de política mudou? ou o motor deixou de ser determinístico?).
 */
import { descreverFalha } from './falha'; // módulo interno
import { melhoresEntradas, type PedidoEntradas, type ResultadoEntradas } from '../entradas';
import { analisarV4, type EntradaV4, type ResultadoV4 } from '../v4';
import { sha256Hex } from './hash';
import type { Json } from './json';
import { serializarCanonico } from './json';
import {
  ESQUEMAS_SUPORTADOS,
  type CorpoDecisao,
  type Diferenca,
  type RegistroLedger,
  type ResultadoReproducao,
} from './tipos';
import { impressaoDasPoliticas, VERSAO_MOTOR } from './versao';

/** Número finito vira número; NaN/Infinity viram um marcador (informação preservada, sem erro). */
const num = (x: number | null | undefined): Json =>
  x === null || x === undefined ? null : Number.isFinite(x) ? x : { naoFinito: String(x) };

/**
 * O resumo COMPARÁVEL da saída do motor: o que identifica a decisão, os preços, a stake e os
 * motivos. É a única forma da saída gravada e a mesma usada para recalcular, então gravar e
 * reproduzir nunca divergem por formato.
 */
export function resumirSaidaDoMotor(v4: ResultadoV4 | null, lista: ResultadoEntradas | null): Json {
  return {
    v4: v4
      ? {
          decisao: v4.decisao,
          gatilho: v4.gatilho ?? null,
          nivelReferencia: v4.referencia.nivel,
          afiadas: v4.referencia.afiadas,
          moles: v4.referencia.moles,
          melhor: v4.melhor
            ? {
                chave: v4.melhor.chave,
                descricao: v4.melhor.descricao,
                nivel: v4.melhor.nivel,
                estrategia: v4.melhor.estrategia,
                pTrue: num(v4.melhor.pTrue),
                fonteP: v4.melhor.fonteP,
                ev: num(v4.melhor.ev),
                evMinimo: num(v4.melhor.evMinimo),
                oddMinima: num(v4.melhor.oddMinima),
                melhorOdd: num(v4.melhor.melhorOdd),
                casaMelhorOdd: v4.melhor.casaMelhorOdd,
                stake: v4.melhor.stake
                  ? {
                      kellyCheio: num(v4.melhor.stake.kellyCheio),
                      fracaoKelly: num(v4.melhor.stake.fracaoKelly),
                      fracaoBanca: num(v4.melhor.stake.fracaoBanca),
                      valor:
                        v4.melhor.stake.valor === undefined
                          ? undefined
                          : num(v4.melhor.stake.valor),
                      ajustes: v4.melhor.stake.ajustes,
                    }
                  : null,
              }
            : null,
          avaliadas: v4.avaliadas.map((a) => ({
            chave: a.chave,
            nivel: a.nivel,
            pTrue: num(a.pTrue),
            ev: num(a.ev),
            evMinimo: num(a.evMinimo),
            melhorOdd: num(a.melhorOdd),
            casaMelhorOdd: a.casaMelhorOdd,
            filtro: a.filtro,
            casas: a.casas,
          })),
          descartados: v4.descartados.map((d) => ({ chave: d.chave, motivo: d.motivo })),
          rastro: v4.rastro.map((r) => ({
            indice: r.indice,
            chave: r.chave,
            destino: r.destino,
            motivo: r.motivo ?? null,
            papel: r.papel ?? null,
            casa: r.casa,
            operatorId: r.operatorId,
          })),
          motivos: v4.motivos,
          avisos: v4.avisos,
        }
      : null,
    lista: lista
      ? {
          status: lista.status,
          bloqueio: lista.bloqueio ?? null,
          entradas: lista.entradas.map((e) => ({
            chave: e.chave,
            odd: num(e.odd),
            casa: e.casa,
            chance: num(e.chance),
            chanceGreen: num(e.chanceGreen),
            minimo: num(e.minimo),
            ev: num(e.ev),
            forca: e.forca,
            stake: num(e.stake),
            stakeValor: e.stakeValor === undefined ? undefined : num(e.stakeValor),
            stakeKelly: num(e.stakeKelly),
            limiteStake: e.limiteStake,
            reduzidaPorAcumulo: e.reduzidaPorAcumulo ?? false,
            jaRegistrada: e.jaRegistrada ?? false,
          })),
          recusadas: lista.recusadas.map((q) => ({ chave: q.chave, motivo: q.motivo })),
        }
      : null,
  };
}

const lido = (x: Json | undefined): Json | undefined => x;
const campo = (o: Json | undefined, k: string): Json | undefined =>
  o !== null && typeof o === 'object' && !Array.isArray(o) ? lido(o[k]) : undefined;

/**
 * Impressão digital da decisão: muda quando muda o que importa (decisão, melhor entrada, stake,
 * lista de entradas, DQ), não quando muda texto de motivo. Serve para não gravar duas vezes a
 * mesma decisão enquanto o usuário edita a análise.
 */
export async function impressaoDaDecisao(saida: Json, dq: string | null): Promise<string> {
  const v4 = campo(saida, 'v4');
  const melhor = campo(v4, 'melhor');
  const stake = campo(melhor, 'stake');
  const lista = campo(saida, 'lista');
  const entradas = campo(lista, 'entradas');
  const relevante: Json = {
    dq,
    decisao: campo(v4, 'decisao') ?? null,
    nivel: campo(v4, 'nivelReferencia') ?? null,
    melhor: melhor
      ? {
          chave: campo(melhor, 'chave') ?? null,
          odd: campo(melhor, 'melhorOdd') ?? null,
          casa: campo(melhor, 'casaMelhorOdd') ?? null,
          stake: stake ? (campo(stake, 'fracaoBanca') ?? null) : null,
        }
      : null,
    lista: Array.isArray(entradas)
      ? entradas.map((e) => ({
          chave: campo(e, 'chave') ?? null,
          odd: campo(e, 'odd') ?? null,
          stake: campo(e, 'stake') ?? null,
        }))
      : null,
    statusLista: campo(lista, 'status') ?? null,
  };
  return sha256Hex(serializarCanonico(relevante));
}

// ─────────────── comparação

const LIMITE_DIFERENCAS = 50;

function comparar(
  a: Json | undefined,
  b: Json | undefined,
  caminho: string,
  saida: Diferenca[],
): void {
  if (saida.length >= LIMITE_DIFERENCAS) return;
  const igual = (x: Json | undefined, y: Json | undefined) =>
    x === undefined || y === undefined ? x === y : serializarCanonico(x) === serializarCanonico(y);
  if (igual(a, b)) return;
  const objA = a !== null && typeof a === 'object';
  const objB = b !== null && typeof b === 'object';
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) comparar(a[i], b[i], `${caminho}[${i}]`, saida);
    return;
  }
  if (objA && objB && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort())
      comparar(a[k], b[k], caminho ? `${caminho}.${k}` : k, saida);
    return;
  }
  saida.push({ caminho: caminho || 'raiz', gravado: a, recalculado: b });
}

/** Cópia profunda pela serialização canônica: o executor nunca toca no registro original. */
const clonar = <T extends Json>(x: T): T => JSON.parse(serializarCanonico(x)) as T;

export type ExecutorDoMotor = (entrada: CorpoDecisao['entradaMotor']) => Json | Promise<Json>;

/** Executor que usa o motor ATUAL deste código. */
export const executorDoMotorAtual: ExecutorDoMotor = (entrada) =>
  resumirSaidaDoMotor(
    entrada.v4 ? analisarV4(entrada.v4 as unknown as EntradaV4) : null,
    entrada.lista ? melhoresEntradas(entrada.lista as unknown as PedidoEntradas) : null,
  );

/**
 * Reprodução com um executor qualquer. Só `decisao` é reproduzível. Não altera `registro`: o
 * executor recebe uma cópia, e o resultado é um relatório novo.
 */
export async function reproduzir(
  registro: RegistroLedger,
  executor: ExecutorDoMotor,
): Promise<ResultadoReproducao> {
  const versaoGravada = registro.cabecalho.versaoMotor;
  const versaoAtual = VERSAO_MOTOR;
  const politicasMudaram =
    (await impressaoDasPoliticas()) !== registro.cabecalho.impressaoPoliticas;
  const base = {
    versaoGravada,
    versaoAtual,
    politicasMudaram,
    hashSaidaGravada: null as string | null,
    hashSaidaRecalculada: null as string | null,
    diferencas: [] as Diferenca[],
  };
  if (!ESQUEMAS_SUPORTADOS.includes(registro.cabecalho.esquema))
    return { ...base, situacao: 'nao_reproduzivel', causa: 'esquema_incompativel' };
  if (registro.cabecalho.tipo !== 'decisao')
    return { ...base, situacao: 'nao_reproduzivel', causa: 'tipo_sem_reproducao' };
  const corpo = registro.corpo as CorpoDecisao;
  const entrada = corpo?.entradaMotor;
  if (!entrada || (entrada.v4 == null && entrada.lista == null) || corpo.saida === undefined)
    return { ...base, situacao: 'nao_reproduzivel', causa: 'registro_sem_entrada' };

  let recalculada: Json;
  try {
    base.hashSaidaGravada = await sha256Hex(serializarCanonico(corpo.saida));
    recalculada = await executor(
      clonar(entrada as unknown as Json) as CorpoDecisao['entradaMotor'],
    );
    base.hashSaidaRecalculada = await sha256Hex(serializarCanonico(recalculada));
  } catch (e) {
    return {
      ...base,
      situacao: 'nao_reproduzivel',
      causa: 'erro_ao_executar',
      detalhe: descreverFalha(e),
    };
  }
  if (base.hashSaidaGravada === base.hashSaidaRecalculada)
    return { ...base, situacao: 'reproduzida' };

  const diferencas: Diferenca[] = [];
  comparar(corpo.saida, recalculada, '', diferencas);
  return {
    ...base,
    diferencas,
    situacao: 'divergente',
    causa:
      versaoGravada !== versaoAtual
        ? 'versao_do_motor_diferente'
        : politicasMudaram
          ? 'politicas_diferentes'
          : 'mesma_versao_e_politicas',
  };
}

/** Reprodução com o motor atual. */
export const reproduzirComMotorAtual = (registro: RegistroLedger): Promise<ResultadoReproducao> =>
  reproduzir(registro, executorDoMotorAtual);
