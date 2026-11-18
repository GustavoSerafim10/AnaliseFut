/**
 * Contrato de GRAVAÇÃO do Ledger, independente do banco: o que um armazém (a futura L2, em
 * IndexedDB) precisa oferecer e a ordem exata em que o anexo é conferido e gravado. Aqui não há
 * IndexedDB, interface nem hooks: só a lógica pura, que roda dentro de qualquer armazém que cumpra
 * `ArmazemLedger`, e que os testes exercitam com um armazém em memória.
 *
 * Duas fases, porque o SHA-256 nativo é assíncrono e uma transação de IndexedDB se encerra ao
 * aguardar algo que não seja do próprio banco:
 *
 *  FASE A (`verificarReferencias`, assíncrona, FORA da transação de escrita): para cada referência
 *    do registro (`corrige` de uma correção, `decisao` de aposta e resultado) E para o REGISTRO
 *    ANTERIOR (`seq − 1`, ao qual o novo se encadeia por `prevHash`), lê o registro, confere a forma
 *    e a identidade, RECALCULA o hash do conteúdo e exige que seja o gravado (um registro adulterado
 *    com o hash antigo é recusado), exige que seja um registro VÁLIDO (`motivoRegistroInvalido`: tipo
 *    × esquema, corpo × tipo, data; o hash correto não basta) e guarda a representação canônica do
 *    que foi verificado. A sequência de conteúdo é UMA só (`conteudoVerificado`) para os dois casos.
 *
 *  FASE B (`anexarNaTransacao`, SÍNCRONA, DENTRO da transação): relê a ponta e os apontados na mesma
 *    transação que grava e só aceita se a representação canônica de cada um for exatamente a
 *    verificada na Fase A. Como o hash é função determinística do conteúdo, conteúdo idêntico ao
 *    verificado equivale a ter o hash recalculado dentro da transação. A Fase B só aceita o que a
 *    Fase A verificou para ESTE registro: a AUTORIZAÇÃO (`ReferenciasVerificadas`) que só
 *    `verificarReferencias` emite, congelada e registrada num `WeakMap` privado deste módulo junto
 *    com a CÓPIA CANÔNICA do registro novo que a Fase A conferiu. A Fase B grava essa cópia, nunca o
 *    objeto do chamador: o que é persistido é exatamente o que foi validado e autorizado.
 *
 * `anexar` é a ÚNICA porta pública de escrita; `verificarReferencias` + `anexarNaTransacao` são as
 * duas metades dela, para quem já tem a própria transação, e a segunda só grava com uma autorização
 * emitida pela primeira.
 */
import { descreverFalha } from './falha'; // módulo interno
import {
  conferirRegistro,
  ConflitoDeCadeia,
  ErroDeCadeia,
  hashDoRegistro,
  referenciasDoRegistro,
  type ReferenciaDoRegistro,
} from './cadeia';
import { serializarCanonico } from './json';
import { motivoMalformado, motivoRegistroInvalido } from './registroValido'; // módulo interno
import {
  ESQUEMAS_SUPORTADOS,
  TIPOS_DE_REGISTRO,
  type RegistroLedger,
  type TipoRegistro,
} from './tipos';

/** O que o armazém entrega DENTRO de uma transação: leituras e gravação sobre o mesmo instantâneo. */
export interface TransacaoLedger {
  /** o registro de maior `seq` da cadeia, lido nesta transação (null se a cadeia não existe) */
  ponta(cadeia: string): RegistroLedger | null;
  /** o registro `(cadeia, seq)`, lido nesta transação (null se não existe) */
  ler(cadeia: string, seq: number): RegistroLedger | null;
  /** grava (como `add`: a chave `(cadeia, seq)` repetida é recusada pelo próprio armazém) */
  adicionar(registro: RegistroLedger): void;
}

export interface ArmazemLedger {
  /**
   * Executa `corpo` numa transação de leitura e escrita. `corpo` é SÍNCRONO. Se lançar, nada do que
   * ele gravou fica (rollback); se terminar, tudo é confirmado de uma vez.
   */
  transacao<T>(corpo: (tx: TransacaoLedger) => T): Promise<T>;
  /** leitura `(cadeia, seq)` fora da transação de escrita (Fase A); null se não existe */
  ler(cadeia: string, seq: number): Promise<RegistroLedger | null>;
}

