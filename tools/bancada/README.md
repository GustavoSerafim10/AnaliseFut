# Bancada (Fase 1) — F1.1: leitura e normalização

Ferramenta **local e só de leitura**. Lê backups exportados pelo site (Fase 0), junta, normaliza
e entrega um conjunto de registros. Não grava nada no site, no motor, na V4, no Ledger nem nos
dados da Fase 0. Não faz parte do build nem do deploy do site.

**Escopo da F1.1:** contrato de leitura e normalização. Nada de reprodução histórica, métricas,
taxas, médias ou conclusões — isso vem nas etapas seguintes, cada uma com autorização própria.

## Uso

```sh
npm --prefix tools/bancada run test        # testes da bancada (fora do CI de deploy)
npm --prefix tools/bancada run typecheck
npx eslint tools/bancada                   # o lint da raiz (npm run lint) também cobre a bancada
```

No Windows, rode o vitest pelo PowerShell (pelo Git Bash ele falha ao resolver a letra do disco).

```ts
import { montarConjunto } from './src/index';
const conjunto = await montarConjunto([{ nome: 'backup.json.gz', bytes }]);
```

Sem dependência nova: reaproveita funções puras da Fase 0 (`apps/web/src/backupGz.ts`,
`evidencias.ts`, tipos de `historico.ts`) e do motor (`@pe/engine`), importadas sem efeito de
navegador.

## Formatos lidos

| formato   | o que traz                                   | evidências                                                   |
| --------- | -------------------------------------------- | ------------------------------------------------------------ |
| `v3-gz`   | `.json.gz` da Fase 0: histórico + revisões   | SHA-256 por revisão, conferido em duas passadas              |
| `v2-json` | `.json` versão 2: histórico + `evidencias`   | SHA-256 conferido; item sem forma de revisão vira exclusão   |
| `v1-json` | `.json` antigo, sem `versao`: só o histórico | **formato anterior à estrutura de evidências** — não é perda |

Arquivo defeituoso (gzip truncado, SHA divergente, JSON inválido, versão desconhecida, sem
`historico` ou com `historico` que não é lista) é **recusado inteiro**, com motivo, e nada dele é
aproveitado — nunca vira lista vazia. Um `v3` exportado com
o banco de evidências fechado sai marcado `evidenciasIndisponiveisNaOrigem`.

## Conservação: nada some sem rastro

Para o histórico e para as evidências, cada registro físico (como veio em cada arquivo) termina
em exatamente uma categoria, e a soma é verificada (erro se não fechar):

    físicos = canônicos + duplicatas + substituídos + excluídos

- **duplicata**: a mesma identidade já vista (evidência: `[idJogo, hash, gravadoEm]`; histórico:
  mesmo id e mesmo conteúdo canônico).
- **substituído**: versão mais antiga de uma entrada que mudou entre backups; listada em
  `substituidas` com as datas originais. A canônica é a mais recente por resultado → aposta →
  salvamento, comparando o **instante** (`Date.parse`), nunca o texto. Cada entrada canônica diz
  o `criterio`: `unica`, `recencia` ou `desempate-por-conteudo` — este quando alguma data é
  ilegível ou as datas empatam; a escolha continua determinística, mas sai com `alerta` e motivo.
- **excluído**: com categoria em `exclusoes` — `fonte-recusada`, `entrada-malformada`,
  `evidencia-malformada`, `evidencia-orfa`, `esquema-desconhecido`, `jogo-sem-chave`.

Depois da normalização: `entradasCanonicas = analises + semChaveDeJogo` e
`evidenciasCanonicas = evidenciasEmAnalises + evidenciasDeAnaliseExcluida`. Cada revisão de uma
análise sem chave de jogo também é registrada **individualmente** em `exclusoes`
(`evidencia-de-analise-sem-chave`, com identidade, arquivo de origem e motivo).

## O que sai (`Conjunto`, contrato versão 1)

- **jogos** — a unidade independente (`casa|fora|início`, nomes sem acento/caixa). Análises do
  mesmo jogo com ids diferentes (irmãs) formam um jogo; placares divergentes marcam
  `conflitoPlacar`.
