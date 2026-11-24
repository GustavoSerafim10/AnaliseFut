/**
 * D1 corrigida: relógio INFERIDO para entradas do histórico sem evidência.
 *
 * O site grava salvoEm como `AAAA-MM-DDTHH:MM:00-03:00` (isoLocal): os segundos são sempre 00,
 * então o instante real está em [salvoEm, salvoEm + 60 s). O início é a hora DIGITADA com o
 * mesmo sufixo (inicioIso); hora vazia vira 00:00, um horário fabricado. Os dois carregam o
 * rótulo fixo −03:00: supõe-se o aparelho nesse fuso (não dá para conferir pela string).
 *
 * Só há relógio inferido quando TODAS as condições valem; senão, relogio-desconhecido:
 *  1. salvoEm no formato exato do site (outro formato = outra origem, precisão desconhecida)
 *  2. data e hora do rascunho preenchidas, e resumo.inicio igual ao que inicioIso montaria
 *  3. salvoEm + 60 s <= inicio
 *  4. sem a marca cronologiaNaoComprovada (D-b)
 * O reprocessamento roda nas DUAS pontas do minuto; resultados diferentes = relógio ambíguo.
 */

/** sufixo que o site grava (apps/web/src/estado.ts: FUSO) */
export const SUFIXO_SITE = '-03:00';
const DESLOCAMENTO_MS = 3 * 3_600_000;
export const PRECISAO_SALVO_EM_MS = 60_000;

const FORMATO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00-03:00$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

/** O instante é legível E a string é exatamente a que o site escreveria para ele (sem rolagem de data). */
function instanteDoSite(s: string): number | null {
  if (!FORMATO.test(s)) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const l = new Date(t - DESLOCAMENTO_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  const volta = `${l.getUTCFullYear()}-${p(l.getUTCMonth() + 1)}-${p(l.getUTCDate())}T${p(l.getUTCHours())}:${p(l.getUTCMinutes())}:00${SUFIXO_SITE}`;
  return volta === s ? t : null;
}

export interface DadosRelogio {
  salvoEm: unknown;
  data: unknown;
  hora: unknown;
  inicio: unknown;
  marcas: string[];
}

export type RelogioInferido =
  { ok: true; salvoEm: string; pontas: [string, string] } | { ok: false; motivo: string };

export function inferirRelogio(x: DadosRelogio): RelogioInferido {
  if (x.marcas.includes('cronologiaNaoComprovada'))
    return {
      ok: false,
      motivo:
        'cronologia da entrada não comprovada (versão canônica escolhida por desempate) — D-b',
    };
  if (typeof x.salvoEm !== 'string') return { ok: false, motivo: 'salvoEm ausente' };
  const t = instanteDoSite(x.salvoEm);
  if (t === null)
    return {
      ok: false,
      motivo: `salvoEm "${x.salvoEm}" fora do formato do site (AAAA-MM-DDTHH:MM:00-03:00): precisão desconhecida`,
    };
  if (typeof x.data !== 'string' || !DATA.test(x.data))
    return { ok: false, motivo: 'data do jogo ausente ou ilegível no rascunho' };
  if (typeof x.hora !== 'string' || !HORA.test(x.hora))
    return {
      ok: false,
      motivo:
        'hora do início vazia ou ilegível no rascunho (o site usaria 00:00, um horário fabricado)',
    };
  const esperado = `${x.data}T${x.hora}:00${SUFIXO_SITE}`;
  if (x.inicio !== esperado)
    return {
      ok: false,
      motivo: `resumo.inicio "${String(x.inicio)}" não confere com data e hora do rascunho (${esperado})`,
    };
  const i = instanteDoSite(esperado);
  if (i === null) return { ok: false, motivo: `início "${esperado}" ilegível` };
  if (t + PRECISAO_SALVO_EM_MS > i)
    return {
      ok: false,
      motivo: `salvoEm + 60 s (${new Date(t + PRECISAO_SALVO_EM_MS).toISOString()}) passa do início (${new Date(i).toISOString()}): não comprova decisão antes do apito`,
    };
  return {
    ok: true,
    salvoEm: x.salvoEm,
    pontas: [new Date(t).toISOString(), new Date(t + PRECISAO_SALVO_EM_MS - 1).toISOString()],
  };
}