const rotuloDe = (ref: ReferenciaDoRegistro) => (ref.campo === 'corrige' ? 'correção' : 'registro');
const quemDe = (ref: ReferenciaDoRegistro) =>
  ref.campo === 'corrige'
    ? 'que ela corrige'
    : ref.campo === 'decisao'
      ? 'da decisão apontada'
      : 'da aposta apontada';

/** início das mensagens de recusa sobre o registro apontado por uma referência */
const prefixoDe = (ref: ReferenciaDoRegistro) =>
  `${rotuloDe(ref)} recusado: o registro ${ref.seq} apontado`;

/**
 * FOTOGRAFIA de um valor devolvido pelo armazém: a ÚNICA leitura dele. `serializarCanonico` lê cada
 * propriedade uma vez (getters e Proxies incluídos); desse texto, `JSON.parse` gera uma cópia de dados
 * puros, independente do original, que é congelada em profundidade. Exceções do valor (getter que
 * lança, Proxy, conteúdo não serializável) viram um MOTIVO de recusa, nunca uma exceção crua.
 * Devolve a cópia ou o motivo da recusa (forma conferida sobre a cópia).
 */
function fotografar(lido: unknown): { copia: RegistroLedger } | { motivo: string } {
  let texto: string;
  try {
    texto = serializarCanonico(lido);
  } catch (e) {
    return { motivo: `não serializável: ${mensagemDe(e)}` };
  }
  const copia = congelarProfundo(JSON.parse(texto) as unknown);
  const malformado = motivoMalformado(copia);
  if (malformado) return { motivo: `registro malformado: ${malformado}` };
  return { copia: copia as RegistroLedger };
}

/**
 * CÓPIA do registro devolvido pelo armazém para uma referência ou para o registro anterior: `null`
 * continua `null` (a ausência é tratada por quem chama, com a mensagem própria); qualquer outro valor é
 * fotografado UMA vez e só a cópia é usada daí em diante. Usada nas duas fases, para que se recuse a
 * mesma coisa da mesma forma: `ErroDeCadeia`, nunca `TypeError` nem a exceção crua do valor.
 * `prefixo` começa a mensagem ("... o registro N apontado", "... o registro anterior").
 */
function copiaDoArmazem(lido: unknown, prefixo: string): RegistroLedger | null {
  if (lido === null) return null;
  const foto = fotografar(lido);
  if ('motivo' in foto) throw new ErroDeCadeia(`${prefixo} é inválido (${foto.motivo})`);
  return foto.copia;
}

/** a mensagem de uma exceção qualquer */
function mensagemDe(e: unknown): string {
  return descreverFalha(e);
}

/**
 * O valor lançado é um erro do PRÓPRIO Ledger (`ErroDeCadeia` / `ConflitoDeCadeia`), que deve passar
 * como está? `instanceof` consulta o protótipo do valor, e um Proxy lançado pode ter um
 * `getPrototypeOf` que lança: nesse caso não é erro do Ledger. Nunca lança.
 */
function ehErroDoLedger(e: unknown): boolean {
  try {
    return e instanceof ErroDeCadeia || e instanceof ConflitoDeCadeia;
  } catch {
    return false;
  }
}

/**
 * Leitura do armazém FORA da transação (Fase A). Uma falha da própria leitura vira `ErroDeCadeia`;
 * um `ErroDeCadeia` ou `ConflitoDeCadeia` que o armazém tenha lançado passa como está.
 */
async function lerForaDaTransacao(
  armazem: ArmazemLedger,
  cadeia: string,
  seq: number,
  prefixo: string,
): Promise<unknown> {
  try {
    return await armazem.ler(cadeia, seq);
  } catch (e) {
    if (ehErroDoLedger(e)) throw e;
    throw new ErroDeCadeia(`${prefixo}: a leitura do armazém falhou (${mensagemDe(e)})`);
  }
}

