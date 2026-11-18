/**
 * Encadeamento e verificação do Ledger.
 *
 * HASH DO REGISTRO = SHA-256 de  `pe-ledger/v<esquema>\n` + serializarCanonico({ cabecalho, corpo })
 * O prefixo separa este uso do hash de qualquer outro dado; o cabeçalho inclui `seq` e `prevHash`,
 * então o hash de cada registro "contém" o de todo o passado da cadeia.
 *
 * CONCORRÊNCIA (contrato para a L2, que grava): vários escritores (abas) podem tentar anexar ao
 * mesmo tempo. Quem anexa lê a ponta, cria o registro com `criarRegistro(pedido, ponta)` e grava com
 * `anexar` (armazem.ts), a ÚNICA porta de escrita: ela confere o registro, as referências e o registro
 * anterior fora da transação e, DENTRO dela, a ponta. Se outro escritor já avançou a ponta, lança
 * `ConflitoDeCadeia` e o chamador recomeça (relê a ponta e recria). A chave do armazém deve ser
 * (cadeia, seq) com `add`, que também recusa um seq repetido: duas defesas. Registro inválido lança
 * `ErroDeCadeia`, que NÃO se resolve relendo a ponta.
 */
import { descreverFalha } from './falha'; // módulo interno
import { ehHashSha256, sha256Hex } from './hash';
import type { Json } from './json';
import { serializarCanonico } from './json';
import {
  ESQUEMA_DO_TIPO,
  ESQUEMAS_SUPORTADOS,
  TIPOS_DE_REGISTRO,
  TIPOS_SOMENTE_LEITURA,
  type AncoraExterna,
  type CabecalhoLedger,
  type CodigoProblema,
  type CorpoLedger,
  type EstadoCadeia,
  type OrigemCadeia,
  type Problema,
  type RefRegistro,
  type RegistroLedger,
  type RelatorioCadeia,
  type RelatorioLedger,
  type TipoDeRegistroLido,
  type TipoRegistro,
} from './tipos';
import { motivoMalformado } from './registroValido'; // módulo interno: fora da API pública
import { ehDataIsoComDeslocamento, motivoCorpoIncompativel } from './validacao';
import { impressaoDasPoliticas, politicasVigentes, VERSAO_MOTOR } from './versao';

export class ErroDeCadeia extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeCadeia';
  }
}

/** Outro escritor avançou a cadeia: releia a ponta e recrie o registro. */
export class ConflitoDeCadeia extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ConflitoDeCadeia';
  }
}

const prefixoDeDominio = (esquema: number) => `pe-ledger/v${esquema}\n`;

/** O hash de um registro, a partir do cabeçalho e do corpo. */
export async function hashDoRegistro(
  cabecalho: CabecalhoLedger,
  corpo: CorpoLedger,
): Promise<string> {
  return sha256Hex(prefixoDeDominio(cabecalho.esquema) + serializarCanonico({ cabecalho, corpo }));
}

export interface PedidoRegistro<C extends CorpoLedger> {
  tipo: TipoRegistro;
  cadeia: string;
  /** ISO 8601 com deslocamento, do relógio do aparelho */
  criadoEm: string;
  corpo: C;
  analiseId?: string;
  eventoId?: string;
  /** obrigatório em `correcao`, proibido nos demais */
  corrige?: RefRegistro;
  /** padrão: VERSAO_MOTOR */
  versaoMotor?: string;
  /** padrão: as políticas vigentes */
  politicas?: Json;
}

/**
 * Cria o próximo registro da cadeia a partir da ponta lida (`ultimo`, null para a gênese).
 * Não grava nada. O resultado é um valor novo; `ultimo` não é alterado.
 */
