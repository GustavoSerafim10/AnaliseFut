/**
 * Backup compactado (versão 3): gzip de JSON em linhas (JSONL), escrito e lido em fluxo, sem
 * nunca montar o arquivo inteiro como uma string (o navegador recusa textos acima de ~512 M
 * caracteres; 300 jogos com todas as revisões passam de 550 MB).
 *
 *   linha 1      cabeçalho: { formato, versao: 3, exportadoEm, historico, ...extras }
 *   linhas 2..N  uma revisão de evidência por linha
 *   última       rodapé: { fim: true, revisoes: N }  (sem ele o arquivo está incompleto)
 *
 * gzip pelo CompressionStream nativo (navegador e Node): sem dependência, e o .json.gz abre em
 * qualquer descompactador. Backups antigos (.json, versões 1 e 2) seguem pelo caminho antigo.
 */
import { impressaoDigital, pareceEvidencia, type Evidencia } from './evidencias';

export const FORMATO_BACKUP = 'pricing-engine-backup';
export const VERSAO_BACKUP_GZ = 3;
const NL = '\n';

export interface CabecalhoBackupGz {
  formato: typeof FORMATO_BACKUP;
  versao: typeof VERSAO_BACKUP_GZ;
  exportadoEm: string;
  historico: unknown[];
  [extra: string]: unknown;
}

export interface RodapeBackupGz {
  fim: true;
  revisoes: number;
}

/** gzip começa com 1f 8b; JSON antigo começa com "{" (ou espaço). */
export const ehGzip = (inicio: Uint8Array) =>
  inicio.length >= 2 && inicio[0] === 0x1f && inicio[1] === 0x8b;

export interface ResultadoEscrita {
  blob: Blob;
  revisoes: number;
  /** tamanho sem compactar (caracteres das linhas) */
  bytesBrutos: number;
}

/**
 * Escreve o backup em fluxo: o cabeçalho, cada página de evidências assim que chega e o rodapé.
 * Na memória ficam só a página da vez e o resultado já compactado.
 */
export async function escreverBackupGz(
  cabecalho: CabecalhoBackupGz,
  paginas: AsyncIterable<Evidencia[]>,
): Promise<ResultadoEscrita> {
  const gz = new CompressionStream('gzip');
  const escritor = gz.writable.getWriter();
  const resultado = new Response(gz.readable).blob();
  const cod = new TextEncoder();
  let bytesBrutos = 0;
  let revisoes = 0;
  const linha = async (obj: unknown) => {
    const t = JSON.stringify(obj) + NL;
    bytesBrutos += t.length;
    await escritor.write(cod.encode(t));
  };
  try {
    await linha(cabecalho);
    for await (const pagina of paginas)
      for (const ev of pagina) {
        await linha(ev);
        revisoes++;
      }
    await linha({ fim: true, revisoes } satisfies RodapeBackupGz);
    await escritor.close();
  } catch (e) {
    await escritor.abort(e).catch(() => undefined);
    throw e;
  }
  return {
    blob: new Blob([await resultado], { type: 'application/gzip' }),
    revisoes,
    bytesBrutos,
  };
}

/** Linhas do arquivo descompactado, uma a uma (número começando em 1). */
export async function* linhasGz(
  fluxo: ReadableStream<Uint8Array>,
): AsyncGenerator<{ n: number; texto: string }> {
  // os tipos do DOM descrevem os dois estágios com BufferSource/Uint8Array incompatíveis entre si
  const texto = fluxo
    .pipeThrough(
      new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>,
    )
    .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);
  const leitor = texto.getReader();
  let resto = '';
  let n = 0;
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      const partes = (resto + value).split(NL);
      resto = partes.pop() ?? '';
      for (const p of partes) yield { n: ++n, texto: p };
    }
  } finally {
    leitor.releaseLock();
  }
  if (resto) yield { n: ++n, texto: resto };
}

export interface ProblemaBackup {
  linha: number | null;
  motivo: string;
}

export type VerificacaoBackupGz =
  | {
      ok: true;
      cabecalho: CabecalhoBackupGz;
      revisoes: number;
      /** hash de cada revisão, na ordem do arquivo: a 2ª passada confere que é o mesmo arquivo */
      hashes: string[];
    }
  | { ok: false; problemas: ProblemaBackup[] };

const MAX_PROBLEMAS = 20;

/** Tradução da falha do fluxo (gzip truncado, bytes trocados) para quem lê o relatório. */
function motivoDoFluxo(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return `arquivo compactado corrompido ou cortado (${m})`;
}