/**
 * Leitura DENTRO da transação (Fase B), síncrona. Mesma regra: a falha da leitura vira `ErroDeCadeia`,
 * e os erros do próprio Ledger passam como estão.
 */
function lerNaTransacao<T>(ler: () => T, prefixo: string): T {
  try {
    return ler();
  } catch (e) {
    if (ehErroDoLedger(e)) throw e;
    throw new ErroDeCadeia(`${prefixo}: a leitura na transação falhou (${mensagemDe(e)})`);
  }
}

/**
 * Fase A, CONTEÚDO de um registro já conferido na forma e na identidade: esquema suportado, hash
 * RECALCULADO igual ao gravado e validade semântica (`motivoRegistroInvalido`). É a MESMA sequência
 * para as referências e para o registro anterior: uma regra só. Recebe SEMPRE a cópia congelada de
 * dados puros (`copiaDoArmazem`), nunca o objeto do armazém: o hash, a semântica e a representação
 * canônica devolvida (a que a Fase B vai exigir) são do MESMO conteúdo. Toda recusa é `ErroDeCadeia`
 * (reler não conserta um registro adulterado).
 */
async function conteudoVerificado(registro: RegistroLedger, prefixo: string): Promise<string> {
  if (!ESQUEMAS_SUPORTADOS.includes(registro.cabecalho.esquema))
    throw new ErroDeCadeia(`${prefixo} é de um esquema não suportado`);
  let recalculado: string;
  try {
    recalculado = await hashDoRegistro(registro.cabecalho, registro.corpo);
  } catch (e) {
    throw new ErroDeCadeia(`${prefixo} não é serializável (${descreverFalha(e)})`);
  }
  if (recalculado !== registro.hash)
    throw new ErroDeCadeia(
      `${prefixo} foi alterado (o hash recalculado do conteúdo não é o gravado)`,
    );
  // conferir o hash não basta: um registro inválido (corpo × tipo, tipo × esquema, data) também tem
  // hash correto. A validade SEMÂNTICA vem do validador de LEITURA, que aceita os tipos somente
  // leitura (o fechamento) e não depende dos bloqueios de escrita.
  const invalido = motivoRegistroInvalido(registro);
  if (invalido) throw new ErroDeCadeia(`${prefixo} é inválido (${invalido})`);
  return serializarCanonico(registro);
}

/**
 * O registro anterior verificado na Fase A (o que a ponta tem de ser na Fase B). Exportado só como
 * TIPO, porque aparece no tipo público `ReferenciasVerificadas`; não há valor nem construtor público.
 */
export interface AnteriorVerificado {
  readonly seq: number;
  readonly hash: string;
  /** `serializarCanonico` do registro anterior, como foi verificado */
  readonly canonico: string;
}

/**
 * Fase A, REGISTRO ANTERIOR (`seq − 1`), ao qual o novo se encadeia por `prevHash`: lido fora da
 * transação e verificado como uma referência. Na gênese (`seq` 1) não há anterior: devolve null.
 *  - ausente, ou com o campo `hash` diferente do `prevHash` do novo: `ConflitoDeCadeia` (o novo foi
 *    montado sobre outra ponta: reler e recriar), a mesma resposta que `conferirPonta` dá;
 *  - lixo, outra cadeia ou posição, esquema não suportado, adulterado ou inválido: `ErroDeCadeia`.
 */
async function verificarAnterior(
  armazem: ArmazemLedger,
  novo: RegistroLedger,
): Promise<AnteriorVerificado | null> {
  const { cadeia, seq, prevHash } = novo.cabecalho;
  if (seq === 1) return null;
  const n = seq - 1;
  const prefixo = `registro recusado: o registro anterior (seq ${n})`;
  const bruto = await lerForaDaTransacao(armazem, cadeia, n, prefixo);
  // UMA leitura do que o armazém devolveu; daqui em diante, só a cópia (o original não é relido)
  const anterior = copiaDoArmazem(bruto, prefixo);
  if (anterior === null)
    throw new ConflitoDeCadeia(
      `o registro anterior (seq ${n}) não está no armazém: releia a ponta e recrie o registro`,
    );
  if (anterior.cabecalho.cadeia !== cadeia || anterior.cabecalho.seq !== n)
    throw new ErroDeCadeia(`${prefixo} lido não é o dessa cadeia e posição`);
  if (anterior.hash !== prevHash)
    throw new ConflitoDeCadeia(
      `prevHash não é o hash do registro anterior gravado (seq ${n}): releia a ponta e recrie o registro`,
    );
  return { seq: n, hash: anterior.hash, canonico: await conteudoVerificado(anterior, prefixo) };
}