export async function criarRegistro<C extends CorpoLedger>(
  pedido: PedidoRegistro<C>,
  ultimo: RegistroLedger | null,
): Promise<RegistroLedger<C>> {
  if (typeof pedido.cadeia !== 'string' || !pedido.cadeia) throw new ErroDeCadeia('cadeia vazia');
  if (TIPOS_SOMENTE_LEITURA.includes(pedido.tipo as never))
    throw new ErroDeCadeia(
      `o tipo "${pedido.tipo}" é somente leitura nesta versão: a escrita ainda não está habilitada`,
    );
  if (!TIPOS_DE_REGISTRO.includes(pedido.tipo))
    throw new ErroDeCadeia(`tipo de registro desconhecido: ${pedido.tipo}`);
  if (!ehDataIsoComDeslocamento(pedido.criadoEm))
    throw new ErroDeCadeia(`criadoEm precisa ser ISO 8601 com deslocamento: ${pedido.criadoEm}`);
  if (ultimo && ultimo.cabecalho.cadeia !== pedido.cadeia)
    throw new ErroDeCadeia('a ponta lida é de outra cadeia: cadeias nunca são fundidas');
  const seq = (ultimo?.cabecalho.seq ?? 0) + 1;
  if (pedido.tipo === 'correcao') {
    const c = pedido.corrige;
    if (!c || !Number.isInteger(c.seq) || c.seq < 1 || !ehHashSha256(c.hash))
      throw new ErroDeCadeia('correção exige `corrige` com seq e hash válidos');
    if (c.seq >= seq)
      throw new ErroDeCadeia('uma correção só pode apontar para um registro anterior');
  } else if (pedido.corrige) {
    throw new ErroDeCadeia('`corrige` só existe em registros do tipo correcao');
  }
  // inclui `corrige` com campo a mais: recusado, nunca descartado em silêncio
  const incompativel = motivoCorpoIncompativel(
    { tipo: pedido.tipo, corrige: pedido.corrige, seq, esquema: ESQUEMA_DO_TIPO[pedido.tipo] },
    pedido.corpo,
  );
  if (incompativel) throw new ErroDeCadeia(incompativel);
  const politicas = pedido.politicas ?? politicasVigentes();
  const cabecalho: CabecalhoLedger = {
    esquema: ESQUEMA_DO_TIPO[pedido.tipo],
    tipo: pedido.tipo,
    cadeia: pedido.cadeia,
    seq,
    prevHash: ultimo ? ultimo.hash : null,
    criadoEm: pedido.criadoEm,
    versaoMotor: pedido.versaoMotor ?? VERSAO_MOTOR,
    impressaoPoliticas: await impressaoDasPoliticas(politicas),
    politicas,
    ...(pedido.analiseId !== undefined ? { analiseId: pedido.analiseId } : {}),
    ...(pedido.eventoId !== undefined ? { eventoId: pedido.eventoId } : {}),
    ...(pedido.corrige ? { corrige: { seq: pedido.corrige.seq, hash: pedido.corrige.hash } } : {}),
  };
  return { cabecalho, corpo: pedido.corpo, hash: await hashDoRegistro(cabecalho, pedido.corpo) };
}

/**
 * Confere o registro SOZINHO, sem olhar a cadeia: forma, esquema, data, corpo coerente com o tipo e
 * hash declarado igual ao hash recalculado. Lança ErroDeCadeia (nunca ConflitoDeCadeia: reler a
 * ponta e tentar de novo não conserta um registro inválido). É assíncrona (SHA-256 nativo): por isso
 * roda na Fase A da gravação (`verificarReferencias`), ANTES de abrir a transação de IndexedDB, que se
 * encerra ao aguardar algo que não seja do próprio banco. Só confere; não grava.
 */
