# Pricing Engine Web — protocolo V4.0

Ferramenta pessoal de análise pré-live: prints → conferência humana → motor determinístico →
decisão (🟢 BET / 🟡 WATCHLIST / 🔍 INVESTIGAR / ⛔ NO BET). **NO BET é o padrão.**
A leitura dos prints só extrai dados; **quem calcula é o código** (`packages/engine`).

**V4.0 — referência afiada × casa mole.** O preço justo (P_true) vem da Pinnacle/Betfair sem
margem (R1) ou da mediana de 4+ casas (R2). A entrada aparece quando uma casa de varejo (1win,
Betano, Bet365…) paga acima desse preço com folga sobre o gate. O motor V3.3 continua como
apoio: filtro (passo 6), preço de nichos sem referência (R3) e previsão. Só modelo (R4) nunca
vira BET. O CLV contra o fechamento justo da referência é o termômetro principal.

| Referência | EV mínimo | Kelly | Teto por aposta |
|---|---|---|---|
| R1 afiada, liga principal, ≤ 24 h | 2% | 1/4 | 2% |
| R1 liga menor ou > 24 h | 3% | 1/4 | 2% |
| R2 consenso de 4+ casas | 3,5% | 1/6 | 2% |
| R3 modelo + consenso (nichos) | 5% | 1/8 | 1% |

Odd > 4: +1 pp · odd > 8: +3 pp · escalação incerta: +1 pp · EV > 15%: INVESTIGAR.
Banca: 6% por dia; drawdown 20% → Kelly pela metade; 30% → pausa de 7 dias; 5 perdas no dia
→ dia encerrado.

## Comandos

```powershell
npm install          # instala as dependências (uma vez)
npm run dev          # abre o site em http://localhost:5173 (e no celular, pelo IP mostrado em "Network")
npm run build        # gera a versão de produção em apps/web/dist
npm test             # roda todos os testes (motor, parsers, schemas)
npm run test:watch   # testes em modo observação (re-roda ao salvar)
npm run typecheck    # checa os tipos do TypeScript
npm run lint         # ESLint
npm run format       # Prettier (formata o código)
npm run check        # typecheck + lint + testes
```

## Estrutura

```
packages/engine   motor V3.3 em TypeScript puro (sem UI, sem rede), testado com Vitest
  src/poisson.ts        matriz de placares Poisson + Dixon-Coles (seção 10)
  src/devig.ts          margem, de-vig proporcional e pela potência (seção 11)
  src/liquidacao.ts     AH/totais com quartos e push; EV com meios resultados (seção 13)
  src/mercados.ts       liquidação de cada mercado e P_modelo (níveis 1 e 2)
  src/descricao.ts      texto "a aposta ganha se…" (regra 0.10)
  src/precificacao.ts   de-vig por casa e por mercado, consenso (mediana), melhor odd, outliers
  src/lambdaMarket.ts   λ_market por mínimos quadrados em todas as linhas + coerência (9.1)
  src/lambdaModelo.ts   λ do modelo a partir das estatísticas, shrinkage n/(n+8) (9.2)
  src/contagens.ts      nível 3: λ e distribuição (binomial negativa) de escanteios e cartões
  src/ajustesLambda.ts  checagem λ_modelo × λ_market (9.4) e viés conhecido (16.3)
  src/gates.ts          blend, edge gate, price gate (12, 14, 20)
  src/sensibilidade.ts  cenários ROBUSTA / MODERADA / FRÁGIL (15)
  src/kelly.ts          Kelly fracionado, teto 2%/aposta e 5%/lote (21)
  src/varredura.ts      todos os mercados: top 5, descartados com motivo, 1 instrumento por tese (19)
  src/decisao.ts        pipeline V3.3 completo e decisão (22–23) — hoje motor de apoio
  src/v4.ts             protocolo V4.0: níveis R1–R4, EV contra a referência, gates, filtro, stake
  src/banca.ts          travas da banca (drawdown, pausa, perdas no dia, teto diário)
  src/movimento.ts      movimento de linha entre prints e atraso da casa mole
  src/promocoes.ts      EV de odd turbinada, freebet, aposta sem risco e bônus com rollover
  src/apuracao.ts       apuração depois do jogo (placar → ganho/perda/push), CLV justo e Brier
  test/                 testes, incluindo o lote de 21/10/2026 e as odds reais Villa × Viking
```