/**
 * GUARDA DA PONTA: confere o que `tx.ponta` devolveu antes de `conferirPonta` tocar em `cabecalho`.
 * O contrato é `RegistroLedger | null`:
 *  - `null` é a cadeia VAZIA, legítima (a gênese continua sendo aceita);
 *  - `undefined` viola o contrato e é recusado (não é confundido com cadeia vazia: `?.` trataria os
 *    dois do mesmo jeito e uma ponta perdida viraria uma gênese);
 *  - objeto malformado ou valor que nem é objeto: recusado.
 * Qualquer outro valor é FOTOGRAFADO uma vez (`fotografar`): a ponta devolvida é a cópia congelada de
 * dados puros, e o original não é relido. A recusa é `ErroDeCadeia` (reler não conserta um armazém
 * que devolve lixo), nunca `TypeError` nem a exceção crua de um getter ou Proxy.
 */
function pontaConferida(lida: unknown): RegistroLedger | null {
  if (lida === null) return null;
  if (lida === undefined)
    throw new ErroDeCadeia(
      'recusado: a ponta lida na transação é inválida (ausente (undefined; o contrato é um registro ou null))',
    );
  // UMA leitura da ponta; daqui em diante, só a cópia congelada (o original não é relido)
  const foto = fotografar(lida);
  if ('motivo' in foto)
    throw new ErroDeCadeia(`recusado: a ponta lida na transação é inválida (${foto.motivo})`);
  return foto.copia;
}

/**
 * Identidade da ponta, SÍNCRONA, dentro da transação (depois de `pontaConferida`): `novo` continua
 * exatamente a ponta gravada agora (mesma cadeia, `seq` seguinte, `prevHash` = hash da ponta). Lança
 * `ConflitoDeCadeia` se outro escritor chegou antes. Interna: a única porta de escrita é
 * `anexar` / `anexarNaTransacao`, que a chamam sobre uma ponta cuja forma já foi conferida.
 */
function conferirPonta(pontaGravada: RegistroLedger | null, novo: RegistroLedger): void {
  const seqEsperado = (pontaGravada?.cabecalho.seq ?? 0) + 1;
  if (pontaGravada && pontaGravada.cabecalho.cadeia !== novo.cabecalho.cadeia)
    throw new ConflitoDeCadeia('a ponta gravada é de outra cadeia');
  if (novo.cabecalho.seq !== seqEsperado)
    throw new ConflitoDeCadeia(
      `outro escritor avançou a cadeia: esperado seq ${seqEsperado}, recebido ${novo.cabecalho.seq}`,
    );
  const prevEsperado = pontaGravada ? pontaGravada.hash : null;
  if (novo.cabecalho.prevHash !== prevEsperado)
    throw new ConflitoDeCadeia('prevHash não é o hash da ponta gravada');
}

/**
 * Confere, de forma SÍNCRONA, o registro lido para uma referência: existe, é desta cadeia e desta
 * posição, vem antes do registro novo, tem exatamente o hash declarado e o tipo exigido. Recusa com
 * `ErroDeCadeia` (não é conflito: reler a ponta não conserta uma referência inválida).
 */