export async function conferirRegistro(novo: RegistroLedger): Promise<void> {
  const malformado = motivoMalformado(novo);
  if (malformado) throw new ErroDeCadeia(`registro recusado: ${malformado}`);
  if (!ESQUEMAS_SUPORTADOS.includes(novo.cabecalho.esquema))
    throw new ErroDeCadeia(`registro recusado: esquema ${novo.cabecalho.esquema} não suportado`);
  // esta versão só LÊ o fechamento (esquema 2): conferirRegistro é o portão de escrita e o recusa
  if (!TIPOS_DE_REGISTRO.includes(novo.cabecalho.tipo as TipoRegistro))
    throw new ErroDeCadeia(
      `registro recusado: o tipo "${novo.cabecalho.tipo}" é somente leitura nesta versão (a escrita ainda não está habilitada)`,
    );
  if (!ehDataIsoComDeslocamento(novo.cabecalho.criadoEm))
    throw new ErroDeCadeia(
      `registro recusado: criadoEm precisa ser ISO 8601 com deslocamento: ${novo.cabecalho.criadoEm}`,
    );
  const incompativel = motivoCorpoIncompativel(novo.cabecalho, novo.corpo);
  if (incompativel) throw new ErroDeCadeia(`registro recusado: ${incompativel}`);
  let recalculado: string;
  try {
    recalculado = await hashDoRegistro(novo.cabecalho, novo.corpo);
  } catch (e) {
    throw new ErroDeCadeia(`registro recusado: conteúdo não serializável (${descreverFalha(e)})`);
  }
  if (recalculado !== novo.hash)
    throw new ErroDeCadeia(
      'registro recusado: o hash declarado não é o do conteúdo (registro alterado ou forjado)',
    );
}

// ─────────────── verificação

const ADULTERADOS: ReadonlySet<CodigoProblema> = new Set([
  'registro_malformado',
  'hash_invalido',
  'prevhash_nao_confere',
  'genese_com_prevhash',
  'seq_duplicada',
  'continuidade_artificial',
  'ancora_diverge',
  'data_invalida',
  'corpo_incompativel',
  'correcao_hash_diverge',
  'decisao_hash_diverge',
  'decisao_tipo_incorreto',
  'decisao_nao_anterior',
  'referencia_outra_cadeia',
  'fechamento_hash_diverge',
  'fechamento_tipo_incorreto',
  'fechamento_nao_anterior',
]);
// `correcao_referencia_ausente` é incompleta, não adulterada: numa cadeia contígua desde o seq 1 o
// registro corrigido (seq menor) sempre existe; ele só falta numa cópia parcial ou com lacuna.
const INCOMPLETOS: ReadonlySet<CodigoProblema> = new Set([
  'sem_genese',
  'lacuna_de_seq',
  'ancora_ausente',
  'correcao_referencia_ausente',
  'decisao_referencia_ausente',
  'fechamento_referencia_ausente',
]);

/** Os códigos de problema de cada referência do corpo (`decisao` e `aposta` do fechamento). */
const CODIGOS_DA_REFERENCIA: Record<
  'decisao' | 'aposta',
  {
    naoAnterior: CodigoProblema;
    ausente: CodigoProblema;
    hashDiverge: CodigoProblema;
    tipoIncorreto: CodigoProblema;
    artigo: string;
    nome: string;
  }
> = {
  decisao: {
    naoAnterior: 'decisao_nao_anterior',
    ausente: 'decisao_referencia_ausente',
    hashDiverge: 'decisao_hash_diverge',
    tipoIncorreto: 'decisao_tipo_incorreto',
    artigo: 'a',
    nome: 'decisão',
  },
  aposta: {
    naoAnterior: 'fechamento_nao_anterior',
    ausente: 'fechamento_referencia_ausente',
    hashDiverge: 'fechamento_hash_diverge',
    tipoIncorreto: 'fechamento_tipo_incorreto',
    artigo: 'a',
    nome: 'aposta',
  },
};

/** Uma referência `{seq, hash}` que um registro faz a outro da MESMA cadeia. */
export interface ReferenciaDoRegistro {
  /** onde a referência está: o `corrige` do cabeçalho, o `decisao` ou o `aposta` (fechamento) do corpo */
  campo: 'corrige' | 'decisao' | 'aposta';
  seq: number;
  hash: string;
  /** tipo que o registro apontado precisa ter (null: qualquer registro anterior) */
  tipoExigido: TipoDeRegistroLido | null;
}

