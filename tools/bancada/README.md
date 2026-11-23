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
`historico`) é **recusado inteiro**, com motivo, e nada dele é aproveitado. Um `v3` exportado com
o banco de evidências fechado sai marcado `evidenciasIndisponiveisNaOrigem`.

## Conservação: nada some sem rastro

Para o histórico e para as evidências, cada registro físico (como veio em cada arquivo) termina
em exatamente uma categoria, e a soma é verificada (erro se não fechar):

    físicos = canônicos + duplicatas + substituídos + excluídos

- **duplicata**: a mesma identidade já vista (evidência: `[idJogo, hash, gravadoEm]`; histórico:
  mesmo id e mesmo conteúdo canônico).
- **substituído**: versão mais antiga de uma entrada que mudou entre backups (a canônica é a mais
  recente por resultado → aposta → salvamento); listada em `substituidas`.
- **excluído**: com categoria em `exclusoes` — `fonte-recusada`, `entrada-malformada`,
  `evidencia-malformada`, `evidencia-orfa`, `esquema-desconhecido`, `jogo-sem-chave`.

Depois da normalização: `entradasCanonicas = analises + semChaveDeJogo` e
`evidenciasCanonicas = evidenciasEmAnalises + evidenciasDeAnaliseExcluida`.

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