```
packages/schemas  schemas zod (OddLine, StatsTime, importação JSON)
packages/parsers  texto do OCR → odds: detecção da fonte e da casa, sinônimos de mercado,
                  reconhecimento de times, leitor de odds (1win e demais casas), sanidade,
                  junção de prints; leitores de estatísticas, desfalques, tabela e Flashscore
apps/web          site React + Vite (mobile-first)
  src/abas/       Jogo · Estatísticas (SofaScore, SuperScore, Flashscore, Tabela e desfalques,
                  Últimas partidas) · Odds (uma aba por casa) · Análise · Histórico
  src/dados.ts    tudo derivado dos textos lidos: parsers → cruzamento → λ → DQ → motor → análise
  src/historico.ts  histórico no aparelho: resumo congelado, apuração, balanço, backup JSON
  src/claude.ts   botão "Copiar para o Claude" (só copia texto; nenhuma API)
  src/ocr.ts      Tesseract.js no navegador (cinza, inverte tema escuro, amplia 3x, limiar)
```

### Dicas de print (testadas com prints reais)
- **SofaScore** "Comparar equipes" e **SuperScore** "Estatísticas do time → Média": pode printar
  a tela normal, vários prints rolando a página. O leitor corrige o ponto decimal perdido
  ("20" → 2,0), cruza as duas fontes e marca em vermelho o que diverge.
- **Classificação** e **desfalques**: recorte só a tabela/lista. Com barras laterais o OCR se perde.
- **Odds**: uma aba por casa (botão "+ casa"). Mande todos os mercados, quantos prints forem.
  Se o print mostrar a marca de outra casa, a aba avisa. Use o formato de odd **decimal** (1.85).
- `npm run ocr -- print.png` mostra o texto que o OCR lê de um print (útil para criar fixtures).

### Referência (Pinnacle/Betfair)
Crie uma aba de odds chamada **Pinnacle** ou **Betfair** e mande os prints dela **no mesmo
minuto** dos prints da casa mole (até 10 min de diferença; acima disso o mercado não é
comparado). Mande um print novo da referência perto do jogo: se ela se mexer e a casa mole
não, a aba Análise mostra o **atraso**. Sem referência e com 4+ casas, vale o consenso (R2).

### Histórico
Na aba Análise, "💾 Salvar no histórico" guarda o rascunho e congela a decisão do momento
(depois do início o motor exclui o jogo, porque só analisa pré-live). Depois do jogo, na aba
Histórico, registre o placar (o intervalo, escanteios e cartões são opcionais e só são necessários
para apurar esses mercados) e o **fechamento da referência** (lado apostado e, para tirar a
margem, os outros lados). O balanço mostra o CLV por estratégia (S1–S4) com os marcos de 100 e
300 apostas, as melhores entradas "no papel" e o Brier do modelo × mercado. A banca separada
definida ali liga as travas e a stake em R$.
O histórico fica no aparelho: **Exportar JSON** para backup ou para levar ao celular.

### Usar no celular
Com `npm run dev` rodando no PC, abra no celular (mesmo Wi-Fi) o endereço `Network: http://192.168.x.x:5173`
que aparece no terminal. Se não abrir, libere o Node no Firewall do Windows (rede privada).

### Importar JSON
Quando o OCR falhar, cole no passo 2 um JSON neste formato (validado com zod):

```json
{
  "jogo": { "casa": "Aston Villa", "fora": "Viking" },
  "odds": [
    { "casa": "1win", "mercado": "1X2", "lado": "1", "odd": 1.24, "horarioColeta": "2026-10-21T09:30:00-03:00" },
    { "casa": "1win", "mercado": "total_time", "time": "fora", "linha": 0.5, "lado": "under", "odd": 2.4 },
    { "casa": "1win", "mercado": "AH", "lado": "fora", "linha": 1.5, "odd": 2.24 }
  ]
}
```

Convenções de `lado` por mercado: ver o comentário de `LinhaOdd` em `packages/engine/src/tipos.ts`.