/**
 * As referências de um registro a outros: `corrige` (correção, qualquer tipo anterior), `decisao`
 * (aposta_registrada e resultado, que exigem o tipo `decisao`) e `aposta` (fechamento, que exige o
 * tipo `aposta_registrada`). Só lê a forma; um registro com forma inválida devolve lista vazia (quem
 * acusa isso é `motivoCorpoIncompativel`).
 */
export function referenciasDoRegistro(r: RegistroLedger): ReferenciaDoRegistro[] {
  const lista: ReferenciaDoRegistro[] = [];
  const c = r.cabecalho.corrige;
  if (r.cabecalho.tipo === 'correcao' && c && Number.isInteger(c.seq) && ehHashSha256(c.hash))
    lista.push({ campo: 'corrige', seq: c.seq, hash: c.hash, tipoExigido: null });
  if (r.cabecalho.tipo === 'aposta_registrada' || r.cabecalho.tipo === 'resultado') {
    const d = (r.corpo as { decisao?: unknown } | null)?.decisao;
    if (typeof d === 'object' && d !== null) {
      const ref = d as { seq?: unknown; hash?: unknown };
      if (Number.isInteger(ref.seq) && ehHashSha256(ref.hash))
        lista.push({
          campo: 'decisao',
          seq: ref.seq as number,
          hash: ref.hash as string,
          tipoExigido: 'decisao',
        });
    }
  }
  if (r.cabecalho.tipo === 'fechamento') {
    const a = (r.corpo as { aposta?: unknown } | null)?.aposta;
    if (typeof a === 'object' && a !== null) {
      const ref = a as { seq?: unknown; hash?: unknown };
      if (Number.isInteger(ref.seq) && ehHashSha256(ref.hash))
        lista.push({
          campo: 'aposta',
          seq: ref.seq as number,
          hash: ref.hash as string,
          tipoExigido: 'aposta_registrada',
        });
    }
  }
  return lista;
}

function estadoDe(problemas: Problema[]): EstadoCadeia {
  if (problemas.some((p) => ADULTERADOS.has(p.codigo))) return 'adulterada';
  if (problemas.some((p) => p.codigo === 'esquema_incompativel')) return 'incompativel';
  if (problemas.some((p) => INCOMPLETOS.has(p.codigo))) return 'incompleta';
  return 'integra';
}

const origemDe = (cadeia: string, cadeiaLocal?: string): OrigemCadeia =>
  cadeiaLocal === undefined ? 'indeterminada' : cadeia === cadeiaLocal ? 'local' : 'importada';

export interface OpcoesVerificacao {
  /**
   * Os esquemas que o verificador conhece (padrão: `ESQUEMAS_SUPORTADOS`). Serve para verificar COMO
   * um verificador mais antigo (por exemplo `[1]`, o da etapa anterior ao esquema 2) e testar a
   * compatibilidade entre versões; os demais esquemas viram `esquema_incompativel`.
   */
  esquemasSuportados?: readonly number[];
  /** a cadeia do próprio aparelho: define quais são "importadas" (nunca fundidas com a local) */
  cadeiaLocal?: string;
  /** hash da ponta guardado fora do aparelho; só vale para a cadeia dele */
  ancora?: AncoraExterna;
}

/**
 * Verifica UMA cadeia (todos os registros com o mesmo `cadeia`). A ordem do array não importa.
 *
 * Estados (a ordem de precedência é adulterada > incompatível > incompleta > íntegra):
 *  - integra:     gênese presente (seq 1 com prevHash null), seqs contíguos, todo hash recalculado
 *                 confere e todo prevHash é o hash do anterior.
 *  - incompleta:  nada adulterado entre o que existe, mas faltam registros (não começa no seq 1 ou
 *                 há lacuna de seq). Cópia parcial e remoção NÃO são distinguíveis só pela cadeia;
 *                 truncar o FIM só é detectável com âncora externa.
 *  - adulterada:  hash que não confere, prevHash que não bate, seq duplicado com conteúdo diferente,
 *                 gênese com prevHash, registro malformado, continuidade artificial ou âncora que diverge.
 *  - incompativel: há registro de esquema que este código não sabe verificar. Não é "ok" nem "adulterado".
 * A reprodução do motor é OUTRA coisa (reproducao.ts) e nunca muda o estado da cadeia.
 */
