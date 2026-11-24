/**
 * Build de referência do reprocessamento (D4, D-e, proteção 3).
 *
 * - Oficial (produção): só o SHA de 40 caracteres pré-registrado em referencia.json, conferido
 *   como commit existente. Hoje é null (Fase 0 não publicada) → "sem-build-referencia".
 * - Sintética de teste: só 8964bf4, e só quando o chamador pede explicitamente o modo de teste.
 *   Nunca aceita como oficial.
 * - Nunca resolve HEAD, branch, tag ou "o mais recente": nenhum nome simbólico é aceito, e a
 *   conferência usa o SHA literal (git cat-file -e <sha>^{commit}).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ReferenciaUsada } from './contratoReprocessamento';

/** D-e: referência SINTÉTICA de teste. Nunca de produção. */
export const REFERENCIA_TESTE_SINTETICA = '8964bf406cc85fe4666be0ba4c379f436463a98c';

export interface RegistroReferencia {
  sha: string | null;
  registradoEm: string | null;
  motivo: string;
}

export type Referencia = ({ ok: true } & ReferenciaUsada) | { ok: false; motivo: string };

const SHA = /^[0-9a-f]{40}$/;

export function registroOficial(): RegistroReferencia {
  return JSON.parse(
    readFileSync(new URL('./referencia.json', import.meta.url), 'utf8'),
  ) as RegistroReferencia;
}

/** O SHA literal é um commit deste repositório? (sem resolver nome nenhum) */
export function commitExiste(repositorio: string, sha: string): boolean {
  if (!SHA.test(sha)) return false;
  try {
    execFileSync('git', ['-C', repositorio, 'cat-file', '-e', `${sha}^{commit}`], {
      stdio: 'ignore',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return true;
  } catch {
    return false;
  }
}

export function resolverReferencia(o: {
  repositorio: string;
  registro?: RegistroReferencia;
  /** SOMENTE TESTES: pede a referência sintética de teste */
  referenciaDeTeste?: string;
}): Referencia {
  if (o.referenciaDeTeste !== undefined) {
    if (o.referenciaDeTeste !== REFERENCIA_TESTE_SINTETICA)
      return {
        ok: false,
        motivo: `referência de teste recusada: só ${REFERENCIA_TESTE_SINTETICA} é aceita como sintética`,
      };
    if (!commitExiste(o.repositorio, REFERENCIA_TESTE_SINTETICA))
      return { ok: false, motivo: 'referência sintética de teste ausente do repositório local' };
    return { ok: true, sha: REFERENCIA_TESTE_SINTETICA, tipo: 'teste-sintetica' };
  }
  const reg = o.registro ?? registroOficial();
  if (reg.sha === null)
    return { ok: false, motivo: `sem build de referência oficial registrado: ${reg.motivo}` };
  if (typeof reg.sha !== 'string' || !SHA.test(reg.sha))
    return {
      ok: false,
      motivo: `referência oficial recusada: "${String(reg.sha)}" não é um SHA de 40 caracteres (HEAD, branch, tag ou SHA curto não valem)`,
    };
  if (reg.sha === REFERENCIA_TESTE_SINTETICA)
    return {
      ok: false,
      motivo: 'referência oficial recusada: 8964bf4 é a referência SINTÉTICA de teste (D-e)',
    };
  if (!commitExiste(o.repositorio, reg.sha))
    return { ok: false, motivo: `referência oficial ${reg.sha} não existe no repositório local` };
  return { ok: true, sha: reg.sha, tipo: 'producao' };
}
