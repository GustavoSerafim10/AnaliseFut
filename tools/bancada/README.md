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