export async function verificarCadeia(
  registros: readonly RegistroLedger[],
  opcoes: OpcoesVerificacao = {},
): Promise<RelatorioCadeia> {
  const suportados = opcoes.esquemasSuportados ?? ESQUEMAS_SUPORTADOS;
  const problemas: Problema[] = [];
  const validos: RegistroLedger[] = [];
  for (const r of registros) {
    const m = motivoMalformado(r, suportados);
    if (m) problemas.push({ codigo: 'registro_malformado', detalhe: m });
    else validos.push(r);
  }
  const cadeia = validos[0]?.cabecalho.cadeia ?? opcoes.ancora?.cadeia ?? '';
  if (validos.some((r) => r.cabecalho.cadeia !== cadeia))
    throw new ErroDeCadeia('verificarCadeia recebe uma cadeia só; use verificarLedger para várias');

  // mesmo seq: cópia idêntica é ignorada (importação repetida); conteúdo diferente é adulteração
  const porSeq = new Map<number, RegistroLedger>();
  for (const r of validos) {
    const ja = porSeq.get(r.cabecalho.seq);
    if (!ja) porSeq.set(r.cabecalho.seq, r);
    else if (ja.hash !== r.hash)
      problemas.push({
        codigo: 'seq_duplicada',
        seq: r.cabecalho.seq,
        detalhe: 'dois registros diferentes com o mesmo seq',
      });
  }
  const ordenados = [...porSeq.values()].sort((a, b) => a.cabecalho.seq - b.cabecalho.seq);

  for (const r of ordenados) {
    if (!suportados.includes(r.cabecalho.esquema)) {
      problemas.push({
        codigo: 'esquema_incompativel',
        seq: r.cabecalho.seq,
        detalhe: `esquema ${r.cabecalho.esquema} não é verificável por esta versão (suporta ${suportados.join(', ')})`,
      });
      continue;
    }
    // coerência semântica do esquema 1 (a data e o corpo do tipo): independe de o hash conferir
    if (!ehDataIsoComDeslocamento(r.cabecalho.criadoEm))
      problemas.push({
        codigo: 'data_invalida',
        seq: r.cabecalho.seq,
        detalhe: `criadoEm não é ISO 8601 com deslocamento: ${r.cabecalho.criadoEm}`,
      });
    const incompativel = motivoCorpoIncompativel(r.cabecalho, r.corpo);
    if (incompativel)
      problemas.push({ codigo: 'corpo_incompativel', seq: r.cabecalho.seq, detalhe: incompativel });
    let recalculado: string | null = null;
    try {
      recalculado = await hashDoRegistro(r.cabecalho, r.corpo);
    } catch (e) {
      problemas.push({
        codigo: 'hash_invalido',
        seq: r.cabecalho.seq,
        detalhe: `conteúdo não serializável: ${descreverFalha(e)}`,
      });
      continue;
    }
    if (recalculado !== r.hash)
      problemas.push({
        codigo: 'hash_invalido',
        seq: r.cabecalho.seq,
        detalhe: 'o hash recalculado não é o gravado: o registro foi alterado',
      });
  }

  // correções: o registro apontado tem de existir nesta cadeia e ter o hash declarado em `corrige`
  for (const r of ordenados) {
    if (r.cabecalho.tipo !== 'correcao' || !suportados.includes(r.cabecalho.esquema)) continue;
    if (motivoCorpoIncompativel(r.cabecalho, r.corpo) !== null) continue; // já acusado acima
    const alvo = r.cabecalho.corrige!;
    const apontado = porSeq.get(alvo.seq);
    if (!apontado)
      problemas.push({
        codigo: 'correcao_referencia_ausente',
        seq: r.cabecalho.seq,
        detalhe: `a correção aponta para o registro ${alvo.seq}, que não está nesta cadeia`,
      });
    else if (apontado.hash !== alvo.hash)
      problemas.push({
        codigo: 'correcao_hash_diverge',
        seq: r.cabecalho.seq,
        detalhe: `o hash em \`corrige\` não é o do registro ${alvo.seq}: a correção aponta para outro conteúdo`,
      });
  }

  // referências do CORPO a registros anteriores da MESMA cadeia: `decisao` (aposta_registrada e
  // resultado, que exigem o tipo decisao) e `aposta` (fechamento, que exige aposta_registrada). O
  // apontado tem de ser anterior, existir, ter o hash declarado e ser do tipo exigido.
  for (const r of ordenados) {
    if (!suportados.includes(r.cabecalho.esquema)) continue;
    if (motivoCorpoIncompativel(r.cabecalho, r.corpo) !== null) continue; // já acusado acima
    const ref = referenciasDoRegistro(r).find((x) => x.campo === 'decisao' || x.campo === 'aposta');
    if (!ref) continue;
    const c = CODIGOS_DA_REFERENCIA[ref.campo as 'decisao' | 'aposta'];
    const seq = r.cabecalho.seq;
    if (ref.seq >= seq) {
      problemas.push({
        codigo: c.naoAnterior,
        seq,
        detalhe: `${c.artigo} ${c.nome} apontada (seq ${ref.seq}) não é anterior ao registro (seq ${seq})`,
      });
      continue;
    }
    const apontado = porSeq.get(ref.seq);
    if (!apontado)
      problemas.push({
        codigo: c.ausente,
        seq,
        detalhe: `o registro aponta para ${c.artigo} ${c.nome} ${ref.seq}, que não está nesta cadeia`,
      });
    else if (apontado.hash !== ref.hash)
      problemas.push({
        codigo: c.hashDiverge,
        seq,
        detalhe: `o hash em \`${ref.campo}\` não é o do registro ${ref.seq}: aponta para outro conteúdo`,
      });
    else if (apontado.cabecalho.tipo !== ref.tipoExigido)
      problemas.push({
        codigo: c.tipoIncorreto,
        seq,
        detalhe: `o registro ${ref.seq} apontado em \`${ref.campo}\` é do tipo "${apontado.cabecalho.tipo}", não "${ref.tipoExigido}"`,
      });
  }

  if (ordenados.length === 0) {
    problemas.push({ codigo: 'sem_genese', detalhe: 'cadeia vazia' });
  } else {
    const primeiro = ordenados[0];
    if (primeiro.cabecalho.seq === 1) {
      if (primeiro.cabecalho.prevHash !== null)
        problemas.push({
          codigo: 'genese_com_prevhash',
          seq: 1,
          detalhe:
            'o primeiro registro aponta para um anterior: continuidade artificial com outra cadeia',
        });
    } else {
      problemas.push({
        codigo: 'sem_genese',
        seq: primeiro.cabecalho.seq,
        detalhe: `a cadeia começa no seq ${primeiro.cabecalho.seq}: faltam os anteriores`,
      });
    }
    for (let i = 1; i < ordenados.length; i++) {
      const a = ordenados[i - 1];
      const b = ordenados[i];
      if (b.cabecalho.seq === a.cabecalho.seq + 1) {
        if (b.cabecalho.prevHash !== a.hash)
          problemas.push({
            codigo: 'prevhash_nao_confere',
            seq: b.cabecalho.seq,
            detalhe: `prevHash não é o hash do registro ${a.cabecalho.seq}`,
          });
      } else {
        problemas.push({
          codigo: 'lacuna_de_seq',
          seq: b.cabecalho.seq,
          detalhe: `faltam os registros ${a.cabecalho.seq + 1} a ${b.cabecalho.seq - 1}`,
        });
      }
    }
  }

  const a = opcoes.ancora;
  if (a && a.cadeia === cadeia) {
    const noSeq = porSeq.get(a.seq);
    const ultimo = ordenados.at(-1)?.cabecalho.seq ?? 0;
    if (noSeq) {
      if (noSeq.hash !== a.hash)
        problemas.push({
          codigo: 'ancora_diverge',
          seq: a.seq,
          detalhe: 'o hash neste seq não é o ancorado fora do aparelho: o passado foi refeito',
        });
    } else if (ultimo < a.seq) {
      problemas.push({
        codigo: 'ancora_ausente',
        seq: a.seq,
        detalhe: `a âncora é do seq ${a.seq}, mas a cadeia termina no ${ultimo}: foi truncada ou é cópia parcial`,
      });
    } else {
      problemas.push({
        codigo: 'ancora_ausente',
        seq: a.seq,
        detalhe: `o registro ${a.seq} ancorado não está nesta cópia`,
      });
    }
  }

  const fim = ordenados.at(-1) ?? null;
  return {
    cadeia,
    estado: estadoDe(problemas),
    origem: origemDe(cadeia, opcoes.cadeiaLocal),
    total: ordenados.length,
    primeiroSeq: ordenados[0]?.cabecalho.seq ?? null,
    ultimoSeq: fim?.cabecalho.seq ?? null,
    hashPonta: fim?.hash ?? null,
    problemas,
  };
}

