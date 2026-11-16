# Ledger append-only: núcleo (L1)

Núcleo **puro**: tipos, serialização canônica, SHA-256, encadeamento, verificação e reprodução.
Não grava em lugar nenhum (nada de IndexedDB), não tem interface e não é chamado por nenhum fluxo
do site ainda. As fases L2 (armazenamento e ganchos) e L3 (painel e backup) dependem de nova aprovação.

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
| **incompativel** | Há registro de um esquema que esta versão não sabe verificar. Não é "ok" nem "adulterado". |

Precedência quando há mais de um problema: adulterada > incompatível > incompleta > íntegra.

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
`criarRegistro(pedido, ponta)` e grava assim:

1. `await conferirRegistro(novo)` — **antes** da transação: o registro é válido em si (forma, esquema,
   data, corpo coerente com o tipo e **hash declarado = hash recalculado**). Falha com `ErroDeCadeia`,
   que **não** se resolve relendo a ponta.
2. Dentro da transação de gravação, **sem `await` de nada que não seja do próprio banco** (uma
   transação de IndexedDB se encerra sozinha se aguardar outra coisa): `conferirPonta(pontaGravadaAgora, novo)`
   (síncrona). Se outro escritor avançou a ponta, lança `ConflitoDeCadeia`; o escritor relê a ponta,
   recria e recomeça.

`aceitarAnexo(ponta, novo)` (assíncrona) faz os dois passos em sequência, para quem não usa transação.
A chave do armazém deve ser `(cadeia, seq)` com `add`, que também recusa um `seq` repetido: duas defesas.
`aceitarAnexo` **não** confia em que o registro veio de `criarRegistro`.

**Contrato da L2 para correções (ainda não implementado):** `conferirRegistro` e `conferirPonta` só veem
o registro novo e a ponta; **não** veem o registro apontado por `corrige`. A L2 precisa, na gravação de
uma `correcao`, ler o registro `(cadeia, corrige.seq)` **na mesma transação** e recusar se ele não
existir ou se o seu `hash` não for `corrige.hash` (a verificação histórica já faz esse cruzamento em
`verificarCadeia`: `correcao_referencia_ausente` e `correcao_hash_diverge`).

## Coerência semântica (esquema 1)

Aplicada em `criarRegistro`, `conferirRegistro`/`aceitarAnexo` **e** `verificarCadeia` (`validacao.ts`):

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

## Limitações (importante)

1. **O hash local detecta alteração parcial, não impede adulteração deliberada.** Quem tem acesso às
   ferramentas do navegador pode apagar o banco inteiro ou **refazer a cadeia toda** de forma
   consistente; a verificação sozinha não detecta isso (há teste que demonstra o limite).
2. **Truncar o fim** da cadeia só é detectável com âncora externa.
3. **O horário (`criadoEm`) é do relógio do aparelho.** Não há carimbo de tempo externo.
4. **Texto com surrogate solitário** não vira blob (a codificação UTF-8 o trocaria por `U+FFFD`).
5. **Exige `crypto.subtle`** (https ou localhost; Node 20+).
6. A reprodução depende de o motor ser puro e determinístico, e de `agora` estar gravado na entrada.

## Ancoragem externa (mitigação)

Guarde fora do aparelho (anotações, e-mail para si mesmo, outro dispositivo) o trio
`{ cadeia, seq, hashPonta }` de `RelatorioCadeia`. Depois, `verificarCadeia(registros, { ancora })`:

- se o registro `seq` existe com outro hash → **adulterada** (`ancora_diverge`): o passado foi refeito;
- se a cadeia termina antes do `seq` ancorado → **incompleta** (`ancora_ausente`): foi truncada ou é cópia parcial.

Quanto mais frequente a âncora, menor a janela que um refazimento consistente consegue esconder.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `json.ts` | serialização canônica |
| `hash.ts` | SHA-256 nativo, formato de hash, texto bem formado |
| `tipos.ts` | contratos (registro, corpos, relatórios) |
| `versao.ts` | `VERSAO_MOTOR`, `politicasVigentes()`, `impressaoDasPoliticas()` |
| `blobs.ts` | blob de texto bruto endereçado por conteúdo |
| `validacao.ts` | data ISO válida e corpo × tipo |
| `cadeia.ts` | `criarRegistro`, `conferirRegistro`, `conferirPonta`, `aceitarAnexo`, `verificarCadeia`, `verificarLedger` |
| `reproducao.ts` | `resumirSaidaDoMotor`, `impressaoDaDecisao`, `reproduzir*` |
