# Ledger append-only: núcleo (L1)

Núcleo **puro**: tipos, serialização canônica, SHA-256, encadeamento, verificação e reprodução.
Não grava em lugar nenhum (nada de IndexedDB), não tem interface e não é chamado por nenhum fluxo
do site ainda. As fases L2 (armazenamento e ganchos) e L3 (painel e backup) dependem de nova aprovação.

## Status: auditoria encerrada, núcleo CONGELADO

**Auditoria do núcleo Ledger encerrada em 17/11/2026. Parecer: APROVADO COM RESSALVAS**, com
congelamento técnico recomendado e adotado. Enquanto o congelamento valer, nenhuma mudança de
implementação, regra, esquema, tipo, validação, serialização, hash ou verificador entra no núcleo
sem nova decisão expressa.

| Referência | Valor |
|---|---|
| Versão de referência | núcleo Ledger L1, auditado e congelado em 17/11/2026 |
| HEAD | `6c8c7cdae731add53a3124d1e89128a28382b2e8` (o núcleo auditado está no working tree, ainda sem commit) |
| Árvore reproduzida | `3173edc235d33ba043e5f9ba531d34cdedb52f21`: o `git write-tree` do working tree auditado, reproduzido num clone limpo aplicando o diff completo sobre `6c8c7cd` |
| Diff da rodada de fechamento | SHA-256 `6138b9a12dd8201c10646d3e127ce0edffdacaf7a325821beade57d72cd4bc00` |
| Diff completo contra `6c8c7cd` | SHA-256 `d2a951e4b50810acafc970380a9a535faa2ca419cbc71e673b5ccd02b2ef9751` |
| Pacote final da auditoria | `auditoria-ledger-2026-11-17-final.zip`, SHA-256 `18f55ad739450cdd3e2cf9e6f5e882b419e3fbef49c9cac49f67a6a1e728f708` |
| Verificações no estado auditado | typecheck, lint e build ok; Ledger 975 de 975; suíte completa 1795 de 1795; fixture `cadeias-6c8c7cd.json` inalterada |

A árvore `3173edc…` identifica o estado AUDITADO, anterior a esta seção. Este registro documental
altera só o `LEDGER.md`; nenhum arquivo de código mudou depois da auditoria.

**Ressalvas aceitas no parecer:**

1. Os verificadores (`verificarCadeia`, `verificarLedger`) pressupõem registros estáveis: a
   Limitação 7 (seção "Limitações").
2. `serializarCanonico` deixa sair cru o erro de um getter que lança. É o projeto original: todas
   as portas do Ledger convertem esse erro no erro do contrato.
3. `packages/engine/src/kelly.ts` (motor quantitativo) tem 6 linhas no working tree, anteriores a
   17/11 e de origem a confirmar, fora do núcleo Ledger. Elas ficam para uma auditoria separada.

**Não há persistência real.** Não existe adaptador de IndexedDB (L2), nem ganchos, nem painel (L3).
O núcleo é lógica pura, exercitada pelos testes com armazéns em memória. As limitações da seção
"Limitações" continuam valendo integralmente.

## O que um registro é

Um registro **nunca é editado**. Uma correção é outro registro (`correcao`) que aponta para o
anterior; uma exclusão é um registro `exclusao`. Cada registro leva o hash do anterior da sua cadeia.

```
RegistroLedger { cabecalho, corpo, hash }
cabecalho: esquema, tipo, cadeia, seq, prevHash, criadoEm,
           versaoMotor, impressaoPoliticas, politicas,
           analiseId?, eventoId?, corrige?
tipos:     decisao | aposta_registrada | resultado | correcao | exclusao
```

- `esquema`: versão do **formato** (campos, serialização e cálculo do hash). Hoje é `1`.
- `versaoMotor`: versão da lógica de decisão (`VERSAO_MOTOR`, bumpada à mão).
- `politicas` + `impressaoPoliticas`: os limites, gates, pesos e o registro de casas vigentes, e o hash
  deles. Mesmo que alguém esqueça de bumpar `VERSAO_MOTOR`, uma mudança de número muda a impressão.

## Hash

```
hash = SHA-256( "pe-ledger/v<esquema>\n" + serializarCanonico({ cabecalho, corpo }) )   // UTF-8, hex minúsculo
```

SHA-256 vem de `crypto.subtle.digest` (assíncrono). Não há implementação própria. Sem
`crypto.subtle` (contexto não seguro), o Ledger **recusa** gravar, em vez de gravar sem hash.
O hash do cabeçalho inclui `seq` e `prevHash`, então ele "contém" todo o passado da cadeia.

O texto bruto dos prints fica fora do registro, num **blob** endereçado por conteúdo
(`SHA-256` dos bytes UTF-8 do texto exato, verificável com `sha256sum`); o registro guarda só o hash.

## Serialização JSON canônica (esquema 1)

Mesmos bytes para o mesmo valor lógico, em qualquer máquina. Compatível com o RFC 8785 (JCS) onde
ele define o comportamento; mais estrita nos demais pontos (recusa em vez de "adivinhar").