export function conferirApontado(
  apontado: RegistroLedger | null,
  novo: RegistroLedger,
  ref: ReferenciaDoRegistro,
): asserts apontado is RegistroLedger {
  const recusa = (motivo: string): never => {
    throw new ErroDeCadeia(`${rotuloDe(ref)} recusado: ${motivo}`);
  };
  if (!apontado) return recusa(`o registro ${ref.seq} ${quemDe(ref)} não existe na cadeia`);
  if (apontado.cabecalho.cadeia !== novo.cabecalho.cadeia || apontado.cabecalho.seq !== ref.seq)
    return recusa(`o registro lido para o seq ${ref.seq} não é o dessa cadeia e posição`);
  if (ref.seq >= novo.cabecalho.seq)
    return recusa(`o registro ${ref.seq} apontado não é anterior ao registro novo`);
  if (apontado.hash !== ref.hash)
    return recusa(`o hash em \`${ref.campo}\` não é o do registro ${ref.seq} gravado`);
  if (ref.tipoExigido && apontado.cabecalho.tipo !== ref.tipoExigido)
    return recusa(
      `o registro ${ref.seq} apontado é do tipo "${apontado.cabecalho.tipo}", e o exigido é "${ref.tipoExigido}"`,
    );
}

/**
 * Conferência síncrona da referência `corrige` de uma correção (existência, cadeia, posição, hash).
 * Para registros que não são correção, não faz nada. Não recalcula hash: isso é a Fase A.
 */
export function conferirReferencia(apontado: RegistroLedger | null, novo: RegistroLedger): void {
  if (novo.cabecalho.tipo !== 'correcao') return;
  const ref = referenciasDoRegistro(novo).find((r) => r.campo === 'corrige');
  if (!ref) throw new ErroDeCadeia('correção recusada: o cabeçalho não tem `corrige` válido');
  conferirApontado(apontado, novo, ref);
}

/** marca de TIPO (só em compilação): impede montar o valor à mão sem um cast. NUNCA exportada. */
declare const verificadasPelaFaseA: unique symbol;

/**
 * AUTORIZAÇÕES EMITIDAS pela Fase A deste módulo, cada uma ligada à CÓPIA CANÔNICA do registro que ela
 * autoriza (a única coisa que a Fase B grava). É a garantia em TEMPO DE EXECUÇÃO: a Fase B só aceita
 * um objeto que esteja aqui, e só `verificarReferencias` insere. Um objeto montado à mão, uma cópia
 * (espalhamento, JSON, `structuredClone`) ou uma reconstrução não está, ainda que tenha campos
 * idênticos. `WeakMap` privado ao módulo: não é exportado e não impede a coleta da autorização.
 */
const autorizacoesEmitidas = new WeakMap<object, RegistroLedger>();

/** congela o objeto e tudo o que ele contém (a autorização não pode ser alterada depois de emitida) */
function congelarProfundo<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    for (const v of Object.values(x)) congelarProfundo(v);
    Object.freeze(x);
  }
  return x;
}

/**
 * CÓPIA CANÔNICA do registro recebido: os dados exatos que serão validados, autorizados e gravados.
 * `serializarCanonico` lê cada propriedade UMA vez (getters e Proxies incluídos) e produz JSON; o
 * `JSON.parse` desse texto gera dados puros e independentes (sem getters, setters, protótipo de classe
 * nem referência ao objeto do chamador), congelados em profundidade. Espalhamento ou `Object.assign`
 * não servem: executam getters de novo e copiam objetos aninhados por referência.
 * Se o registro nem tem representação canônica, ele é recusado; `conferirRegistro` sobre o ORIGINAL só
 * é chamada nesse caso, para dar o motivo específico da recusa: ela nunca aprova nada aqui.
 */
async function copiaConferida(novo: RegistroLedger): Promise<RegistroLedger> {
  let canonico: unknown;
  let falha: unknown;
  try {
    canonico = serializarCanonico(novo);
  } catch (e) {
    falha = e;
  }
  if (typeof canonico !== 'string') {
    // só o motivo específico da recusa (lança se achar um). O original pode ter um getter ou Proxy
    // que lança ao ser conferido: essa exceção não é um motivo do Ledger e cai na recusa genérica
    // abaixo (nunca escapa crua de `anexar`)
    try {
      await conferirRegistro(novo);
    } catch (e) {
      if (ehErroDoLedger(e)) throw e;
    }
    throw new ErroDeCadeia(
      `registro recusado: conteúdo não serializável (${falha === undefined ? 'sem representação canônica' : descreverFalha(falha)})`,
    );
  }
  const copia = congelarProfundo(JSON.parse(canonico) as RegistroLedger);
  await conferirRegistro(copia); // forma, esquema, bloqueio de escrita, data, corpo × tipo e hash
  return copia;
}

