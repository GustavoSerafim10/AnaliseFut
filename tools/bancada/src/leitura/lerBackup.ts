/**
 * Leitura de UM backup. Detecta o formato pelo conteúdo, verifica com as funções da Fase 0 (as
 * mesmas do site, só leitura) e devolve o que veio — ou a recusa do arquivo inteiro, com motivo.
 *
 *  v3 .json.gz  verificarBackupGz (SHA-256 de cada revisão, rodapé, contagem) + 2ª leitura com a
 *               identidade completa de cada linha (evidenciasDoBackupGz)
 *  v2 .json     histórico + evidências; SHA-256 de cada evidência (verificarEvidencias)
 *  v1 .json     só histórico (formato anterior às evidências)
 *
 * Falha de integridade (gzip, SHA, rodapé, JSON) recusa o arquivo inteiro: nada dele entra.
 */
import {
  ehGzip,
  evidenciasDoBackupGz,
  verificarBackupGz,
  verificarEvidencias,
} from '../../../../apps/web/src/backupGz';
import { pareceEvidencia, type Evidencia } from '../../../../apps/web/src/evidencias';
import type { Exclusao, FonteLida } from '../contrato';

export interface LeituraBackup {
  fonte: FonteLida;
  /** itens de "historico", ainda sem validação de forma (feita na junção) */
  historico: unknown[];
  /** revisões de evidência com SHA-256 conferido */
  evidencias: Evidencia[];
  /** o que ficou de fora DENTRO de um arquivo aceito (itens malformados) */
  exclusoes: Exclusao[];
  /** registros físicos do arquivo: o que veio, antes de qualquer junção */
  fisicos: { historico: number; evidencias: number };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const fluxo = (bytes: Uint8Array) => () => new Blob([bytes as BlobPart]).stream();

export async function lerBackup(nome: string, bytes: Uint8Array): Promise<LeituraBackup> {
  const sha256 = await sha256Hex(bytes);
  const base: FonteLida = {
    nome,
    sha256,
    formato: null,
    exportadoEm: null,
    suportaEvidencias: false,
    evidenciasIndisponiveisNaOrigem: false,
    recusada: false,
    motivosRecusa: [],
  };
  const recusar = (formato: FonteLida['formato'], motivos: string[]): LeituraBackup => ({
    fonte: { ...base, formato, recusada: true, motivosRecusa: motivos },
    historico: [],
    evidencias: [],
    exclusoes: [{ categoria: 'fonte-recusada', fonte: nome, id: null, motivo: motivos.join('; ') }],
    fisicos: { historico: 0, evidencias: 0 },
  });

  if (ehGzip(bytes.slice(0, 2))) {
    const v = await verificarBackupGz(fluxo(bytes));
    if (!v.ok)
      return recusar(
        'v3-gz',
        v.problemas.map((p) => (p.linha ? `linha ${p.linha}: ${p.motivo}` : p.motivo)),
      );
    const evidencias: Evidencia[] = [];
    try {
      for await (const ev of evidenciasDoBackupGz(fluxo(bytes), v.chaves)) evidencias.push(ev);
    } catch (e) {
      return recusar('v3-gz', [`2ª leitura: ${(e as Error).message}`]);
    }
    const historico = Array.isArray(v.cabecalho.historico) ? v.cabecalho.historico : [];
    return {
      fonte: {
        ...base,
        formato: 'v3-gz',
        exportadoEm: typeof v.cabecalho.exportadoEm === 'string' ? v.cabecalho.exportadoEm : null,
        suportaEvidencias: true,
        evidenciasIndisponiveisNaOrigem: v.cabecalho.evidenciasNoArquivo === 'indisponiveis',
      },
      historico,
      evidencias,
      exclusoes: [],
      fisicos: { historico: historico.length, evidencias: evidencias.length },
    };
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    return recusar(null, [`não é gzip nem JSON válido: ${(e as Error).message}`]);
  }
  const obj = bruto as {
    versao?: unknown;
    historico?: unknown;
    evidencias?: unknown;
    exportadoEm?: unknown;
  };
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.historico))
    return recusar(null, ['não é um backup do histórico (falta "historico")']);
  const exportadoEm = typeof obj.exportadoEm === 'string' ? obj.exportadoEm : null;

  if (obj.versao === undefined) {
    // v1: formato anterior à estrutura de evidências — não há evidência a perder
    return {
      fonte: { ...base, formato: 'v1-json', exportadoEm, suportaEvidencias: false },
      historico: obj.historico,
      evidencias: [],
      exclusoes: [],
      fisicos: { historico: obj.historico.length, evidencias: 0 },
    };
  }
  if (obj.versao !== 2)
    return recusar(null, [`versão de backup desconhecida: ${String(obj.versao)}`]);

  const itens: unknown[] = Array.isArray(obj.evidencias) ? obj.evidencias : [];
  const evidencias = itens.filter(pareceEvidencia);
  const problemas = await verificarEvidencias(evidencias);
  if (problemas.length)
    return recusar(
      'v2-json',
      problemas.map((p) => p.motivo),
    );
  const exclusoes: Exclusao[] = itens
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => !pareceEvidencia(x))
    .map(({ i }) => ({
      categoria: 'evidencia-malformada' as const,
      fonte: nome,
      id: `evidencias[${i}]`,
      motivo: 'item de "evidencias" sem a forma de uma revisão',
    }));
  return {
    fonte: { ...base, formato: 'v2-json', exportadoEm, suportaEvidencias: true },
    historico: obj.historico,
    evidencias,
    exclusoes,
    fisicos: { historico: obj.historico.length, evidencias: itens.length },
  };
}