- **analises** — uma por entrada do histórico. **Revisão de decisão = a última gravada antes do
  apito**; abertura = a primeira; revisões depois do apito são contadas e ficam fora.
- **selecoes** — da revisão de decisão: cada lado avaliado pela V4 e cada item da lista "Melhores
  entradas", juntos pela chave da seleção. Camadas `betV4`, `noBetPapel`, `lista` — nunca
  somadas. Quatro fontes de probabilidade: `pMercado` (com `fonteP`), `pConsenso`,
  `pModeloAjustado`, e `pModeloBruto`/`pMistura`/`wMistura` = `null` (derivação pendente, F1.3).
  `desfecho` também pendente (F1.3). Tipo de aposta pelo liquidador do motor; grupo `nicho` =
  nível 3 (escanteios, cartões).
- **apostas** — só quem clicou "Entrei". Odd usada, odd efetiva (comissão da Betfair Exchange,
  como no EV da V4), faixa pela odd usada, estado do resultado (inclui `fechamento-sem-placar`).
- **impressao** — SHA-256 da forma canônica: mesmos arquivos (em qualquer ordem) → mesma
  impressão.

## Faixas de odds (pré-registradas, sem sobreposição)

`<1,40` · `[1,40; 1,60)` · `[1,60; 1,80)` · `[1,80; 2,00]` · `(2,00; 3,00]` · `>3,00`.
As três do meio são a faixa preferencial (2,00 incluso). **É dimensão de análise, não filtro.**
`recortarSelecoes` só devolve chaves de registros (faixa × grupo × tipo × camada), nunca taxas.

## CLV padronizado (por registro)

- `principal` = odd × p_fechamento_sem_margem − 1 (só com o mercado de fechamento completo; margem
  removida com a função do motor, Shin com 3 lados);
- `log` = ln(odd × p_fechamento_sem_margem);
- `bruto` = odd ÷ odd_fechamento − 1 (contra a odd com margem; relatado à parte).

δ pré-registrado: **2 %** (`ln 1,02` na escala log). O δ de log-loss será pré-registrado antes
de qualquer comparação confirmatória.

## Limitações conhecidas

- O fechamento não tem horário de coleta (só `resultado.registradoEm`): todo CLV sai com
  `janela: "nao-verificada"`.
- O peso `w` do apoio da V4 não é gravado na evidência; é derivável (DQ + configuração) na F1.3.
- A chave do jogo depende de nomes digitados: grafias muito diferentes do mesmo time não se
  juntam (apelidos não são resolvidos).
- O CLV "no papel" de uma seleção só existe para a entrada registrada, porque o fechamento é
  informado só para ela.

## F1.2a — reprodução histórica (orquestrador, área isolada, harness)

Reproduz cada revisão de evidência **no build que a gerou** e diz, com motivo, se a decisão se
reproduz. Valida a capacidade de reproduzir decisões históricas; não altera nem "melhora"
probabilidade alguma do motor. Reprocessamento (F1.2b) e backups reais (F1.2c) ainda não.

```sh
npm --prefix tools/bancada run test             # suíte rápida (build falso, executor no processo)
npm --prefix tools/bancada run test:reproducao  # suíte lenta: builds reais na área isolada
```