### Limitações conhecidas
- **1win, SofaScore e SuperScore** foram calibrados com os prints reais de Flamengo × Atlético-MG
  (26/10/2026, em `packages/parsers/test/fixtures-reais/`). **Bet365, Betano, Superbet e
  Pinnacle** usam o mesmo leitor, testado só com textos no formato público dessas casas: os
  primeiros prints reais de cada uma devem virar fixtures.
- Odds fracionárias (5/4) e americanas (+150) não são lidas: só decimais.
- Escanteios e cartões: o SuperScore "Média" mostra só os escanteios do próprio time. Sem os
  escanteios cedidos, o adversário entra como neutro. Árbitro não é considerado nos cartões.
- Histórico e rascunho ficam no `localStorage` do aparelho (sem servidor): exporte o JSON.
- Primeiro/último gol, 1º escanteio e mercados de escanteios/cartões do 1º tempo são apurados à mão.

## Escolhas de implementação a revisar

### V4.0
- **R3 só em nichos e ligas pequenas.** Em liga principal sem referência, o mercado principal
  fica R4 (só previsão): com uma casa só, o modelo achava "valor" no azarão — a lição 3.
- **Filtro do modelo:** discorda > 10 pp com fato novo → PASS; por viés conhecido (16.3 ou prior
  neutro) → ignorado; sem fato e sem viés → stake pela metade (o protocolo não diz; escolha
  conservadora).
- **Ranking:** o candidato é o de maior folga sobre o próprio gate (R1 a 2% e R3 a 5% não
  competem pelo EV cru). EV > 15% em qualquer mercado → INVESTIGAR.
- **Betfair:** as odds back entram como referência com de-vig normal (o preço médio entre back e
  lay ainda não é lido); quando a melhor odd é da Betfair, 6,5% de comissão sai do lucro.
- **Red team e sensibilidade** só são exigidos no R3 (preço do modelo). No R1/R2 o preço é do
  mercado; a DQ das estatísticas não entra no gate.
- **Odd > 8** soma +3 pp no lugar do +1 pp de odd > 4 (não acumulam).
- **Não implementado ainda:** teto de 3% em apostas correlacionadas (precisa do lote), lucro e
  limites por casa (seção 9), checagem de horário entre casas no R2.

### V3.3 (motor de apoio)

- **Tese** de cada mercado é detectada automaticamente pela direção em que a aposta "torce":
  supremacia do mandante, visitante resiste, jogo aberto ou jogo fechado.
- **Edge gate:** cada agravante (pouco líquido, escalação incerta, modelos divergentes, λ largo)
  soma +1 pp — leitura conservadora do protocolo.
- **9.4 sem explicação concreta:** o λ_modelo é movido até o limite de tolerância
  (±0,35 por time, ±0,40 no total).
- **16.3 (favorito de liga mais forte):** adota a supremacia do λ_market e mantém o total do modelo.
- **Sem xG:** produção ofensiva = 50% gols + 25% (0,32 × chutes no alvo) + 25% (0,53 × grandes
  chances). O 0,53 é o xG por grande chance criada nos prints reais (1,8/3,4 e 1,4/2,6). São só 2
  times, então é preciso recalibrar com mais jogos (teste "calibração do fator" em `gates.test.ts`).
- **8–15 pp de divergência sem fato concreto → NO BET**; > 15 pp → INVESTIGAR.
- **Nível 3 (escanteios e cartões amarelos):** binomial negativa por time com φ = 1,25 (escanteios)
  e 1,6 (cartões). Prior de 5,0 escanteios e 2,2 cartões por time (editáveis na aba Jogo). Mando
  ×1,10 nos escanteios e ×0,93 nos cartões. No 1º tempo saem 46% dos escanteios e 38% dos cartões.
  O modelo pesa no máximo 30% no blend, o gate sobe +1 pp e a sensibilidade usa ±15%. Sem o dado
  dos dois times, o mercado é descartado com motivo. Chutes e impedimentos seguem sem modelo.
- **Odd com ponto perdido** ("11", "215"): a leitura com o ponto depois do 1º dígito é a padrão, e a
  outra (11,0 / 21,5) só vale se deixar a margem do mercado plausível (2–30%, mais perto de 8%).
