/**
 * Núcleo do reprocessamento de uma entrada do histórico. É COPIADO para o build de referência
 * (apps/web/test/) junto com o núcleo da F1.2a, de onde reaproveita a medição e a validação do
 * ambiente. Calcula derivar(rascunho) + resumir(r, d) DAQUELE build com o relógio parado num
 * instante dado (uma ponta do minuto por execução). O resumo sai pelo mesmo caminho do backup
 * do site (JSON.stringify): é com essa forma que o resumo gravado é comparado.
 */
import { medirAmbiente, validarAmbiente, type AmbienteNucleo } from './zz-bancada-nucleo';

export interface EntradaReprocessamento {
  rascunho: unknown;
  /** instante ISO em que o relógio fica parado */
  relogio: string;
  esperado: { fuso: string; localidade: string; localidadeRelevante: boolean };
}

export interface ModulosReprocessamento {
  derivar: unknown;
  resumir: unknown;
}

export type SaidaReprocessamento =
  | { status: 'ok'; resumoJson: string; ambiente: AmbienteNucleo }
  | {
      status: 'ambiente-invalido' | 'api-ausente' | 'erro-execucao';
      motivo: string;
      ambiente: AmbienteNucleo | null;
    };

export interface ControlesReprocessamento {
  carregar: () => Promise<ModulosReprocessamento>;
  fixarRelogio: (ms: number) => void;
  liberarRelogio: () => void;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function executarReprocessamentoHistorico(
  e: EntradaReprocessamento,
  c: ControlesReprocessamento,
): Promise<SaidaReprocessamento> {
  const ambiente = medirAmbiente();
  const ruim = validarAmbiente(ambiente, e.esperado);
  if (ruim) return { status: 'ambiente-invalido', motivo: ruim, ambiente };
  const relogio = Date.parse(e.relogio);
  if (!Number.isFinite(relogio))
    return { status: 'erro-execucao', motivo: `relógio ilegível: ${e.relogio}`, ambiente };

  let m: ModulosReprocessamento;
  try {
    m = await c.carregar();
  } catch (x) {
    return {
      status: 'api-ausente',
      motivo: `módulos do build não carregam: ${mensagem(x)}`,
      ambiente,
    };
  }
  const faltam = (['derivar', 'resumir'] as const).filter((k) => typeof m[k] !== 'function');
  if (faltam.length)
    return { status: 'api-ausente', motivo: `o build não exporta: ${faltam.join(', ')}`, ambiente };

  const g = globalThis as { fetch?: unknown };
  const fetchOriginal = g.fetch;
  g.fetch = () => Promise.reject(new Error('rede bloqueada durante o reprocessamento'));
  try {
    const derivar = m.derivar as (r: unknown) => unknown;
    const resumir = m.resumir as (r: unknown, d: unknown) => unknown;
    let resumo: unknown;
    c.fixarRelogio(relogio);
    try {
      resumo = resumir(e.rascunho, derivar(e.rascunho));
    } finally {
      c.liberarRelogio();
    }
    return { status: 'ok', resumoJson: JSON.stringify(resumo), ambiente };
  } catch (x) {
    return { status: 'erro-execucao', motivo: mensagem(x), ambiente };
  } finally {
    g.fetch = fetchOriginal;
  }
}
