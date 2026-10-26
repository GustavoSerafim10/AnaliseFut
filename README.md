# Pricing Engine Web — protocolo V3.3

Ferramenta pessoal de análise pré-live: prints → conferência humana → motor determinístico →
decisão (🟢 BET / 🟡 WATCHLIST / 🔍 INVESTIGAR / ⛔ NO BET). **NO BET é o padrão.**
A leitura dos prints só extrai dados; **quem calcula é o código** (`packages/engine`).

## Comandos

```powershell
npm install          # instala as dependências (uma vez)
npm test             # roda todos os testes do motor
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
  src/ajustesLambda.ts  checagem λ_modelo × λ_market (9.4) e viés conhecido (16.3)
  src/gates.ts          blend, edge gate, price gate (12, 14, 20)
  src/sensibilidade.ts  cenários ROBUSTA / MODERADA / FRÁGIL (15)
  src/kelly.ts          Kelly fracionado, teto 2%/aposta e 5%/lote (21)
  src/varredura.ts      todos os mercados: top 5, descartados com motivo, 1 instrumento por tese (19)
  src/decisao.ts        pipeline completo e decisão (22–23)
  test/                 testes, incluindo o lote de 21/10/2026 e as odds reais Villa × Viking
```

Próximas fases: `apps/web` (React + Vite, OCR com Tesseract.js, conferência, IndexedDB),
`packages/parsers` e `packages/schemas` (zod).

## Escolhas de implementação a revisar

- **Tese** de cada mercado é detectada automaticamente pela direção em que a aposta "torce":
  supremacia do mandante, visitante resiste, jogo aberto ou jogo fechado.
- **Edge gate:** cada agravante (pouco líquido, escalação incerta, modelos divergentes, λ largo)
  soma +1 pp — leitura conservadora do protocolo.
- **9.4 sem explicação concreta:** o λ_modelo é movido até o limite de tolerância
  (±0,35 por time, ±0,40 no total).
- **16.3 (favorito de liga mais forte):** adota a supremacia do λ_market e mantém o total do modelo.
- **Sem xG:** produção ofensiva = 50% gols + 50% (0,32 × chutes no alvo). Grandes chances ainda
  não entram (falta um fator de conversão validado).
- **8–15 pp de divergência sem fato concreto → NO BET**; > 15 pp → INVESTIGAR.
- Escanteios/cartões (nível 3) ficam como "só informação" até a Fase 5.
