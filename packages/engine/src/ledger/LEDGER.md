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
| **incompleta** | Nada adulterado entre o que existe, mas faltam registros (não começa no 1, ou lacuna de `seq`). Cópia parcial e remoção **não** se distinguem só pela cadeia. |
| **adulterada** | Hash que não confere, `prevHash` que não bate, `seq` duplicado com conteúdo diferente, gênese com `prevHash`, registro malformado, continuidade artificial ou âncora externa que diverge. |
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

## Coerência semântica (esquema 1)

Aplicada em `criarRegistro`, `conferirRegistro`/`aceitarAnexo` **e** `verificarCadeia` (`validacao.ts`):

| Tipo | Corpo (exatamente estes campos; `undefined` conta como ausente) |
|---|---|
| `decisao` | `entradaMotor {v4, lista}` (objeto ou null), `saida`, `snapshot {odds, estatisticas, contexto, prints}` (`prints`: nome → hash de blob), `impressao` (texto) |
| `aposta_registrada` | `decisao` (null ou `{seq, hash}`), `aposta`, `stakeAutorizada`, `travas` |
| `resultado` | `decisao` (null ou `{seq, hash}`), `resultado` |
| `correcao` | `motivo` (texto), `novo`; o cabeçalho **exige** `corrige` |
| `exclusao` | `motivo` (texto ou null) |

Campo a mais, campo a menos ou de outro tipo é incompatível; `corrige` em tipo que não é `correcao` também.
`criadoEm` precisa ser ISO 8601 com deslocamento **e existir no calendário** (a conferência é por
componente: o `Date.parse` do V8 aceita 30/02 e o rola para março). Na verificação, estes problemas
são `data_invalida` e `corpo_incompativel` e tornam a cadeia **adulterada**, mesmo que o hash confira
(registro forjado com hash refeito). Registros de esquema desconhecido não são julgados por estas regras.

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