| Item | Regra |
|---|---|
| Objetos | Só objetos puros (protótipo `Object.prototype` ou `null`). `Date`, `Map`, `Set`, `RegExp` e instâncias de classe são **recusados**. Datas entram como **string ISO 8601** com deslocamento. |
| Ordem das chaves | Crescente por unidade de código UTF-16 (a ordem padrão do `sort()`), independente da ordem de inserção. `"B"` vem antes de `"a"`; `U+FF5E` antes de um par substituto como `😀`. |
| Campo ausente | Propriedade `undefined` é **omitida**: `{a: undefined}` ≡ `{}`. |
| `null` | É um valor e é **preservado**: `{a: null}` ≠ `{}`. |
| Arrays | Ordem preservada. `undefined` dentro de array e arrays esparsos (buracos) são **recusados**. |
| Números | Só finitos. `NaN`, `±Infinity` são **recusados**. `-0` vira `0`. Formato do ECMAScript `Number::toString` (o mesmo do JCS): `0.1+0.2` → `0.30000000000000004`, `1e21` → `1e+21`. Sem arredondamento: quem grava arredonda antes. `BigInt` é recusado. |
| Strings | Escapes do `JSON.stringify` bem formado (ES2019): `"`, `\`, controles `U+0000–U+001F`. **Nenhuma normalização Unicode**: `é` composto e `e` + acento combinante geram hashes diferentes. Espaços, quebras de linha (`\r\n` ≠ `\n`) e demais caracteres são preservados. `U+2028/2029` ficam literais. Surrogate solitário é escapado como `\udXXX` (preservado, nunca vira `U+FFFD`). |
| Chaves | Escapadas como strings; só chaves string e próprias (chaves-símbolo são ignoradas; getters são lidos). |
| Proibidos | `undefined` no topo, funções (inclusive `toJSON`, que **não** é chamado), símbolos, `BigInt`, referências circulares, profundidade acima de 200. A mesma referência repetida (sem ciclo) é aceita. |

Mudar qualquer regra acima muda o esquema (`VERSAO_ESQUEMA_LEDGER`).

## Estados de uma cadeia (integridade) e origem

A integridade e a origem são **eixos separados**; a reprodução é um terceiro eixo.

| Estado | Significa |
|---|---|
| **integra** | Gênese (`seq` 1, `prevHash` null), `seq` contíguo, todo hash recalculado confere, todo `prevHash` é o hash do anterior. |
| **incompleta** | Nada adulterado entre o que existe, mas faltam registros (não começa no 1, ou lacuna de `seq`), inclusive o registro que uma correção aponta (`correcao_referencia_ausente`). Cópia parcial e remoção **não** se distinguem só pela cadeia. |
| **adulterada** | Hash que não confere, `prevHash` que não bate, `seq` duplicado com conteúdo diferente, gênese com `prevHash`, registro malformado, data inválida, corpo incompatível com o tipo, correção que aponta para outro conteúdo (`correcao_hash_diverge`), continuidade artificial ou âncora externa que diverge. |
| **incompativel** | Há registro de um esquema que esta versão não sabe verificar, **qualquer que seja o tipo dele** (até um tipo que esta versão não conhece). Não é "ok" nem "adulterado". |

Precedência quando há mais de um problema: adulterada > incompatível > incompleta > íntegra.

**Precedência de ESQUEMA sobre TIPO (Etapa 0).** A lista de tipos válidos é do esquema. Num esquema que o
verificador conhece, um tipo fora da lista é registro malformado (**adulterada**). Num esquema que ele
NÃO conhece, o tipo não é julgado (pode ser legítimo de um formato mais novo): o registro vira
`esquema_incompativel`. O tipo ainda precisa ser texto; hash, corpo, cadeia, `seq`, `prevHash` e
`criadoEm` continuam sendo conferidos na forma. Antes da Etapa 0, um `fechamento` de esquema 2 lido
por esta versão seria chamado de adulterado (alarme falso).

**Origem** (`local` / `importada` / `indeterminada`): uma cadeia é "importada" quando o seu `cadeia`
difere do da cadeia local. **Importar nunca encadeia**: cada cadeia mantém a identidade, a gênese e a
ponta de origem. Um registro cujo `prevHash` é o hash de registro de **outra** cadeia é
`continuidade_artificial` e torna a cadeia adulterada.

**Reprodução divergente** (`reproduzida` / `divergente` / `nao_reproduzivel`) **não** muda o estado
da cadeia e **nunca** altera um registro. Ela apenas relata, com a causa:
`versao_do_motor_diferente`, `politicas_diferentes` ou `mesma_versao_e_politicas` (a mais séria: o motor
mudou sem avisar ou deixou de ser determinístico).

## Concorrência (contrato para a L2)

Várias abas podem anexar ao mesmo tempo. O escritor lê a ponta, cria o registro com
`criarRegistro(pedido, ponta)` e grava com **`anexar(armazem, novo)`, a ÚNICA porta pública de
escrita**:

1. **Fora** da transação (Fase A, assíncrona): o próprio registro é conferido (`conferirRegistro`:
   forma, esquema, data, corpo coerente com o tipo e **hash declarado = hash recalculado**), e também
   as referências e o registro anterior (abaixo). Falha com `ErroDeCadeia`, que **não** se resolve
   relendo a ponta.
2. **Dentro** da transação de gravação, **sem `await` de nada que não seja do próprio banco** (uma
   transação de IndexedDB se encerra sozinha se aguardar outra coisa), a Fase B confere a ponta
   (interna, síncrona). Se outro escritor avançou a ponta, lança `ConflitoDeCadeia`; o escritor relê a
   ponta, recria e recomeça.

A chave do armazém deve ser `(cadeia, seq)` com `add`, que também recusa um `seq` repetido: duas defesas.
A gravação **não** confia em que o registro veio de `criarRegistro`. Não existe outra porta: a antiga
`aceitarAnexo(ponta, novo)`, que conferia só o registro e a identidade da ponta (sem guarda de forma da
ponta, sem verificar o conteúdo do registro anterior nem as referências, e sem atomicidade), **foi
retirada da API**; `conferirPonta` passou a ser interna de `armazem.ts`.

**Gravação atômica em duas fases (`armazem.ts`, implementada e testada com um armazém em memória; o
adaptador de IndexedDB da L2 NÃO existe).** O SHA-256 nativo é assíncrono e uma transação de IndexedDB
se encerra ao aguardar algo que não seja do próprio banco; por isso o hash do registro apontado é
recalculado FORA da transação e confirmado DENTRO dela pela representação canônica.

*O que a gravação confere:* as **referências** do registro, `corrige` (correção; qualquer registro
anterior) e `decisao` (`aposta_registrada` e `resultado`; o apontado precisa ser do tipo `decisao`),
e o **registro anterior** (`seq − 1`), ao qual o novo se encadeia por `prevHash`. Todos passam pela
MESMA sequência de conteúdo: esquema suportado, hash **recalculado** e validade semântica. Uma regra
só, para que gravar em cima de um registro inválido seja recusado do mesmo jeito que referenciá-lo.

- **Fase A — `verificarReferencias(armazem, novo)`, assíncrona, fora da transação de escrita.**
  0. **O próprio registro novo, pela CÓPIA CANÔNICA**, antes de qualquer leitura do armazém. O objeto
     do chamador é lido **uma única vez**: `serializarCanonico(novo)` (que executa cada getter ou Proxy
     uma vez) e, desse texto, `JSON.parse` gera uma **cópia de dados puros** (sem getters, setters,
     protótipo de classe nem referência ao original), **congelada em profundidade**. Espalhamento ou
     `Object.assign` não serviriam: executam getters de novo e copiam objetos aninhados por referência.
     Tudo o que vem depois (`conferirRegistro`: forma, esquema, bloqueio de escrita do `fechamento`,
     data, corpo × tipo e hash recalculado; referências; registro anterior) é conferido **sobre a cópia**.
     Registro inválido, ou sem representação canônica, não recebe autorização.
  1. **Referências**, depois. Para cada uma: `seq` anterior ao do novo; lê o apontado
     (`ArmazemLedger.ler`); confere a forma antes de qualquer acesso aos campos; confere existência,
     cadeia e posição, hash declarado e tipo exigido.
  2. **Registro anterior**, depois. Na gênese (`seq` 1) não há anterior. Nos demais: lê o `seq − 1`;
     confere a forma; confere a identidade (cadeia e `seq`); exige que o campo `hash` dele seja o
     `prevHash` do novo.
  3. **Conteúdo** de cada um, pela mesma função interna (`conteudoVerificado`): esquema suportado,
     **`hashDoRegistro` recalculado** igual ao hash gravado (um registro adulterado com o campo `hash`
     antigo é recusado aqui) e **registro VÁLIDO para quem o lê** (`motivoRegistroInvalido`: forma,
     esquema suportado, data ISO, tipo × esquema e corpo × tipo; um registro inválido também tem hash
     correto, então o hash sozinho não basta).
  **Cópia dos registros LIDOS DO ARMAZÉM (passos 1 a 3).** O valor devolvido por `armazem.ler`, para
  cada referência e para o registro anterior, também é lido **uma única vez** (`fotografar`:
  `serializarCanonico` → `JSON.parse` → congelamento em profundidade). Forma, identidade, tipo
  exigido, esquema, hash recalculado, validade semântica **e a representação canônica guardada** são
  todos da MESMA cópia; o objeto devolvido pelo armazém não é relido. Um getter ou Proxy que muda de
  valor entre leituras não consegue fazer a Fase A validar um conteúdo e capturar outro, e alterar
  esse objeto depois da Fase A não altera a autorização.
  4. Guarda a representação canônica (`serializarCanonico`) de cada um e emite a **AUTORIZAÇÃO**
     (`ReferenciasVerificadas`): `registro` (hash da cópia), `registroCanonico` (representação canônica
     **da cópia**, exatamente o que será gravado), `itens` das referências e `anterior` (null na gênese).

  **A autorização não pode ser forjada em tempo de execução.** Só `verificarReferencias` a emite, e ela
  é: (a) **registrada num `WeakMap` privado** de `armazem.ts` (não exportado), que a liga à cópia
  canônica conferida, e a Fase B recusa
  qualquer objeto que não esteja lá, ainda que tenha campos idênticos (objeto montado à mão,
  espalhamento, JSON, `structuredClone`, `Object.assign`, `Object.create`); (b) **congelada em
  profundidade** (o objeto, a lista de itens, cada item e o anterior): não pode ser alterada nem
  redirecionada para outro registro; (c) **vinculada ao registro novo** pelo hash **e** pela
  representação canônica inteira: não serve para outro registro, nem para o mesmo registro com o
  conteúdo trocado e o campo `hash` mantido. A marca de tipo `verificadasPelaFaseA` (só em compilação,
  impede montar o valor sem um cast) **nunca é exportada**.

  O validador de leitura é independente dos bloqueios de escrita: aceita todo tipo que o verificador
  lê, inclusive o `fechamento` (somente leitura). Referenciar um fechamento válido, ou gravar depois
  de um, **não libera a escrita do fechamento**: gravá-lo continua recusado por `criarRegistro`,
  `conferirRegistro` e `anexarNaTransacao`.
- **Fase B — `anexarNaTransacao(tx, novo, verificadas)`, SÍNCRONA, dentro da transação.** Nesta ordem
  (depois de recusar o tipo somente leitura; o tipo do objeto do chamador é lido uma vez, dentro do
  tratamento de erros: um getter ou Proxy que lança, ou `null`/`undefined` no lugar do registro, vira
  `ErroDeCadeia`, e um `ErroDeCadeia`/`ConflitoDeCadeia` lançado ali passa como está):
  0. **Autorização.** `verificadas` tem de ter sido emitida por `verificarReferencias` (estar no `WeakMap`)
     e ser **deste** registro (mesmo hash e mesma representação canônica; o objeto do chamador é lido
     uma vez para isso, e um registro que mudou desde a Fase A, inclusive por getter, não é o
     autorizado). Senão `ErroDeCadeia` "as referências deste registro não foram verificadas (Fase A): a
     autorização não foi emitida…" ou "…é de outro registro ou de outro conteúdo", **antes de tocar na
     transação** (nem a ponta é lida). Daí em diante tudo é conferido sobre a **cópia autorizada**.
  1. **Guarda da ponta.** `tx.ponta(cadeia)` tem a forma conferida antes de `conferirPonta` tocar em
     qualquer campo. O contrato de `tx.ponta` é `RegistroLedger | null`:
     - **`null`**: cadeia **vazia**, legítima. A gênese (`seq` 1, `prevHash` null) é gravada. Para
       um registro que não é gênese, `conferirPonta` responde `ConflitoDeCadeia` ("esperado seq 1,
       recebido N");
     - **`undefined`**: viola o contrato e **não** é tratado como cadeia vazia. `ErroDeCadeia`
       "recusado: a ponta lida na transação é inválida (ausente (undefined; o contrato é um registro ou
       null))";
     - **objeto malformado ou valor que nem é objeto** (texto, número, `false`, lista): `ErroDeCadeia`
       "recusado: a ponta lida na transação é inválida (<motivo da forma>)", nunca `TypeError`.
  2. `conferirPonta`: a ponta é da mesma cadeia, `novo.seq` = `ponta.seq + 1` e `novo.prevHash` =
     `ponta.hash` (senão `ConflitoDeCadeia`: outro escritor avançou, reler e recriar).
  3. Coerência interna da autorização (defesa adicional): as mesmas referências do registro e o
     registro anterior com o `seq` e o hash deste (null na gênese). Senão `ErroDeCadeia` "as
     referências deste registro não foram verificadas".
  4. **A ponta tem de ter a mesma representação canônica do registro anterior verificado na Fase A**
     (senão `ConflitoDeCadeia` "a ponta (seq N) mudou entre a verificação e a gravação"; a nova Fase A
     recusa de vez se ela foi adulterada).
  5. Cada apontado é **relido na mesma transação** (`tx.ler`) e tem a **forma conferida antes de
     qualquer acesso aos campos** (a mesma guarda da Fase A: `null` é recusado como inexistente, e um
     objeto malformado ou um valor que nem é objeto, como `ErroDeCadeia` "registro malformado", nunca
     `TypeError`); depois é conferido de novo e tem de ter a mesma representação canônica da Fase A
     (senão `ConflitoDeCadeia`: o registro mudou entre as fases, reverificar).

     Nos passos 1 a 5, o que `tx.ponta` e `tx.ler` devolvem é lido **uma única vez**, de forma
     síncrona, pela mesma `fotografar` da Fase A: a forma, a identidade (`conferirPonta`,
     `conferirApontado`) e a comparação canônica são feitas sobre a cópia congelada, nunca sobre o
     objeto devolvido. A decisão corresponde à única leitura feita: se o conteúdo dela é o
     autorizado, grava; se não, `ConflitoDeCadeia`.
  6. `tx.adicionar(cópia)`: grava a **cópia canônica autorizada**, congelada, **nunca o objeto do
     chamador**. O conteúdo persistido é exatamente o validado, num armazém que copia ao gravar
     (`structuredClone`, como o IndexedDB) ou num que guarda a referência (alterar o objeto do chamador
     depois não altera o gravado). A chave `(cadeia, seq)` com `add` recusa repetição: segunda defesa.
- `anexar(armazem, novo)` faz a Fase A (que inclui `conferirRegistro`) → UMA transação com a Fase B.
  `verificarReferencias` + `anexarNaTransacao` são as duas metades da mesma porta, para quem já tem a
  própria transação; a segunda só grava com a autorização emitida pela primeira.
- Conteúdo idêntico ao verificado equivale a recalcular o hash dentro da transação: o hash é função
  determinística do conteúdo. Por isso o hash é recalculado só na Fase A (é assíncrono e não cabe na
  transação) e a Fase B compara a representação canônica. Se qualquer conferência falha, a Fase B
  lança e o armazém desfaz tudo (rollback): nenhuma gravação parcial é confirmada.

**Erros da gravação:**

| Situação | Fase | Erro |
|---|---|---|
| O próprio registro novo inválido (hash declarado ≠ recalculado, corpo × tipo, data, esquema, tipo somente leitura) | A | `ErroDeCadeia` (nenhuma autorização emitida, nada lido) |
| Registro anterior adulterado (hash recalculado ≠ gravado), inválido (corpo × tipo, tipo × esquema, data) ou de esquema não suportado | A | `ErroDeCadeia` |
| Registro anterior malformado, ou de outra cadeia ou posição | A | `ErroDeCadeia` |
| Registro anterior ausente, ou com hash ≠ `prevHash` do novo (o novo foi montado sobre outra ponta) | A | `ConflitoDeCadeia` |
| Referência inexistente, não anterior, com hash ou tipo errado, adulterada, inválida ou malformada | A | `ErroDeCadeia` |
| `tx.ponta` devolve `undefined`, objeto malformado ou valor que não é objeto | B | `ErroDeCadeia` |
| Ponta válida que não é a que o novo continua (outra cadeia, outro escritor avançou) | B | `ConflitoDeCadeia` |
| Autorização não emitida pela Fase A (forjada, copiada, reconstruída, ausente) ou de outro registro/conteúdo | B | `ErroDeCadeia` (antes de tocar na transação) |
| Ponta ou apontado com conteúdo diferente do verificado na Fase A | B | `ConflitoDeCadeia` |
| `tx.ler` devolve `null`, objeto malformado ou valor que não é objeto | B | `ErroDeCadeia` |
| Registro lido (referência, anterior ou ponta) sem representação canônica: getter ou Proxy que lança, valor não serializável | A ou B | `ErroDeCadeia` "… é inválido (não serializável: …)"; a exceção crua nunca escapa, nem um `ConflitoDeCadeia` lançado por um getter do registro |
| A própria leitura (`armazem.ler`, `tx.ponta`, `tx.ler`) lança | A ou B | `ErroDeCadeia` "… a leitura … falhou"; um `ErroDeCadeia` ou `ConflitoDeCadeia` lançado pelo armazém passa como está |
| Registro novo cujo `cabecalho.tipo` não pode ser lido (getter/Proxy que lança, `null`, `undefined`) | B | `ErroDeCadeia` "recusado: o registro novo: a leitura na transação falhou"; `ErroDeCadeia`/`ConflitoDeCadeia` lançados ali passam como estão |

- `ErroDeCadeia` (registro, referência ou armazém inválidos) não se resolve tentando de novo;
  `ConflitoDeCadeia` (ponta velha, conteúdo mudou entre as fases) pede releitura e nova tentativa.
- *Limite:* a gravação confere o registro anterior e os apontados, não a cadeia inteira. Ela não
  detecta quem refaz a cadeia inteira de forma consistente (ver Limitações), nem um registro mais antigo
  adulterado: isso é `verificarCadeia`. Uma cadeia cuja ponta está adulterada ou inválida **não recebe
  gravação** até ser tratada.

## Coerência semântica (esquema 1)

Aplicada em `criarRegistro`, `conferirRegistro` (e portanto na gravação, `anexar`) **e** `verificarCadeia` (`validacao.ts`):

O **corpo** de cada tipo tem exatamente estes campos (`undefined` conta como ausente; campo a mais ou a
menos é incompatível). Os objetos aninhados que copiam saídas do motor ou do app exigem os campos
centrais com o tipo e o domínio abaixo e **toleram campos a mais**.

| Tipo | Corpo |
|---|---|
| `decisao` | `entradaMotor {v4, lista}` (objeto ou null); `saida`: objeto simples (pode ser `{}` ou parcial); `snapshot {odds, estatisticas, contexto, prints}`: `odds` lista, `estatisticas` e `contexto` objeto simples (sem contrato mais rígido), `prints` nome → hash de blob; `impressao` texto não vazio |
| `aposta_registrada` | `decisao` (null ou `{seq, hash}`), `aposta`, `stakeAutorizada`, `travas` (abaixo) |
| `resultado` | `decisao` (null ou `{seq, hash}`), `resultado` (abaixo) |
| `correcao` | `motivo` (texto), `novo` (qualquer valor serializável, **presente**: não há produtor ainda, então não há estrutura); o cabeçalho **exige** `corrige` |
| `exclusao` | `motivo` (texto ou null) |

**`aposta`**: objeto simples; `odd` número finito **> 1**; `casa` texto **não vazio** (após aparar espaços);
`feitaEm` data ISO válida; `valor` opcional, finito **≥ 0**; `entrada` opcional, objeto simples.

**`resultado.resultado`**: objeto simples; `casa` e `fora` **inteiros ≥ 0**; `registradoEm` data ISO
válida; os demais campos (intervalo, escanteios, cartões, odds de fechamento…) são livres.

**`stakeAutorizada`** (`StakeAutorizada`, `kelly.ts`; o compilador exige uma regra por campo declarado):

| Campo | Declarado | Validação |
|---|---|---|
| `autorizada` | `boolean` | obrigatório, lógico |
| `motivo` | `string?` | opcional, texto |
| `kellyCheio` | `number` | obrigatório, finito (**pode ser negativo**: "EV negativo continua negativo") |
| `fracaoKelly` | `number` | obrigatório, finito ≥ 0 |
| `fracaoBanca` | `number` | obrigatório, finito ≥ 0 |
| `limites` | `('teto' \| 'jogo' \| 'dia')[]` | obrigatório, lista só desses três valores |
| `teto` | `number` | obrigatório, finito ≥ 0 |
| `valor` | `number?` | opcional, finito ≥ 0 |

**`travas`** (`TravasBanca`, `banca.ts`; também uma regra por campo declarado):

| Campo | Declarado | Validação |
|---|---|---|
| `bancaInicial`, `bancaAtual`, `pico` | `number` | obrigatório, finito (a banca pode ficar negativa) |
| `drawdown` | `number` | obrigatório, finito ≥ 0 |
| `fatorKelly` | `number` | obrigatório, finito ≥ 0 |
| `pausadoAte` | `string \| null` | obrigatório (`null` vale), data ISO válida quando texto |
| `perdasHoje` | `number` | obrigatório, inteiro ≥ 0 |
| `diaEncerrado` | `boolean` | obrigatório, lógico |
| `expostoHoje` | `number` | obrigatório, finito ≥ 0 |
| `expostoJogo` | `number?` | opcional, finito ≥ 0 |
| `motivos` | `string[]` | obrigatório, lista de textos |

**Listas** (`motivos`, `limites`, `snapshot.odds`): **densas**. Cada índice de 0 a `length − 1` precisa
existir e ser válido; posições vazias (`new Array(3)`, `[1, , 2]`, `length` aumentado) e `undefined`
são recusados. (`Array.prototype.every` pula as posições vazias e aceitaria uma lista só de buracos.)

**`corrige` (cabeçalho)**: só em `correcao`; exatamente `{ seq, hash }` (campo adicional é **recusado**,
inclusive em `criarRegistro`, que não descarta em silêncio); `seq` inteiro positivo e **estritamente
menor** que o `seq` do próprio registro; `hash` no formato SHA-256. Em `verificarCadeia`, o registro
`corrige.seq` precisa existir na cadeia e ter o hash `corrige.hash`: hash diferente é
`correcao_hash_diverge` (**adulterada**); registro ausente é `correcao_referencia_ausente`
(**incompleta**: numa cadeia contígua desde o `seq` 1 o registro corrigido, de `seq` menor, sempre
existe, então só falta numa cópia parcial ou com lacuna; apontar para um `seq` que nunca existiria já é
`corpo_incompativel`, adulterada).

**`criadoEm` e demais datas** (`feitaEm`, `registradoEm`, `pausadoAte`): ISO 8601 com deslocamento,
**existindo no calendário** (o `Date.parse` do V8 aceita 30/02 e o rola para março, então a conferência
é por componente). `Z` e `+00:00` valem; `-00:00` é recusado; o deslocamento vai de **−12:00 a +14:00**
(minutos de 00 a 59); hora 24, segundo 60 (intercalar), letras minúsculas e espaços são recusados;
anos bissextos pela regra gregoriana; fração de segundo de qualquer tamanho.

Na verificação, os problemas são `data_invalida` e `corpo_incompativel` e tornam a cadeia **adulterada**,
mesmo que o hash confira (registro forjado com hash refeito). Registros de esquema desconhecido não são
julgados por estas regras.

## Integridade referencial na verificação histórica

Além de `correcao_referencia_ausente` e `correcao_hash_diverge` (`corrige`), `verificarCadeia` cruza
`aposta_registrada.decisao` e `resultado.decisao` (quando não `null`) com a cadeia:

| Código | Quando | Estado |
|---|---|---|
| `decisao_nao_anterior` | o `seq` apontado é igual ou maior que o do registro | adulterada |
| `decisao_referencia_ausente` | não há registro com esse `seq` na cadeia (cópia parcial ou lacuna) | incompleta |
| `decisao_hash_diverge` | o registro nesse `seq` tem outro hash | adulterada |
| `decisao_tipo_incorreto` | o registro apontado tem hash certo, mas não é do tipo `decisao` | adulterada |
| `referencia_outra_cadeia` | (`verificarLedger`) o hash apontado (`corrige`, `decisao` ou `aposta`) pertence a outra cadeia | adulterada |
| `fechamento_nao_anterior` | (esquema 2) o `seq` da aposta apontada é igual ou maior que o do fechamento | adulterada |
| `fechamento_referencia_ausente` | (esquema 2) não há registro com esse `seq` na cadeia | incompleta |
| `fechamento_hash_diverge` | (esquema 2) o registro nesse `seq` tem outro hash | adulterada |
| `fechamento_tipo_incorreto` | (esquema 2) o apontado tem hash certo, mas não é `aposta_registrada` | adulterada |

Estas são regras novas de integridade referencial, aplicadas também a registros de esquema 1. O
**formato do registro, a serialização canônica e o cálculo do hash não mudaram**; nenhum dado real
estava gravado (a L2 não existe). A ausência é `incompleta` pelo mesmo motivo de `corrige`: numa cadeia
contígua desde o `seq` 1 o apontado (de `seq` menor) sempre existe.

## Divergências com os produtores: situação

Conferidas com os produtores reais (`apps/web/test/ledgerProdutores.test.ts`: `autorizarStake`,
`calcularTravas`, `registrarAposta`, formulários e `analisarV4`).

1. **`autorizarStake` com pedido inválido — CORRIGIDA no produtor.** `zero()` (kelly.ts) repetia o
   `teto` e a `fracaoKelly` inválidos do pedido (negativos). Agora ambos viram 0 quando negativos ou
   não finitos. `kellyCheio` (que pode ser negativo, EV negativo), o motivo, `fracaoBanca`,
   `limites`, `valor` e toda autorização de pedido válido ficam idênticos (`kellyZero.test.ts`: grade
   de 445.500 pedidos, digest dos válidos igual ao de antes). O contrato do Ledger não foi relaxado.
2. **Resultado sem placar — ABERTA (decisão tomada, tipo ainda não implementado).** `resultado` continua
   exigindo placar completo (inteiros ≥ 0); `NaN` não vira 0 e placar não é inventado. O fechamento
   das odds (CLV) irá para um tipo próprio `fechamento`, com esquema 2; ver a proposta de
   versionamento (não implementado).
3. **Placar sem validação no formulário — CORRIGIDA no aplicativo.** `apps/web/src/placar.ts` lê pares
   de inteiros não negativos (só dígitos), exige odds finitas e maiores que 1 em `oddFechamento` e
   `fechamentoOutros`, e o formulário não deixa salvar com valor inválido (antes, `num()` aceitava
   `1.5` e `-1` e descartava em silêncio odds inválidas). O Ledger segue como última barreira.

## Requisitos para a futura L2 (não implementada)

- **Ativar `@typescript-eslint/no-floating-promises`** (e, de preferência, `no-misused-promises`) para
  `packages/engine` antes de escrever o adaptador de IndexedDB e os ganchos. O ESLint do projeto não
  tem a regra hoje; medido com configuração descartável: 0 ocorrências no Ledger e nos testes. O risco
  é futuro e concreto: esquecer o `await` de `conferirRegistro`, `verificarReferencias` ou `anexar`
  pularia a validação em silêncio e a gravação seguiria. A regra exige informação de tipos
  (`parserOptions.projectService`).
- O adaptador implementa `ArmazemLedger` (`transacao`, `ler`) e `TransacaoLedger` (`ponta`, `ler`,
  `adicionar`); a transação é `readwrite` e o corpo é síncrono.
- O adaptador deve gravar `resultado` só com placar completo; e `aposta_registrada` só com stake
  autorizada válida.

## Evolução versionada futura (proposta, não implementada)

- **`exclusao` sem alvo identificável.** O corpo de `exclusao` só tem `motivo`; o alvo seria o
  `analiseId` do cabeçalho, que é opcional. Uma exclusão sem alvo não exclui nada rastreável. O
  contrato do esquema 1 **não foi alterado**. A correção é uma evolução versionada (novo esquema), por
  exemplo exigindo um `alvo: { seq, hash }` verificado como as demais referências.

## Semântica das referências `decisao` nos registros do esquema 1

`aposta_registrada.decisao` e `resultado.decisao` são `null` (sem vínculo) ou `{ seq, hash }`.

- **`null`**: válido e íntegro; nada a cruzar.
- **`{ seq, hash }`**: na verificação, `seq` tem de ser **menor** que o do registro, existir **na mesma
  cadeia**, ter exatamente esse `hash` e ser do tipo `decisao`. Falhas: `decisao_nao_anterior`,
  `decisao_referencia_ausente` (cópia parcial ou lacuna: incompleta), `decisao_hash_diverge`,
  `decisao_tipo_incorreto` e, em `verificarLedger`, `referencia_outra_cadeia`. Na gravação a mesma
  conferência acontece em duas fases (ver acima), com o hash do apontado recalculado.
- **Registros criados pelo código anterior** (commit 6c8c7cd, que só conferia a FORMA da referência): o
  formato, a serialização canônica e o hash **não mudaram**, e todo registro antigo continua com o mesmo
  hash. Cadeias com `decisao: null` ou com a referência real continuam **íntegras**. Cadeias cuja
  referência o código anterior aceitava mas é inválida (hash inventado, tipo errado, `seq` não anterior)
  passam a ser **acusadas**: é um aperto da verificação, não uma mudança de formato. Nenhuma cadeia real
  estava gravada (a L2 não existe). Provado com o fixture `test/ledger/fixtures/cadeias-6c8c7cd.json`,
  gerado pelo código anterior (`compatibilidadeCodigoAnterior.test.ts`).

## Endurecimento semântico do esquema 1 e congelamento (decisão de arquitetura)

**Decisão:** a validação das referências é **estrita** no esquema 1 (`decisao` e `corrige`), sem modo
legado, sem esquema novo e sem qualquer mecanismo de flexibilização.

- **O que mudou, e o que não mudou.** Mudou a *semântica referencial verificada*: desde o commit
  `6c8c7cd` (que só conferia a FORMA de `decisao`) a verificação cruza a referência com a cadeia
  (existe, é anterior, tem o hash declarado, tem o tipo exigido) e `verificarLedger` acusa
  `referencia_outra_cadeia`. **Não mudaram** o formato do registro, a serialização canônica, o prefixo
  `pe-ledger/v1`, o hash, a reprodução nem os contratos de escrita: o JSON canônico e os hashes dos
  registros antigos são idênticos e o relatório de uma cadeia válida é idêntico byte a byte.
- **O que é reclassificado.** Só cadeias que o código anterior aceitava por conferir apenas a forma:
  `decisao` com hash inventado, apontando para o tipo errado ou para `seq` não anterior (adulterada).
  `decisao: null` e a referência real continuam íntegras. Provado por `compatibilidadeCodigoAnterior.test.ts`
  (fixture gerado pelo código de `6c8c7cd`).
- **`referencia_outra_cadeia` também vale para `corrige`.** Só age em `verificarLedger` e só quando o hash
  apontado pertence a uma cadeia que está no conjunto verificado. Efeito sobre `corrige` (cenários em
  `corrigeOutraCadeia.test.ts`): um `corrige` legítimo não muda; um `corrige` cujo hash é de outra cadeia,
  com o `seq` presente, já era `adulterada` (`correcao_hash_diverge`) e ganha o código; com o `seq`
  ausente passa de `incompleta` para `adulterada` **em `verificarLedger`** (em `verificarCadeia` isolada
  continua `incompleta`). A cópia parcial legítima (hash da própria cadeia, `seq` ausente) continua
  `incompleta`. Nenhum produtor correto gera um `corrige` com hash de outra cadeia.
- **Congelamento.** O contrato do esquema 1 passa a ser **congelado a partir da primeira persistência real**
  (L2). Antes disso nenhum registro foi gravado fora de testes: nenhum código de produção chama as funções
  de gravação, o pacote é privado e o build do app não inclui o ledger. O núcleo foi escrito e endurecido
  no mesmo dia (quatro commits), então o contrato do esquema 1 **não é anterior** a este endurecimento:
  depois do congelamento, qualquer mudança semântica exige esquema novo.
- **Fase A.** A referência exige que o apontado seja válido, não só que o hash confira (acima).

## Esquema 2: `fechamento` (SOMENTE LEITURA nesta versão)

**Esta versão LÊ e verifica o `fechamento`; NÃO o escreve.** `criarRegistro`, `conferirRegistro`,
`verificarReferencias` (nenhuma autorização é emitida), `anexar` e `anexarNaTransacao` recusam o tipo
("somente leitura"); nenhum produtor nem o formulário o gera. A escrita é uma etapa posterior, com
revisão própria.

| Item | Regra |
|---|---|
| Esquema do tipo | `ESQUEMA_DO_TIPO`: os cinco tipos antigos = 1 (hashes e contratos intocados); `fechamento` = **2**. Igualdade **estrita**: um tipo só é válido no seu esquema |
| `ESQUEMAS_SUPORTADOS` | `[1, 2]`. `VERSAO_ESQUEMA_LEDGER` (1) continua sendo o esquema dos registros que esta versão escreve |
| Hash | SHA-256 de `"pe-ledger/v2\n"` + JSON canônico de `{ cabecalho, corpo }` (o prefixo já vinha de `cabecalho.esquema`) |
| Corpo | exatamente: `aposta` `{ seq, hash }` (exato, `seq` inteiro ≥ 1, hash SHA-256); `oddFechamento` finito e **> 1**; `fechamentoOutros` lista **densa**, possivelmente vazia, de finitos **> 1**; `registradoEm` data ISO válida; `fonte` opcional, texto não vazio. Campo a mais é recusado |
| Cabeçalho | `corrige` proibido (como em todo tipo que não é `correcao`) |
| Referência | `aposta` aponta para um `aposta_registrada` **anterior, da mesma cadeia**, com o hash declarado (códigos `fechamento_*` e `referencia_outra_cadeia`) |
| Vários fechamentos | permitidos para a mesma aposta; **vale o de maior `seq`**; nada na verificação os proíbe. Correção de um fechamento: `correcao` (esquema 1) com `corrige` apontando para ele |
| Cadeias mistas | registros de esquema 1 e 2 na mesma cadeia; o encadeamento é por hash e não depende do esquema |

## Compatibilidade entre versões (matriz V0 × V1 × V2)

V0 = verificador anterior à Etapa 0 (só esquema 1). V1 = Etapa 0 (só esquema 1, esquema sobre tipo).
V2 = esquemas 1 e 2, leitura. Resultado real, com os mesmos registros verificados por cada versão:

| Registro lido | V0 | V1 | V2 |
|---|---|---|---|
| Esquema 1, tipos do esquema 1 | íntegra | íntegra | íntegra (hash idêntico) |
| Esquema 2 + `fechamento` válido | **adulterada** (alarme falso) | incompatível | **íntegra** |
| Esquema 2 + `fechamento` inválido | adulterada | incompatível (não julga) | adulterada (`corpo_incompativel`) |
| Esquema 2 + tipo dos cinco antigos | incompatível | incompatível | adulterada (tipo fora do esquema 2) |
| Esquema 1 + tipo `fechamento` | adulterada | adulterada | adulterada |
| Esquema 3 ou maior + qualquer tipo | adulterada se o tipo for desconhecido | incompatível | incompatível |
| Esquema 1 + tipo desconhecido | adulterada | adulterada | adulterada |
| Fechamento depois de um registro adulterado | adulterada | adulterada | adulterada |

`OpcoesVerificacao.esquemasSuportados` permite verificar COMO uma versão mais antiga (por exemplo `[1]`),
e é com ela que os testes cruzados V1 × V2 são feitos (`cruzadoV1xV2.test.ts`).

**Ordem segura de implantação:** (0) V1: esquema não suportado vence tipo desconhecido; (1) V2, só
leitura: ler e verificar o esquema 2, sem escrevê-lo; (2) habilitar a escrita do `fechamento`, só depois
de todo leitor estar em V2 (um backup com esquema 2 aberto numa versão V1 aparece como `incompatível`,
sem perda e sem reescrever nada); (3) backfill da L3. Voltar de V2 para V1 deixa as cadeias com
`fechamento` como `incompatível`; nada é reescrito (append-only).

## Limitações (importante)

1. **O hash local detecta alteração parcial, não impede adulteração deliberada.** Quem tem acesso às
   ferramentas do navegador pode apagar o banco inteiro ou **refazer a cadeia toda** de forma
   consistente; a verificação sozinha não detecta isso (há teste que demonstra o limite).
2. **Truncar o fim** da cadeia só é detectável com âncora externa.
3. **O horário (`criadoEm`) é do relógio do aparelho.** Não há carimbo de tempo externo.
4. **Texto com surrogate solitário** não vira blob (a codificação UTF-8 o trocaria por `U+FFFD`).
5. **Exige `crypto.subtle`** (https ou localhost; Node 20+).
6. A reprodução depende de o motor ser puro e determinístico, e de `agora` estar gravado na entrada.
7. **Os verificadores (`verificarCadeia`, `verificarLedger`) pressupõem registros ESTÁVEIS**: dados
   puros, como os de `JSON.parse` (importação) ou de `structuredClone` (o que um armazém IndexedDB
   devolve). Eles leem cada registro mais de uma vez (forma, hash, semântica, referências) e não
   tiram uma cópia canônica antes, ao contrário da porta de escrita (`anexar`), que lê cada registro
   uma única vez. Com objetos que mudam entre leituras (getters, Proxies), o relatório poderia
   descrever um conteúdo e o hash ter sido calculado sobre outro. Hoje isso não é explorável: nenhum
   código do aplicativo chama os verificadores, eles só produzem um relatório (nunca gravam nem
   autorizam gravação) e as duas fontes previstas de registros não produzem getters nem Proxies. Quem
   passar objetos montados à mão precisa antes convertê-los em dados puros (por exemplo,
   `JSON.parse(serializarCanonico(r))`).

## Ancoragem externa (mitigação)

Guarde fora do aparelho (anotações, e-mail para si mesmo, outro dispositivo) o trio
`{ cadeia, seq, hashPonta }` de `RelatorioCadeia`. Depois, `verificarCadeia(registros, { ancora })`:

- se o registro `seq` existe com outro hash → **adulterada** (`ancora_diverge`): o passado foi refeito;
- se a cadeia termina antes do `seq` ancorado → **incompleta** (`ancora_ausente`): foi truncada ou é cópia parcial.

Quanto mais frequente a âncora, menor a janela que um refazimento consistente consegue esconder.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `json.ts` | serialização canônica (cada propriedade e cada posição de array é lida uma vez; o nome do tipo de um objeto recusado é lido pelos descritores, sem executar getters) |
| `falha.ts` | **interno, fora da API pública**: `descreverFalha`, a descrição segura de um valor lançado (usa só uma `message` própria de texto lida pelo descritor; nunca executa getter, `toString`, `valueOf` ou `Symbol.toPrimitive`) |
| `hash.ts` | SHA-256 nativo, formato de hash, texto bem formado |
| `tipos.ts` | contratos (registro, corpos, relatórios) |
| `versao.ts` | `VERSAO_MOTOR`, `politicasVigentes()`, `impressaoDasPoliticas()` |
| `blobs.ts` | blob de texto bruto endereçado por conteúdo |
| `validacao.ts` | data ISO válida, corpo × tipo e tipo × esquema (inclui o corpo do `fechamento`) |
| `cadeia.ts` | `criarRegistro`, `conferirRegistro`, `verificarCadeia`, `verificarLedger` |
| `armazem.ts` | a ÚNICA porta de escrita, em duas fases: `anexar`; `verificarReferencias` (Fase A: registro novo, referências e registro anterior; emite a autorização), `anexarNaTransacao` (Fase B: autorização, guarda da ponta e comparação canônica); `TransacaoLedger`, `ArmazemLedger`, `ReferenciasVerificadas`, `AnteriorVerificado` (tipos), `conferirApontado`, `conferirReferencia`. Internos: `conferirPonta`, a cópia canônica do registro novo (`copiaConferida`) e dos registros lidos do armazém (`fotografar`, `copiaDoArmazem`, `pontaConferida`), o tratamento das leituras (`lerForaDaTransacao`, `lerNaTransacao`), o `WeakMap` de autorizações e a marca de tipo |
| `registroValido.ts` | **interno, fora da API pública** (não reexportado por `index.ts`): `motivoMalformado` (forma) e `motivoRegistroInvalido` (validador de leitura). Usado por `cadeia.ts`, `armazem.ts` e pelos testes do Ledger; quem está fora do Ledger verifica com `verificarCadeia` e `verificarLedger` |
| `reproducao.ts` | `resumirSaidaDoMotor`, `impressaoDaDecisao`, `reproduzir*` |