**Área isolada** (D5): `%LOCALAPPDATA%\pe-bancada\` — `builds/<commit>/` (código por
`git archive` + `npm ci --ignore-scripts` com o lockfile do commit, cache com `build.json`) e
`execucoes/<id>/` (`entradas/`, `saidas/`, `registros/`, `conteudos/<sha>.json`,
`resultados.jsonl`, `manifesto.json`). Caminho dentro do repositório é recusado. O repositório
principal só é lido (`git cat-file`, `git archive`, com `GIT_OPTIONAL_LOCKS=0`).

**Harness**: `src/reproducao/harness/` é copiado para `<build>/apps/web/test/` e roda com o
vitest **daquele commit**, um processo por revisão, com tempo limite (60 s; a árvore inteira é
encerrada), `TZ=America/Sao_Paulo`, rede desviada (proxy morto + `fetch` bloqueado) e relógio
parado em `meta.calculadoEm.inicio`. Antes de calcular, confere o fuso **efetivo** (nome e
deslocamento medido) e, quando o código usa localidade padrão (`localeCompare` sem localidade —
caso atual), a localidade efetiva (`pt-BR`). Números marcados `{$invalido}` voltam à entrada só
se listados em `conteudo.invalidos` no mesmo caminho.

**Comparação**: hash → estrutura (ausente, null, NaN, ±Infinity e `{$invalido}` são tipos
distintos) → campos de decisão sem tolerância. Tolerância D3:
`|a−b| ≤ max(1e-12, 1e-12·max(|a|,|b|))`.

**Classes**: `original-exata`, `original-equivalente`, `original-divergente`,
`nao-reproduzivel` (subcausas: `commit-ausente`, `build-nao-elegivel`,
`dependencias-indisponiveis`, `api-ausente`, `entrada-irrecuperavel`, `relogio-desconhecido`,
`erro-execucao`, `tempo-esgotado`, e os acréscimos `ambiente-invalido`,
`evidencia-inconsistente`). `reprocessamento` só na F1.2b. Marcas da F1.1 (ex.:
`cronologiaNaoComprovada`) seguem em cada resultado.

**Limitações aprovadas da F1.2a**

- A evidência do teste demonstrativo (suíte real, teste 1) é **gerada dentro do build isolado
  de `8964bf4`**, pelo código e pelo vitest daquele commit (`test-reproducao/zz-bancada-gerador.ts`,
  com a procedência dos módulos conferida), e não pela árvore de trabalho — a suíte roda mesmo
  com alterações pendentes no site. A identidade do build é conferida arquivo a arquivo contra o
  commit (`apps/`, `packages/`, `package.json`, `package-lock.json`; blobs calculados pelo próprio
  git). Ainda assim é uma evidência sintética: demonstra a capacidade de reprodução, mas **não é
  uma evidência histórica original de produção**.
- Commits que existem apenas no GitHub ainda não são recuperados automaticamente (não há
  clone da origem nesta etapa): um commit ausente do repositório local resulta em
  `nao-reproduzivel/commit-ausente`.

## F1.2b — reprocessamento

Para o que a F1.2a não reproduz no build original, a F1.2b responde outra pergunta: **o motor
de referência decidiria igual com a mesma entrada?** Isso nunca vale como reprodução original e
fica numa camada própria (`classe: 'reprocessamento'`).

```ts
import { reproducaoHistorica } from './src/reproducao/historica';
const r = await reproducaoHistorica(juncao, { area, provedor, executor, executorHistorico });
```

- **Entrada**: a junção da F1.1. Revisões de evidência vão para `reproduzir()` da F1.2a, sem
  mudança; só as tentativas que terminam em `build-nao-elegivel` ou `commit-ausente` caem para o
  reprocessamento (lista fechada). `original-divergente` e as demais subcausas são finais. A
  tentativa original segue inteira em `tentativaOriginal`.
- **Entradas do histórico**: cada uma tem exatamente um destino — `coberta-por-evidencia` (as
  revisões são os itens), `irma-vinculada` (aposta irmã: aponta para o resultado da raiz, nunca
  conta como concorda/diverge), `reprocessamento` ou `nao-reproduzivel/<subcausa>`.
- **Referência** (`referencia.json`): só o SHA de 40 caracteres do primeiro commit **publicado**
  com a Fase 0 — **registrado em 24/11/2026: `ef6df15`** (o primeiro servido em produção; o
  `b7b3235` também tinha a Fase 0, mas o deploy dele falhou). Sem SHA registrado, o resultado
  seria `sem-build-referencia`. Nunca HEAD, branch,
  tag ou "o mais recente". `8964bf4` é a **referência sintética de teste**: aceita só no modo de
  teste, recusada como oficial, e marcada `tipo: 'teste-sintetica'` em todo resultado e no
  manifesto (contagens separadas por tipo, nunca somadas com produção).
- **Relógio inferido (D1 corrigida)**: `salvoEm` tem precisão de minuto (o site grava
  `AAAA-MM-DDTHH:MM:00-03:00`), então o instante real está em `[salvoEm, salvoEm + 60 s)`. Só há
  relógio quando: formato exato do site (com conferência de ida e volta — `Date.parse` aceita
  datas impossíveis como 30/02), data e hora preenchidas (hora vazia viraria 00:00 fabricado),
  `resumo.inicio` igual ao que o site montaria, `salvoEm + 60 s <= inicio`, e sem a marca
  `cronologiaNaoComprovada` (D-b). O reprocessamento roda nas **duas pontas** do minuto:
  qualquer diferença no resumo → `relogio-desconhecido` (nenhuma ponta é escolhida). Falha de
  uma ponta (tempo, ambiente, erro do harness) → falha, nunca divergência, com o parcial em
  `pontas`.
- **Comparação**: campos de decisão sem tolerância (decisão, DQ, seleção técnica: chave, odd,
  casa, EV, P, nível). `stake` e lista "Melhores entradas" → `nao-comparavel` (D-d: o histórico
  não guarda travas nem apostas registradas). Aposta escolhida na lista → seleção
  `nao-comparavel` (o site troca `resumo.entrada`). Protocolo gravado ≠ V4 →
  `protocolo-diferente`, fora de concorda/diverge (D-c).

**Limitações da F1.2b**

1. "Diverge" não é erro: o motor de referência é mais novo que muitas entradas; a F1.4 trata o
   reprocessamento como camada própria.
2. `salvoEm` supõe o aparelho em −03:00 (rótulo fixo do site); outro fuso não é detectável.
3. A D1 corrigida reduz a cobertura (salvo no minuto do apito, depois dele, ou com cronologia não
   comprovada → desconhecido), de propósito.
4. Backups `.json` gravam `NaN` como `null`: o rascunho do histórico não tem marcadores
   `{$invalido}` para restaurar; o reprocessamento usa o que o backup guardou.
5. Navegador × Node, como na F1.2a.
6. A referência oficial (D4, `ef6df15`) foi registrada em 24/11/2026. As suítes continuam usando
   só a referência sintética de teste; a primeira execução com a oficial preparará o build dela
   (cerca de 160 MB na área isolada).

## F1.2c — ponto de entrada, diagnóstico e consolidação

```ts
import { executarBancada } from './src/reproducao/executarBancada';
// só previsões: não prepara build, não abre processo, não executa o motor
await executarBancada(arquivos, { modo: 'diagnostico', area });
// execução: F1.2a + F1.2b sobre a MESMA junção, depois consolidação
await executarBancada(arquivos, { modo: 'execucao', area, provedor, executor, executorHistorico });
```

Uma leitura e uma junção para tudo: a impressão do conjunto é a mesma de `montarConjunto`.

**Status por análise elegível** (exatamente um): `reproduzida` (revisão de decisão
original-exata/equivalente), `reproducao-divergente`, `reprocessada` (com `comparacao` e o tipo
da referência), `nao-reproduzivel` (com a subcausa), `sem-revisao-de-decisao` (tem evidência, mas
nenhuma revisão antes do apito — fato da F1.1, não falha de reprodução) e `nao-executado` (modo
diagnóstico).

- **Revisão representativa**: sempre a revisão de decisão da F1.1 (`identidadeDecisao`).
  Revisões depois do apito nunca a substituem.
- **Apostas irmãs**: herdam o status da raiz e nunca contam como análise. Raiz ausente, excluída
  pela F1.1 ou também irmã → `vinculo-nao-resolvido`, com o motivo.
- **Conservação** em universos separados: análises elegíveis, irmãs e entradas excluídas pela
  F1.1 somam as entradas canônicas, sem repetição; seleções e apostas herdam o status da
  análise (ou `vinculo-nao-resolvido`). Exclusões da F1.1 contadas por categoria.
- **Diagnóstico**: cada previsão sai `natureza: 'previsao'`. `determinado` só quando o desfecho
  não depende de execução (D1 reprovada, evidência inconsistente, sem referência); o resto fica em
  `naoVerificado` (falhas que só a execução revela, inclusive commit ausente e relógio ambíguo).
  A referência registrada é aceita sem conferir se o commit existe (`verificada: false`).
- **Camadas**: com a referência sintética, `camada: 'teste-sintetica'`; sem ela, `producao`. Um
  resultado de uma camada nunca entra na consolidação da outra (erro).

**Política de dados reais**

- Toda saída fica em `%LOCALAPPDATA%\pe-bancada\execucoes\<id>\` — nunca no repositório:
  `consolidado.json` (detalhe, com ids e chaves de jogo: uso local) e `relatorio-revisao.json`
  (só contagens e impressões: é o que vai para revisão, sem times, casas ou ids).
- Os testes usam só dados sintéticos, gerados com as funções do site ou dentro do build isolado.
- Rodar sobre backups reais exige autorização explícita a cada vez; apagar uma execução é
  apagar a pasta dela.

**Limitações da F1.2c**

1. Sem retomada: uma execução interrompida recomeça do zero.
2. O diagnóstico não confere se commits e a referência existem (isso exigiria `git`): essas
   possibilidades ficam em `naoVerificado`.
3. Nos testes reais, os arquivos de backup são montados com o serializador da árvore de trabalho
   (o conteúdo — evidências e entradas — nasce dentro do build isolado).
4. Com a D4 registrada (`ef6df15`), uma execução de produção reprocessa na referência oficial;
   as evidências reais só existem a partir da publicação da Fase 0 (24/11/2026).

## F1.3 — derivações (P do modelo, peso w, mistura e desfecho)

```ts
await executarBancada(arquivos, {
  modo: 'execucao',
  area,
  provedor,
  executor,
  executorHistorico,
  derivar: true,
});
// → derivacoes.json (detalhe, local) e relatorio-derivacoes.json (só contagens)
```

Só na bancada; o motor é apenas **lido** (`criarModelo`, `distribuicaoModelo`, `probEfetiva`,
`pesoModelo`, `apurarAposta`). Três universos, cada registro com exatamente um estado:

- **Seleções** (análises com revisão de decisão): `pModeloBruto` (λ antes do ajuste 9.4),
  `pModeloAjustado` (o λ que a V4 usou), `wMistura` (DQ + mercado muito líquido + escalação
  incerta, teto 0,30 no nicho), `pMistura = w × P_ajustado + (1 − w) × P_mercado` (a mistura da
  V4) e `pMisturaBruta` (a mesma com o λ bruto, para a F1.4 medir o efeito do ajuste). No R3 a
  parte "mercado" é o `P_consenso` (o P_true gravado do R3 já é mistura).
- **Entradas das análises elegíveis** (inclui v1/v2): só desfecho; sem evidência, os campos do
  modelo ficam `indisponivel-sem-evidencia` — nada é fabricado (E4).
- **Apostas feitas**: só desfecho.

**Conferência obrigatória (E2: motor atual)**: o recálculo é comparado com o que a evidência
gravou — `pModelo` da V4, `wModelo` e `P_true` no R3, `pModelo` e `chance` da lista — com a
tolerância D3. Não bateu → `derivacao-divergente`, com os campos; nunca corrigido em silêncio.

**Régua do desfecho** (a do motor, `probEfetiva`): ganho y=1 peso 1 · meio ganho y=1 peso ½ ·
devolvida fora (peso 0) · meia perda y=0 peso ½ · perda y=0 peso 1. Nunca 0,75 nem 0,5 como y.
Um teste prova, enumerando a matriz de placares, que a média ponderada de y é exatamente o
`probEfetiva`. Estados: `apurado`, `sem-placar`, `placar-em-conflito`, `dado-insuficiente`,
`mercado-desconhecido` e `conflito-manual` (E3: só quando o placar é apurável e a marcação manual
diverge da apuração automática, que prevalece; sem placar continua `sem-placar`).

**Limitações da F1.3**

1. Derivação com o motor atual: a conferência detecta diferença de versão, não a corrige.
2. Mercados que pedem dado fora do placar (1º gol, escanteios do 1º tempo...) ficam
   `dado-insuficiente`.
3. Análises v1/v2 não têm P do modelo: a calibração do modelo começa com as evidências gravadas a
   partir da publicação da Fase 0.