/**
 * 1ª passada, sem gravar nada: formato do cabeçalho, JSON e forma de cada revisão, SHA-256 do
 * conteúdo de cada revisão igual ao hash registrado, rodapé presente e com a contagem certa,
 * nada depois do rodapé. Qualquer problema recusa o arquivo inteiro.
 */
export async function verificarBackupGz(
  abrir: () => ReadableStream<Uint8Array>,
): Promise<VerificacaoBackupGz> {
  const problemas: ProblemaBackup[] = [];
  const falha = (linha: number | null, motivo: string) => {
    if (problemas.length < MAX_PROBLEMAS) problemas.push({ linha, motivo });
  };
  let cabecalho: CabecalhoBackupGz | null = null;
  let rodape: RodapeBackupGz | null = null;
  const hashes: string[] = [];
  try {
    for await (const { n, texto } of linhasGz(abrir())) {
      if (rodape) {
        if (texto.trim()) falha(n, 'há conteúdo depois do rodapé');
        continue;
      }
      let obj: unknown;
      try {
        obj = JSON.parse(texto);
      } catch {
        falha(n, 'linha não é JSON válido');
        continue;
      }
      if (n === 1) {
        const c = obj as CabecalhoBackupGz;
        if (c?.formato !== FORMATO_BACKUP || c.versao !== VERSAO_BACKUP_GZ)
          falha(1, 'cabeçalho não é de um backup versão 3 deste site');
        else if (!Array.isArray(c.historico)) falha(1, 'cabeçalho sem "historico"');
        else cabecalho = c;
        continue;
      }
      if ((obj as RodapeBackupGz)?.fim === true) {
        rodape = obj as RodapeBackupGz;
        continue;
      }
      if (!pareceEvidencia(obj)) {
        falha(n, 'linha não tem a forma de uma revisão de evidência');
        continue;
      }
      const calculado = await impressaoDigital(obj.conteudo);
      if (calculado !== obj.meta.hash)
        falha(
          n,
          `SHA-256 não confere (jogo ${obj.meta.idJogo}, revisão ${obj.meta.revisao}): conteúdo alterado`,
        );
      hashes.push(obj.meta.hash);
    }
  } catch (e) {
    falha(null, motivoDoFluxo(e));
  }
  if (!cabecalho && !problemas.some((p) => p.linha === 1))
    falha(1, 'arquivo vazio ou sem cabeçalho');
  if (!rodape) falha(null, 'sem rodapé: arquivo incompleto (cortado na cópia ou no download)');
  else if (rodape.revisoes !== hashes.length)
    falha(null, `rodapé diz ${rodape.revisoes} revisões, o arquivo tem ${hashes.length}`);
  if (problemas.length || !cabecalho) return { ok: false, problemas };
  return { ok: true, cabecalho, revisoes: hashes.length, hashes };
}

/**
 * 2ª passada: entrega as revisões já verificadas, conferindo que cada hash é o da 1ª passada,
 * na mesma posição (o arquivo não mudou entre as duas leituras).
 */
export async function* evidenciasDoBackupGz(
  abrir: () => ReadableStream<Uint8Array>,
  hashesVerificados: string[],
): AsyncGenerator<Evidencia> {
  let i = 0;
  for await (const { n, texto } of linhasGz(abrir())) {
    if (n === 1 || !texto.trim()) continue;
    const obj = JSON.parse(texto) as Evidencia | RodapeBackupGz;
    if ((obj as RodapeBackupGz).fim === true) break;
    const ev = obj as Evidencia;
    if (hashesVerificados[i] !== ev.meta.hash)
      throw new Error(`o arquivo mudou entre a conferência e a gravação (linha ${n})`);
    i++;
    yield ev;
  }
  if (i !== hashesVerificados.length)
    throw new Error(`a 2ª leitura trouxe ${i} revisões, a conferência ${hashesVerificados.length}`);
}

/** Backups antigos (.json versão 2 com "evidencias"): mesma conferência de SHA-256. */
export async function verificarEvidencias(lista: Evidencia[]): Promise<ProblemaBackup[]> {
  const problemas: ProblemaBackup[] = [];
  for (const [i, ev] of lista.entries())
    if ((await impressaoDigital(ev.conteudo)) !== ev.meta.hash && problemas.length < MAX_PROBLEMAS)
      problemas.push({
        linha: null,
        motivo: `evidência ${i + 1} (jogo ${ev.meta.idJogo}, revisão ${ev.meta.revisao}): SHA-256 não confere`,
      });
  return problemas;
}