/**
 * Verifica um conjunto qualquer de registros: separa por cadeia, verifica cada uma e acusa
 * continuidade artificial (um registro cujo prevHash é o hash de registro de OUTRA cadeia).
 * Cadeias importadas mantêm a própria identidade; nada aqui as liga à cadeia local.
 */
export async function verificarLedger(
  registros: readonly RegistroLedger[],
  opcoes: OpcoesVerificacao = {},
): Promise<RelatorioLedger> {
  const suportados = opcoes.esquemasSuportados ?? ESQUEMAS_SUPORTADOS;
  const grupos = new Map<string, RegistroLedger[]>();
  const malformados: Problema[] = [];
  const donoDoHash = new Map<string, string>();
  for (const r of registros) {
    const m = motivoMalformado(r, suportados);
    if (m) {
      malformados.push({ codigo: 'registro_malformado', detalhe: m });
      continue;
    }
    const lista = grupos.get(r.cabecalho.cadeia) ?? [];
    lista.push(r);
    grupos.set(r.cabecalho.cadeia, lista);
    donoDoHash.set(r.hash, r.cabecalho.cadeia);
  }
  const cadeias: RelatorioCadeia[] = [];
  for (const [id, lista] of [...grupos.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    const rel = await verificarCadeia(lista, opcoes);
    for (const r of lista) {
      const p = r.cabecalho.prevHash;
      if (p !== null && donoDoHash.has(p) && donoDoHash.get(p) !== id)
        rel.problemas.push({
          codigo: 'continuidade_artificial',
          seq: r.cabecalho.seq,
          detalhe: `prevHash é o hash de um registro da cadeia "${donoDoHash.get(p)}": cadeias distintas não se encadeiam`,
        });
    }
    // referências (corrige e decisao) a um registro de OUTRA cadeia: as cadeias não se referenciam
    for (const r of lista) {
      if (!suportados.includes(r.cabecalho.esquema)) continue;
      if (motivoCorpoIncompativel(r.cabecalho, r.corpo) !== null) continue;
      for (const ref of referenciasDoRegistro(r)) {
        const dono = donoDoHash.get(ref.hash);
        if (dono !== undefined && dono !== id)
          rel.problemas.push({
            codigo: 'referencia_outra_cadeia',
            seq: r.cabecalho.seq,
            detalhe: `\`${ref.campo}\` aponta para um registro da cadeia "${dono}": cadeias distintas não se referenciam`,
          });
      }
    }
    rel.estado = estadoDe(rel.problemas);
    cadeias.push(rel);
  }
  if (malformados.length)
    cadeias.push({
      cadeia: '(registros malformados)',
      estado: 'adulterada',
      origem: 'indeterminada',
      total: malformados.length,
      primeiroSeq: null,
      ultimoSeq: null,
      hashPonta: null,
      problemas: malformados,
    });
  return { cadeias };
}