/**
 * AUTORIZAÇÃO da Fase A para gravar UM registro: o próprio registro conferido (`conferirRegistro`),
 * as referências e o registro anterior verificados (hash recalculado, validade semântica), cada um com
 * a representação canônica do que foi lido. Só `verificarReferencias` a emite; ela é congelada e
 * registrada em `autorizacoesEmitidas`. A Fase B recusa qualquer outro objeto, e esta só vale para o
 * registro de exatamente esta representação canônica.
 */
export interface ReferenciasVerificadas {
  readonly [verificadasPelaFaseA]: true;
  /** o hash do registro novo a que esta autorização pertence */
  readonly registro: string;
  /** `serializarCanonico` do registro novo, como foi conferido (o vínculo é pelo conteúdo inteiro) */
  readonly registroCanonico: string;
  readonly itens: readonly {
    readonly campo: ReferenciaDoRegistro['campo'];
    readonly seq: number;
    readonly hash: string;
    /** `serializarCanonico` do registro apontado, como foi verificado */
    readonly canonico: string;
  }[];
  /** o registro anterior (`seq − 1`) verificado; null na gênese */
  readonly anterior: AnteriorVerificado | null;
}

/**
 * FASE A. Assíncrona, fora da transação de escrita. Nesta ordem: tira a CÓPIA CANÔNICA do registro
 * novo (`copiaConferida`) e confere essa cópia (`conferirRegistro`: forma, esquema, bloqueio de escrita,
 * data, corpo × tipo e hash recalculado); depois as referências e o registro anterior DA CÓPIA, que
 * passam pela MESMA sequência de conteúdo (`conteudoVerificado`). Só depois de tudo conferido emite a
 * AUTORIZAÇÃO (congelada e registrada junto com a cópia, que é o que a Fase B grava). O objeto do
 * chamador é lido uma única vez, para tirar a cópia; nada mais é conferido nele.
 * Lança `ErroDeCadeia` se o registro novo é inválido, se alguma referência não existe, é de outra
 * cadeia/posição, não é anterior, tem hash ou tipo diferente do declarado, ou se o registro apontado
 * ou o anterior foi ADULTERADO (o hash recalculado do conteúdo não é o gravado), é INVÁLIDO ou é de
 * esquema não suportado. Lança `ConflitoDeCadeia` se o registro anterior não é aquele sobre o qual o
 * novo foi montado.
 */
export async function verificarReferencias(
  armazem: ArmazemLedger,
  novo: RegistroLedger,
): Promise<ReferenciasVerificadas> {
  // a cópia canônica, conferida, antes de qualquer leitura do armazém; daqui em diante, só ela
  const registro = await copiaConferida(novo);
  const itens: {
    campo: ReferenciaDoRegistro['campo'];
    seq: number;
    hash: string;
    canonico: string;
  }[] = [];
  const referencias = referenciasDoRegistro(registro);
  if (registro.cabecalho.tipo === 'correcao' && !referencias.some((r) => r.campo === 'corrige'))
    throw new ErroDeCadeia('correção recusada: o cabeçalho não tem `corrige` válido');
  for (const ref of referencias) {
    if (ref.seq >= registro.cabecalho.seq)
      throw new ErroDeCadeia(`${prefixoDe(ref)} não é anterior ao registro novo`);
    const bruto = await lerForaDaTransacao(
      armazem,
      registro.cabecalho.cadeia,
      ref.seq,
      prefixoDe(ref),
    );
    // UMA leitura do que o armazém devolveu; forma, identidade, tipo, esquema, hash, semântica e a
    // captura canônica são todos feitos sobre a MESMA cópia (o original não é relido)
    const apontado = copiaDoArmazem(bruto, prefixoDe(ref));
    conferirApontado(apontado, registro, ref);
    itens.push({
      campo: ref.campo,
      seq: ref.seq,
      hash: ref.hash,
      canonico: await conteudoVerificado(apontado, prefixoDe(ref)),
    });
  }
  const anterior = await verificarAnterior(armazem, registro);
  const autorizacao = congelarProfundo({
    registro: registro.hash,
    registroCanonico: serializarCanonico(registro), // da CÓPIA: exatamente o que será gravado
    itens,
    anterior,
  });
  autorizacoesEmitidas.set(autorizacao, registro);
  return autorizacao as unknown as ReferenciasVerificadas;
}

