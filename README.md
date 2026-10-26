# Pricing Engine Web — protocolo V3.3

Ferramenta pessoal de análise pré-live: prints → conferência humana → motor determinístico →
decisão (🟢 BET / 🟡 WATCHLIST / 🔍 INVESTIGAR / ⛔ NO BET). **NO BET é o padrão.**
A leitura dos prints só extrai dados; **quem calcula é o código** (`packages/engine`).

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
  src/ajustesLambda.ts  checagem λ_modelo × λ_market (9.4) e viés conhecido (16.3)
  src/gates.ts          blend, edge gate, price gate (12, 14, 20)
  src/sensibilidade.ts  cenários ROBUSTA / MODERADA / FRÁGIL (15)
  src/kelly.ts          Kelly fracionado, teto 2%/aposta e 5%/lote (21)
  src/varredura.ts      todos os mercados: top 5, descartados com motivo, 1 instrumento por tese (19)
  src/decisao.ts        pipeline completo e decisão (22–23)
  test/                 testes, incluindo o lote de 21/10/2026 e as odds reais Villa × Viking
```

```
packages/schemas  schemas zod (OddLine, StatsTime, importação JSON)
packages/parsers  texto do OCR → odds: detecção da fonte, sinônimos de mercado,
                  reconhecimento de times, parser da 1win, sanidade, junção de prints
apps/web          site React + Vite (mobile-first)
  src/passos/     1 Jogo → 2 Prints/JSON → 3 Conferência → 4 Contexto/red team → 5 Resultado
  src/ocr.ts      Tesseract.js no navegador (pré-processamento: cinza, contraste, ampliação)
```

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

### Limitações conhecidas (Fase 2)
- O parser da 1win foi escrito a partir do formato descrito, **sem prints reais**. Os primeiros prints
  reais devem virar fixtures em `packages/parsers/test/` para calibrar.
- SofaScore/SuperScore/Flashscore são detectados, mas o leitor de estatísticas é a Fase 2b;
  por enquanto as estatísticas são digitadas no passo 1.
- O rascunho fica só no `localStorage` do aparelho; histórico de verdade é a Fase 4.

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
