/**
 * Processo filho com tempo limite. Ao estourar, a ÁRVORE inteira é encerrada (o vitest abre
 * workers): no Windows por taskkill /T /F, nos demais pelo grupo de processos.
 */
import { spawn, spawnSync } from 'node:child_process';

export interface ResultadoProcesso {
  codigo: number | null;
  tempoEsgotado: boolean;
  saida: string;
  erro: string;
  duracaoMs: number;
}

const CAUDA = 20_000;

export function executarProcesso(
  comando: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; tempoLimiteMs: number },
): Promise<ResultadoProcesso> {
  const t0 = performance.now();
  return new Promise((ok) => {
    const filho = spawn(comando, args, {
      cwd: o.cwd,
      env: o.env,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let saida = '';
    let erro = '';
    let esgotou = false;
    filho.stdout.on('data', (b: Buffer) => (saida = (saida + b.toString()).slice(-CAUDA)));
    filho.stderr.on('data', (b: Buffer) => (erro = (erro + b.toString()).slice(-CAUDA)));
    const relogio = setTimeout(() => {
      esgotou = true;
      encerrarArvore(filho.pid);
    }, o.tempoLimiteMs);
    const fim = (codigo: number | null, falha?: Error) => {
      clearTimeout(relogio);
      ok({
        codigo,
        tempoEsgotado: esgotou,
        saida,
        erro: falha ? `${erro}\n${falha.message}` : erro,
        duracaoMs: Math.round(performance.now() - t0),
      });
    };
    filho.on('error', (e) => fim(null, e));
    filho.on('close', (c) => fim(c));
  });
}

export function encerrarArvore(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    /* já terminou */
  }
}

/** Ambiente do filho: o do usuário, sem variáveis do vitest pai e com rede desviada. */
export function ambienteFilho(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!/^(VITEST|__VITEST|TEST$|NODE_OPTIONS$|NODE_ENV$)/.test(k)) env[k] = v;
  return {
    ...env,
    // desvio de rede (melhor esforço; o harness também bloqueia fetch)
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    NO_PROXY: '',
    npm_config_offline: 'true',
    ...extra,
  };
}