/**
 * A autorização é deste registro: mesmo hash e mesma representação canônica que a Fase A conferiu.
 * Lê o objeto do chamador uma vez; se ele nem tem representação canônica (ou ela mudou, por exemplo
 * por um getter), não é o registro autorizado. Nunca lança.
 */
function autorizacaoEhDe(verificadas: ReferenciasVerificadas, novo: RegistroLedger): boolean {
  try {
    return (
      verificadas.registro === novo.hash &&
      verificadas.registroCanonico === serializarCanonico(novo)
    );
  } catch {
    return false;
  }
}

/** o que a Fase A verificou como anterior é coerente com ESTE registro (gênese: nenhum anterior) */
const anteriorConfere = (anterior: AnteriorVerificado | null | undefined, novo: RegistroLedger) =>
  novo.cabecalho.seq === 1
    ? anterior === null
    : !!anterior &&
      anterior.seq === novo.cabecalho.seq - 1 &&
      anterior.hash === novo.cabecalho.prevHash &&
      typeof anterior.canonico === 'string';

/**
 * FASE B: a parte ATÔMICA do anexo, SÍNCRONA, DENTRO da transação do armazém, nesta ordem:
 *  1. a AUTORIZAÇÃO foi emitida por `verificarReferencias` (está em `autorizacoesEmitidas`) e é deste
 *     registro (mesmo hash e mesma representação canônica); senão `ErroDeCadeia`, antes de tocar na
 *     transação;
 *  2. a ponta lida AGORA tem a forma conferida (`null` = cadeia vazia; lixo ou `undefined`:
 *     `ErroDeCadeia`) e tem de ser a que o novo registro continua (senão `ConflitoDeCadeia`);
 *  3. o que se vai conferir é exatamente o que a Fase A verificou para este registro (referências e
 *     registro anterior; senão `ErroDeCadeia`);
 *  4. a ponta tem de ter a mesma representação canônica do registro anterior verificado na Fase A
 *     (senão `ConflitoDeCadeia`: a ponta mudou entre as fases, reverificar);
 *  5. cada registro apontado é relido NESTA transação, tem a FORMA conferida antes de qualquer acesso
 *     aos campos (lixo: `ErroDeCadeia`, nunca `TypeError`), é conferido e tem de ter a mesma
 *     representação canônica verificada na Fase A (senão `ConflitoDeCadeia`: reverificar);
 *  6. grava A CÓPIA CANÔNICA autorizada na Fase A (nunca o objeto `novo` do chamador): o que é
 *     gravado é exatamente o que foi conferido. Depois do vínculo (passo 1), tudo é conferido sobre
 *     essa cópia; `novo` só é lido para o vínculo.
 * Tudo síncrono. Qualquer falha lança e a transação é desfeita pelo armazém.
 */
export function anexarNaTransacao(
  tx: TransacaoLedger,
  novo: RegistroLedger,
  verificadas: ReferenciasVerificadas,
): void {
  // esta versão só LÊ o fechamento (esquema 2): nenhum tipo fora dos cinco do esquema 1 é gravado.
  // O tipo do objeto do chamador é lido UMA vez e dentro do tratamento de erros: um getter ou Proxy
  // que lança vira `ErroDeCadeia` (os erros do próprio Ledger passam como estão), nunca exceção crua.
  const tipo = lerNaTransacao(
    () => (novo as { cabecalho: { tipo: unknown } }).cabecalho.tipo,
    'recusado: o registro novo',
  );
  // mensagem FIXA: o valor lido não é convertido em texto (um objeto com `toString`, `valueOf` ou
  // `Symbol.toPrimitive` que lança escaparia como exceção crua)
  if (!TIPOS_DE_REGISTRO.includes(tipo as TipoRegistro))
    throw new ErroDeCadeia(
      'recusado: o tipo do registro não é permitido para escrita (somente leitura nesta versão ou desconhecido; a escrita ainda não está habilitada)',
    );
  // a AUTORIZAÇÃO tem de ter sido emitida por este módulo (não basta ter os campos certos) e tem de
  // ser deste registro: mesmo hash e mesma representação canônica do que a Fase A conferiu
  const registro = autorizacoesEmitidas.get(verificadas as object); // a cópia autorizada
  if (!registro)
    throw new ErroDeCadeia(
      'recusado: as referências deste registro não foram verificadas (Fase A): a autorização não foi emitida por `verificarReferencias`; use `anexar`',
    );
  if (!autorizacaoEhDe(verificadas, novo))
    throw new ErroDeCadeia(
      'recusado: as referências deste registro não foram verificadas (Fase A): a autorização é de outro registro ou de outro conteúdo; use `anexar`',
    );
  // daqui em diante, só a CÓPIA autorizada (o objeto `novo` não é lido de novo)
  const cadeia = registro.cabecalho.cadeia;
  // a ponta: UMA leitura, fotografada; forma, identidade e comparação canônica sobre a cópia
  const ponta = pontaConferida(lerNaTransacao(() => tx.ponta(cadeia), 'recusado: a ponta'));
  conferirPonta(ponta, registro); // identidade: cadeia, seq = ponta.seq + 1, prevHash = ponta.hash
  const esperadas = referenciasDoRegistro(registro);
  if (registro.cabecalho.tipo === 'correcao' && !esperadas.some((r) => r.campo === 'corrige'))
    throw new ErroDeCadeia('correção recusada: o cabeçalho não tem `corrige` válido');
  const itens = verificadas.itens;
  const anterior = verificadas.anterior;
  if (
    !itens ||
    verificadas.registro !== registro.hash ||
    itens.length !== esperadas.length ||
    esperadas.some(
      (e, i) => itens[i].campo !== e.campo || itens[i].seq !== e.seq || itens[i].hash !== e.hash,
    ) ||
    !anteriorConfere(anterior, registro)
  )
    throw new ErroDeCadeia(
      'recusado: as referências deste registro não foram verificadas (Fase A): use `anexar`',
    );
  // a ponta relida tem de ser EXATAMENTE o registro anterior verificado na Fase A (depois de
  // `conferirPonta`, ponta e anterior são ambos null, na gênese, ou ambos presentes)
  if (ponta !== null && serializarCanonico(ponta) !== anterior?.canonico)
    throw new ConflitoDeCadeia(
      `a ponta (seq ${ponta.cabecalho.seq}) mudou entre a verificação e a gravação: verifique de novo`,
    );
  for (const [i, ref] of esperadas.entries()) {
    const bruto = lerNaTransacao(() => tx.ler(cadeia, ref.seq), prefixoDe(ref));
    // UMA leitura, fotografada como na Fase A; identidade e comparação canônica sobre a cópia
    const lido = copiaDoArmazem(bruto, prefixoDe(ref));
    conferirApontado(lido, registro, ref);
    if (serializarCanonico(lido) !== itens[i].canonico)
      throw new ConflitoDeCadeia(
        `o registro ${ref.seq} apontado mudou entre a verificação e a gravação: verifique de novo`,
      );
  }
  tx.adicionar(registro); // a cópia canônica autorizada, congelada: exatamente o que foi conferido
}

/**
 * A PORTA DE ESCRITA do Ledger. Anexa `novo` ao armazém: Fase A (o próprio registro, as referências e
 * o registro anterior, com hash recalculado e validade semântica, emitindo a autorização) e UMA
 * transação (Fase B) que confere a autorização e a ponta, reconfirma a ponta e as referências pela
 * representação canônica e grava.
 * `ConflitoDeCadeia` pede releitura e nova tentativa; `ErroDeCadeia` não se resolve tentando de novo.
 */
export async function anexar(armazem: ArmazemLedger, novo: RegistroLedger): Promise<void> {
  const verificadas = await verificarReferencias(armazem, novo); // inclui `conferirRegistro(novo)`
  await armazem.transacao((tx) => anexarNaTransacao(tx, novo, verificadas));
}
